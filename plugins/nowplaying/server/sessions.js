'use strict';
// Plugin "nowplaying": the in-memory session list (pure, tested by test/nowplaying.nt.js).

const TTL = 75 * 1000; // the player beats every 15 s (a background tab may slow to once a minute); then the session is gone
const MAX = 50;
// time between two heartbeats counts as watched when the earlier one was playing; capped so a tab that slept counts little
const MAX_GAP = 65 * 1000;
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

    /** Stores one heartbeat and returns the session (false when it is not valid). who = { login, profile, device } from the server. */
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
        const same = prev && prev.title === title;
        const gap = same && !prev.paused ? Math.min(Math.max(0, t - prev.updatedAt), MAX_GAP) : 0;
        const mode = MODES.includes(b.mode) ? b.mode : 'direct';
        const session = {
            session: b.session,
            login: who.login,
            profile: who.profile,
            device: who.device,
            title,
            name: str(b.name, 200),
            type: b.type === 'movie' || b.type === 'series' ? b.type : null,
            metaId: /^[a-z0-9:_.-]{1,80}$/i.test(String(b.metaId || '')) ? b.metaId : null,
            videoId: /^[a-z0-9:_.-]{1,80}$/i.test(String(b.videoId || '')) ? b.videoId : null,
            poster: /^https?:\/\/\S{1,500}$/.test(String(b.poster || '')) ? b.poster : null,
            timeMs: num(b.timeMs),
            durationMs: num(b.durationMs),
            paused: b.paused === true,
            mode,
            source: SOURCES.includes(b.source) ? b.source : null,
            startedAt: same ? prev.startedAt : t,
            updatedAt: t,
            watchedMs: (same ? prev.watchedMs : 0) + gap,
            transcoded: (same && prev.transcoded) || mode === 'transcode',
        };
        map.set(key, session);
        return session;
    }

    /** Ends a session (only the login that started it can) and returns its final state, or null. */
    function stop(session, login) {
        if (!login) return null;
        const key = `${login}|${session}`;
        const prev = map.get(key);
        map.delete(key);
        if (!prev) return null;
        const t = now();
        const gap = !prev.paused ? Math.min(Math.max(0, t - prev.updatedAt), MAX_GAP) : 0;
        return { ...prev, updatedAt: t, watchedMs: prev.watchedMs + gap };
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
