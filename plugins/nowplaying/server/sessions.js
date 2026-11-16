'use strict';
// Plugin "nowplaying": the in-memory session list (pure, tested by test/nowplaying.nt.js).

const TTL = 45 * 1000; // the player beats every 15 s; three missed beats and the session is gone
const MAX = 50;
const SESSION_RE = /^[a-z0-9]{8,40}$/i;
const MODES = ['direct', 'transcode'];
const SOURCES = ['server', 'torrent', 'link'];

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** "Chrome on macOS" from a User-Agent; good enough to tell the TV from the phone. */
function deviceLabel(ua) {
    const s = String(ua || '');
    const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? (/Mobile/.test(s) ? 'Android phone' : 'Android TV/tablet')
        : /CrOS/.test(s) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : null;
    const app = /Tauri|libmpv/i.test(s) ? 'Desktop app' : /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
        : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : null;
    if (app && os) return `${app} on ${os}`;
    return app || os || 'Unknown device';
}

function createSessions({ now = Date.now } = {}) {
    const map = new Map();

    const prune = () => {
        const t = now();
        for (const [k, s] of map) if (t - s.updatedAt > TTL) map.delete(k);
    };

    /** Stores one heartbeat; false when it is not a valid one. who = { login, profile, device } from the server. */
    function beat(body, who) {
        const b = body && typeof body === 'object' ? body : {};
        if (!SESSION_RE.test(String(b.session || '')) || !who || !who.login) return false;
        const title = str(b.title, 200);
        if (!title) return false;
        prune();
        const key = `${who.login}|${b.session}`;
        const prev = map.get(key);
        if (!prev && map.size >= MAX) return false;
        const t = now();
        map.set(key, {
            session: b.session,
            login: who.login,
            profile: who.profile,
            device: who.device,
            title,
            type: b.type === 'movie' || b.type === 'series' ? b.type : null,
            metaId: /^[a-z0-9:_.-]{1,80}$/i.test(String(b.metaId || '')) ? b.metaId : null,
            videoId: /^[a-z0-9:_.-]{1,80}$/i.test(String(b.videoId || '')) ? b.videoId : null,
            poster: /^https?:\/\/\S{1,500}$/.test(String(b.poster || '')) ? b.poster : null,
            timeMs: num(b.timeMs),
            durationMs: num(b.durationMs),
            paused: b.paused === true,
            mode: MODES.includes(b.mode) ? b.mode : 'direct',
            source: SOURCES.includes(b.source) ? b.source : null,
            startedAt: prev && prev.title === title ? prev.startedAt : t,
            updatedAt: t,
        });
        return true;
    }

    /** Ends a session (only the login that started it can). */
    function stop(session, login) {
        if (!login) return;
        map.delete(`${login}|${session}`);
    }

    function list() {
        prune();
        return [...map.values()]
            .sort((a, b) => b.startedAt - a.startedAt)
            .map((s) => ({ ...s, startedAt: new Date(s.startedAt).toISOString(), updatedAt: new Date(s.updatedAt).toISOString() }));
    }

    return { beat, stop, list };
}

module.exports = { createSessions, deviceLabel, TTL };
