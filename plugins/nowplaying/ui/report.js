// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": pure helpers for the player-side reporter (tested by test/nowplaying.spec.js).

const HLS_WINDOW = 20000; // HLS fetched in the last 20 s = the streaming server is transcoding (or remuxing) this playback

/** Where the bytes come from: a file on this server, a torrent, or another link. */
function streamSource(stream) {
    if (!stream || typeof stream !== 'object') return null;
    if (typeof stream.url === 'string' && /\/api\/downloads\/stream\//.test(stream.url)) return 'server';
    if (typeof stream.infoHash === 'string') return 'torrent';
    if (typeof stream.url === 'string' || typeof stream.ytId === 'string') return 'link';
    return null;
}

/** A resource URL that is an HLS playlist or segment from the streaming server (not its probe). */
const isHlsResource = (name) => /\/hlsv2\//.test(name) && !/\/hlsv2\/probe/.test(name);

const playbackMode = (lastHlsAt, nowMs) => (lastHlsAt !== null && nowMs - lastHlsAt < HLS_WINDOW ? 'transcode' : 'direct');

/** The heartbeat body. */
function heartbeat({ session, title, type, metaId, videoId, poster, timeMs, durationMs, paused, stream, lastHlsAt, nowMs }) {
    return {
        session,
        title: title || 'Untitled',
        type: type || null,
        metaId: metaId || null,
        videoId: videoId || null,
        poster: poster || null,
        timeMs: Number.isFinite(timeMs) ? timeMs : null,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
        paused: paused === true,
        mode: playbackMode(lastHlsAt, nowMs),
        source: streamSource(stream),
    };
}

/** Random session id for one playback in one tab. */
function newSessionId() {
    const bytes = new Uint8Array(12);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); }));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** "12:04 / 45:10" style times for the admin list. */
function clock(ms) {
    if (!Number.isFinite(ms)) return '--:--';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

module.exports = { HLS_WINDOW, streamSource, isHlsResource, playbackMode, heartbeat, newSessionId, clock };
