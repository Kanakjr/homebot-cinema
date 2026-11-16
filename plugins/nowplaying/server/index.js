'use strict';
// Plugin "nowplaying": the player sends a heartbeat while it plays (ui/Reporter.js); admins see the live list.
//   POST /api/nowplaying        (profile)  heartbeat { session, title, ... }
//   POST /api/nowplaying/stop   (profile)  { session }
//   GET  /api/nowplaying        (admin)    { sessions: [...] }, newest first
// Kept in memory only: nothing is written to disk, and a session disappears 45 s after its last heartbeat.

const { createSessions, deviceLabel } = require('./sessions');

function register(ctx, { now = Date.now } = {}) {
    const sessions = createSessions({ now });

    ctx.app.post('/api/nowplaying', ctx.auth.requireProfile, (req, res) => {
        const p = req.profile || {};
        const ok = sessions.beat(req.body, {
            login: req.login && req.login.email,
            profile: { id: p.id, name: p.name, avatar: p.avatar || null, isKid: !!(p.isKid || p.is_kid) },
            device: deviceLabel(req.get('user-agent')),
        });
        if (!ok) return res.status(400).json({ error: 'bad_heartbeat' });
        res.json({ ok: true });
    });

    ctx.app.post('/api/nowplaying/stop', ctx.auth.requireProfile, (req, res) => {
        sessions.stop(req.body && req.body.session, req.login && req.login.email);
        res.json({ ok: true });
    });

    ctx.app.get('/api/nowplaying', ctx.auth.requireAdmin, (_req, res) => {
        res.json({ sessions: sessions.list() });
    });

    return { list: () => sessions.list() };
}

module.exports = { register };
