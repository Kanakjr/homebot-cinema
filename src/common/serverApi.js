// Copyright (C) 2017-2026 HomeBot Cinema
// Helpers for the HomeServer-backed features (library, downloads): API calls, playback, formatting.

async function api(method, url, body, headers) {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body !== undefined || headers ? { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let json = null;
    try {
        json = await res.json();
    } catch (_) {
        // empty or non-JSON body
    }
    if (!res.ok) {
        const err = new Error((json && json.error) || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = json;
        throw err;
    }
    return json;
}

// Single hostname: media (and the signed links external players like VLC use) are served from the page's own origin.
function mediaOrigin() {
    return window.location.origin;
}

const streamUrl = (streamId) => `${mediaOrigin()}/api/downloads/stream/${encodeURIComponent(streamId)}/video.mp4`;

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json';

// Player route for a server file. With an IMDb id it uses the full form stream cards use
// (/player/<stream>/<streamTransport>/<metaTransport>/<type>/<id>/<videoId>), so the core keeps a library item:
// resume, Continue watching, watched marks, next episode and addon subtitles. Without one, the bare route.
function serverPlayerPath(encodedStream, ctx) {
    const base = `/player/${encodeURIComponent(encodedStream)}`;
    if (!ctx || !/^tt\d+$/.test(ctx.imdbId || '') || (ctx.type !== 'movie' && ctx.type !== 'series')) return base;
    const episodic = Number.isInteger(ctx.season) && Number.isInteger(ctx.episode);
    const videoId = ctx.type === 'movie' ? ctx.imdbId : (episodic ? `${ctx.imdbId}:${ctx.season}:${ctx.episode}` : null);
    if (!videoId) return base;
    const transport = encodeURIComponent(CINEMETA_URL);
    return `${base}/${transport}/${transport}/${ctx.type}/${encodeURIComponent(ctx.imdbId)}/${encodeURIComponent(videoId)}`;
}

// Opens the in-app player on a server file. ctx = { type, imdbId, season, episode } when known.
async function playServerFile(core, navigate, streamId, title, ctx) {
    const url = streamUrl(streamId);
    const encoded = await core.transport.encodeStream({
        name: title || 'HomeServer video',
        description: 'HomeServer offline playback',
        url,
        behaviorHints: { notWebReady: false }
    });
    if (typeof encoded === 'string') navigate(serverPlayerPath(encoded, ctx));
    else window.location.href = url;
}

// VLC has no Cloudflare cookie: it needs a signed, expiring link minted by the server.
async function openInVlc(streamId) {
    const { path } = await api('GET', `/api/downloads/link/${encodeURIComponent(streamId)}`);
    window.location.href = `vlc://${mediaOrigin()}${path}&raw=1`;
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    return `${Math.round(n / 1e3)} KB`;
}

const isAdmin = () => !!window.ssoIsAdmin;

module.exports = { api, mediaOrigin, streamUrl, playServerFile, serverPlayerPath, openInVlc, formatBytes, isAdmin };
