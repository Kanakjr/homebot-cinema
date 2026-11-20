'use strict';
// Plugin "remote": Server routes and SSE hubs for screen casting and remote control.
// Pure targets state in ./targets.js; tested in ../test/remote.nt.js.

const { createTargetRegistry } = require('./targets');

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
};

const HEARTBEAT_INTERVAL_MS = 20000;

function register(ctx) {
    const { app, auth, log } = ctx;
    const registry = createTargetRegistry();

    // 1. List active target screens
    app.get('/api/remote/targets', auth.requireLogin, (req, res) => {
        res.json({ targets: registry.listTargets(req.login?.email) });
    });

    // 2. Register or heartbeat a screen as an active target
    app.post('/api/remote/target/register', auth.requireLogin, (req, res) => {
        const who = {
            login: req.login?.email,
            profile: req.profile?.id,
        };
        const target = registry.registerTarget(req.body, who);
        if (!target) {
            return res.status(400).json({ error: 'invalid_target' });
        }
        res.json({ ok: true, target });
    });

    // 3. Update playback state (time, duration, paused, title, poster, volume)
    app.post('/api/remote/target/state', auth.requireLogin, (req, res) => {
        const who = {
            login: req.login?.email,
            profile: req.profile?.id,
        };
        const target = registry.updateState(req.body, who);
        if (!target) {
            return res.status(404).json({ error: 'target_not_found' });
        }
        res.json({ ok: true, target });
    });

    // 4. SSE event stream for a target screen (Mac Mini desktop app, web player, etc.)
    // Incoming remote commands (play, pause, seek, volume, key, navigate) are written here instantly.
    app.get('/api/remote/target/events', auth.requireLogin, (req, res) => {
        const targetId = req.query.targetId;
        if (!targetId) {
            return res.status(400).json({ error: 'targetId_required' });
        }

        res.writeHead(200, SSE_HEADERS);
        res.write('retry: 3000\n\n');
        res.write(': connected\n\n');

        const hb = setInterval(() => {
            try {
                res.write(': hb\n\n');
            } catch (_) {
                clearInterval(hb);
            }
        }, HEARTBEAT_INTERVAL_MS);

        res.on('close', () => clearInterval(hb));
        req.on('close', () => clearInterval(hb));

        registry.attachTargetStream(targetId, res, req);
    });

    // 5. Send a command to a target screen
    app.post('/api/remote/targets/:id/command', auth.requireLogin, (req, res) => {
        const targetId = req.params.id;
        const { action, payload, fromName } = req.body || {};
        const fromUser = {
            login: req.login?.email,
            profile: req.profile?.id,
            name: fromName || req.login?.email || 'Remote Controller',
        };

        const result = registry.sendCommand(targetId, action, payload, fromUser);
        if (!result.ok) {
            const status = result.error === 'target_not_found' ? 404 : 400;
            return res.status(status).json(result);
        }
        res.json(result);
    });

    // 6. Connect a controller to a target screen
    app.post('/api/remote/targets/:id/connect', auth.requireLogin, (req, res) => {
        const targetId = req.params.id;
        const { controllerId, controllerName, device } = req.body || {};
        const ok = registry.connectControllerToTarget(targetId, controllerId, {
            name: controllerName,
            device,
        });
        if (!ok) return res.status(404).json({ error: 'target_not_found' });
        res.json({ ok: true });
    });

    // 7. Disconnect a controller from a target screen
    app.post('/api/remote/targets/:id/disconnect', auth.requireLogin, (req, res) => {
        const targetId = req.params.id;
        const { controllerId } = req.body || {};
        const ok = registry.disconnectControllerFromTarget(targetId, controllerId);
        res.json({ ok });
    });

    // 8. SSE event stream for controllers/remotes (Android phone, web remote)
    // Pushes real-time target discovery and state updates.
    app.get('/api/remote/events', auth.requireLogin, (req, res) => {
        res.writeHead(200, SSE_HEADERS);
        res.write('retry: 5000\n\n');

        const hb = setInterval(() => {
            try {
                res.write(': hb\n\n');
            } catch (_) {
                clearInterval(hb);
            }
        }, HEARTBEAT_INTERVAL_MS);

        res.on('close', () => clearInterval(hb));
        req.on('close', () => clearInterval(hb));

        registry.attachControllerStream(res, req);
    });

    // 7. Remove / unregister a target screen
    app.delete('/api/remote/targets/:id', auth.requireLogin, (req, res) => {
        const ok = registry.removeTarget(req.params.id);
        if (!ok) return res.status(404).json({ error: 'target_not_found' });
        res.json({ ok: true });
    });

    log.info('Remote & Cast plugin registered');
    return { registry };
}

module.exports = { register };
