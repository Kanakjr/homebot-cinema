'use strict';
// Plugin "remote": target screens, sessions, and command dispatcher.
// Pure module, tested in plugins/remote/test/remote.nt.js.

const TARGET_TTL_MS = 45 * 1000;
const MAX_TARGETS = 50;
const MAX_PENDING_COMMANDS = 20;
const ID_RE = /^[a-zA-Z0-9:_-]{1,64}$/;

const ALLOWED_ACTIONS = new Set([
    'play',
    'pause',
    'resume',
    'togglePause',
    'seek',
    'setVolume',
    'mute',
    'next',
    'stop',
    'navigate',
    'key',
    'search',
]);

const sanitizeStr = (val, maxLen) => (typeof val === 'string' ? val.trim().slice(0, maxLen) : '');
const sanitizeNum = (val) => (Number.isFinite(val) && val >= 0 ? Math.round(val) : null);
const normLogin = (val) => (typeof val === 'string' && val.trim() ? val.trim().toLowerCase() : null);

function toSink(res) {
    if (res && typeof res.sendEvent === 'function') return res;
    return {
        sendEvent: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        end: res && typeof res.end === 'function' ? () => res.end() : null,
    };
}

function randomId(prefix = 'cmd_') {
    return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createTargetRegistry({ now = Date.now, ttlMs = TARGET_TTL_MS } = {}) {
    // targetId -> TargetRecord
    const targets = new Map();
    // Set<{ sink, login }> for active controllers listening to /api/remote/events or /api/events
    const controllers = new Set();

    function ownsTarget(target, actorLogin) {
        const actor = normLogin(actorLogin);
        if (!actor || !target.login) return true;
        return normLogin(target.login) === actor;
    }

    function prune() {
        const t = now();
        let changed = false;
        for (const [id, target] of targets.entries()) {
            if (!target.res && (t - target.lastSeen > ttlMs)) {
                targets.delete(id);
                changed = true;
            }
        }
        if (changed) {
            broadcastTargets();
        }
    }

    function serializeTarget(target) {
        const activeControllersList = Array.from((target.activeControllers || new Map()).values());
        return {
            id: target.id,
            name: target.name,
            device: target.device,
            isDesktop: !!target.isDesktop,
            capabilities: Array.isArray(target.capabilities) ? target.capabilities : [],
            state: target.state || 'idle',
            nowPlaying: target.nowPlaying || null,
            online: !!target.res || (now() - target.lastSeen < ttlMs),
            login: target.login || null,
            profile: target.profile || null,
            activeControllers: activeControllersList,
            connectedCount: activeControllersList.length,
            updatedAt: new Date(target.lastSeen).toISOString(),
        };
    }

    function filterTargets(forLogin = null) {
        const owner = normLogin(forLogin);
        const list = [];
        for (const target of targets.values()) {
            if (!owner || normLogin(target.login) === owner) {
                list.push(serializeTarget(target));
            }
        }
        return list.sort((a, b) => {
            // Desktop apps first, then active/playing screens, then name
            if (a.isDesktop !== b.isDesktop) return a.isDesktop ? -1 : 1;
            if ((a.state === 'playing') !== (b.state === 'playing')) return a.state === 'playing' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    function listTargets(forLogin = null) {
        prune();
        return filterTargets(forLogin);
    }

    function broadcastTargets() {
        if (controllers.size === 0) return;
        for (const entry of controllers) {
            const payload = { targets: filterTargets(entry.login) };
            try {
                entry.sink.sendEvent('targets', payload);
            } catch (_) {
                controllers.delete(entry);
            }
        }
    }

    function registerTarget(body, who = {}) {
        prune();
        const id = sanitizeStr(body && body.targetId, 64);
        if (!ID_RE.test(id)) return false;
        if (!targets.has(id) && targets.size >= MAX_TARGETS) return false;

        const t = now();
        const existing = targets.get(id);
        const actorLogin = normLogin(who && who.login);
        if (existing && actorLogin && existing.login && normLogin(existing.login) !== actorLogin) {
            return { error: 'forbidden' };
        }
        const name = sanitizeStr(body && body.name, 60) || (existing ? existing.name : 'Cinema Screen');
        const device = sanitizeStr(body && body.device, 60) || (existing ? existing.device : 'Unknown device');
        const isDesktop = body && typeof body.isDesktop === 'boolean' ? body.isDesktop : (existing ? existing.isDesktop : false);
        const capabilities = Array.isArray(body && body.capabilities) ? body.capabilities : (existing ? existing.capabilities : Array.from(ALLOWED_ACTIONS));

        const updated = {
            id,
            name,
            device,
            isDesktop,
            capabilities,
            state: existing ? existing.state : 'idle',
            nowPlaying: existing ? existing.nowPlaying : null,
            pendingCommands: existing ? existing.pendingCommands : [],
            res: existing ? existing.res : null,
            login: actorLogin || (existing ? existing.login : null),
            profile: (who && who.profile) || (existing ? existing.profile : null),
            lastSeen: t,
        };

        targets.set(id, updated);
        broadcastTargets();
        return serializeTarget(updated);
    }

    function updateState(body, who = {}) {
        prune();
        const id = sanitizeStr(body && body.targetId, 64);
        if (!id || !targets.has(id)) return false;

        const target = targets.get(id);
        const actorLogin = normLogin(who && who.login);
        if (actorLogin && !ownsTarget(target, actorLogin)) return { error: 'forbidden' };

        const t = now();
        target.lastSeen = t;
        if (actorLogin && !target.login) target.login = actorLogin;
        if (who && who.profile) target.profile = who.profile;

        if (body.state && ['idle', 'playing', 'paused', 'buffering'].includes(body.state)) {
            target.state = body.state;
        }

        if (body.nowPlaying === null) {
            target.nowPlaying = null;
        } else if (body.nowPlaying && typeof body.nowPlaying === 'object') {
            const np = body.nowPlaying;
            target.nowPlaying = {
                title: sanitizeStr(np.title, 200),
                showName: sanitizeStr(np.showName, 200),
                type: np.type === 'movie' || np.type === 'series' ? np.type : null,
                metaId: sanitizeStr(np.metaId, 80),
                videoId: sanitizeStr(np.videoId, 80),
                poster: sanitizeStr(np.poster, 500),
                streamUrl: sanitizeStr(np.streamUrl, 500),
                timeMs: sanitizeNum(np.timeMs),
                durationMs: sanitizeNum(np.durationMs),
                paused: np.paused === true,
                volume: typeof np.volume === 'number' ? Math.max(0, Math.min(100, Math.round(np.volume))) : (target.nowPlaying ? target.nowPlaying.volume : 100),
                muted: np.muted === true,
                updatedAt: t,
            };
            if (target.nowPlaying.paused && target.state === 'playing') {
                target.state = 'paused';
            } else if (!target.nowPlaying.paused && target.state === 'paused') {
                target.state = 'playing';
            }
        }

        broadcastTargets();
        return serializeTarget(target);
    }

    function connectControllerToTarget(targetId, controllerId, info = {}) {
        prune();
        const id = sanitizeStr(targetId, 64);
        const cId = sanitizeStr(controllerId, 64);
        if (!id || !cId || !targets.has(id)) return false;

        const target = targets.get(id);
        if (info.login && !ownsTarget(target, info.login)) return { error: 'forbidden' };
        if (!target.activeControllers) target.activeControllers = new Map();

        const controllerData = {
            id: cId,
            name: sanitizeStr(info.name, 60) || 'Remote Controller',
            device: sanitizeStr(info.device, 60) || 'Mobile device',
            connectedAt: now(),
        };
        target.activeControllers.set(cId, controllerData);

        if (target.res) {
            try {
                target.res.sendEvent('controller_status', {
                    action: 'connected',
                    controller: controllerData,
                    count: target.activeControllers.size,
                    controllers: Array.from(target.activeControllers.values()),
                });
            } catch (_) {
                target.res = null;
            }
        }

        broadcastTargets();
        return true;
    }

    function disconnectControllerFromTarget(targetId, controllerId, actorLogin = null) {
        prune();
        const id = sanitizeStr(targetId, 64);
        const cId = sanitizeStr(controllerId, 64);
        if (!id || !cId || !targets.has(id)) return false;

        const target = targets.get(id);
        if (actorLogin && !ownsTarget(target, actorLogin)) return { error: 'forbidden' };
        if (!target.activeControllers || !target.activeControllers.has(cId)) return false;

        const prev = target.activeControllers.get(cId);
        target.activeControllers.delete(cId);

        if (target.res) {
            try {
                target.res.sendEvent('controller_status', {
                    action: 'disconnected',
                    controller: prev,
                    count: target.activeControllers.size,
                    controllers: Array.from(target.activeControllers.values()),
                });
            } catch (_) {
                target.res = null;
            }
        }

        broadcastTargets();
        return true;
    }

    function sendCommand(targetId, action, payload = {}, fromUser = null) {
        prune();
        const id = sanitizeStr(targetId, 64);
        if (!id || !targets.has(id)) {
            return { ok: false, error: 'target_not_found' };
        }
        const target = targets.get(id);
        if (fromUser && fromUser.login && !ownsTarget(target, fromUser.login)) {
            return { ok: false, error: 'forbidden' };
        }
        if (!ALLOWED_ACTIONS.has(action)) {
            return { ok: false, error: 'invalid_action' };
        }
        const cmd = {
            id: randomId(),
            action,
            payload: payload && typeof payload === 'object' ? payload : {},
            from: fromUser || null,
            targetId: id,
            timestamp: now(),
        };

        if (target.res) {
            try {
                target.res.sendEvent('command', cmd);
                return { ok: true, delivered: true, commandId: cmd.id };
            } catch (_) {
                target.res = null;
            }
        }

        // Buffer command if target is reconnecting
        if (!target.pendingCommands) target.pendingCommands = [];
        if (target.pendingCommands.length >= MAX_PENDING_COMMANDS) {
            target.pendingCommands.shift();
        }
        target.pendingCommands.push(cmd);
        return { ok: true, delivered: false, queued: true, commandId: cmd.id };
    }

    function canAccessTarget(targetId, actorLogin) {
        prune();
        const id = sanitizeStr(targetId, 64);
        const target = targets.get(id);
        if (!target) return true;
        return ownsTarget(target, actorLogin);
    }

    function attachTargetStream(targetId, res, req, who = {}) {
        prune();
        const id = sanitizeStr(targetId, 64);
        if (!id) return false;

        const actorLogin = normLogin(who && who.login);
        let target = targets.get(id);
        if (!target) {
            const reg = registerTarget({ targetId: id, name: 'Cinema Screen' }, who);
            if (!reg || reg.error) return false;
            target = targets.get(id);
        } else if (actorLogin && !ownsTarget(target, actorLogin)) {
            return { error: 'forbidden' };
        }

        const sink = toSink(res);
        target.res = sink;
        target.lastSeen = now();

        // Send initial target info and active controllers
        const activeList = Array.from((target.activeControllers || new Map()).values());
        try {
            sink.sendEvent('target_info', {
                targetId: id,
                name: target.name,
                count: activeList.length,
                controllers: activeList,
            });
        } catch (_) { /* ignore */ }

        // Flush any pending commands
        if (target.pendingCommands && target.pendingCommands.length > 0) {
            const pending = target.pendingCommands.splice(0);
            for (const cmd of pending) {
                try {
                    sink.sendEvent('command', cmd);
                } catch (_) {
                    break;
                }
            }
        }

        broadcastTargets();

        const cleanup = () => {
            if (target.res === sink) {
                target.res = null;
                target.lastSeen = now();
                broadcastTargets();
            }
        };

        if (req && typeof req.on === 'function') req.on('close', cleanup);
        if (res && typeof res.on === 'function') res.on('close', cleanup);
        return true;
    }

    function attachControllerStream(res, req, forLogin = null) {
        const sink = toSink(res);
        const entry = { sink, login: normLogin(forLogin) };
        controllers.add(entry);
        // Send initial target list immediately
        try {
            sink.sendEvent('targets', { targets: listTargets(entry.login) });
        } catch (_) {
            controllers.delete(entry);
            return;
        }

        const cleanup = () => {
            controllers.delete(entry);
        };

        if (req && typeof req.on === 'function') req.on('close', cleanup);
        if (res && typeof res.on === 'function') res.on('close', cleanup);
    }

    function removeTarget(targetId, actorLogin = null) {
        const id = sanitizeStr(targetId, 64);
        if (!id || !targets.has(id)) return false;
        const target = targets.get(id);
        if (actorLogin && !ownsTarget(target, actorLogin)) return { error: 'forbidden' };
        if (target.res && typeof target.res.end === 'function') {
            try { target.res.end(); } catch (_) { /* ignore */ }
        }
        targets.delete(id);
        broadcastTargets();
        return true;
    }

    function close() {
        for (const target of targets.values()) {
            if (target.res && typeof target.res.end === 'function') {
                try { target.res.end(); } catch (_) { /* ignore */ }
            }
        }
        targets.clear();
        for (const entry of controllers) {
            if (entry.sink && typeof entry.sink.end === 'function') {
                try { entry.sink.end(); } catch (_) { /* ignore */ }
            }
        }
        controllers.clear();
    }

    return {
        registerTarget,
        updateState,
        connectControllerToTarget,
        disconnectControllerFromTarget,
        sendCommand,
        listTargets,
        canAccessTarget,
        attachTargetStream,
        attachControllerStream,
        removeTarget,
        prune,
        close,
        size: () => targets.size,
    };
}

module.exports = {
    createTargetRegistry,
    ALLOWED_ACTIONS,
    TARGET_TTL_MS,
    ID_RE,
};
