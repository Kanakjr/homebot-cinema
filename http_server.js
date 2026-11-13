#!/usr/bin/env node

// Copyright (C) 2017-2023 Smart code 203358507
// HomeBot Cinema Backend Server

const INDEX_CACHE = 7200;
const ASSETS_CACHE = 2629744;
const HTTP_PORT = Number(process.env.PORT) || 8080;

require('./server/net_defaults').applyNetDefaults(); // before any outgoing connection is made
const express = require('express');
const { rewriteUpstreamPath, forceH264ForHls } = require('./server/proxy_rewrite');
// Hostnames this app is reached on: the one of the request itself (what the player puts into mediaURL=) plus PUBLIC_HOSTS
// (comma separated host[:port], optional). See server/proxy_rewrite.js.
const PUBLIC_HOSTS = String(process.env.PUBLIC_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
const ownHosts = (req) => [...String(req.headers['x-forwarded-host'] || '').split(','), req.headers.host, ...PUBLIC_HOSTS];
const path = require('path');
const fs = require('fs');
const http = require('http');

const build_path = path.resolve(__dirname, 'build');
const index_path = path.join(build_path, 'index.html');
const data_path = path.resolve(__dirname, 'data');
const users_path = path.join(data_path, 'users');

const STREMIO_SERVER_HOST = process.env.STREMIO_SERVER_HOST || 'stremio-streaming-server';
const STREMIO_SERVER_PORT = parseInt(process.env.STREMIO_SERVER_PORT || '11470', 10);

// Ensure data and users directory exist
try {
    fs.mkdirSync(users_path, { recursive: true });
} catch (e) {
    console.error('Failed to create data/users directory:', e);
}

const { openDb } = require('./server/db');
const { createAuth } = require('./server/auth');
const cinemaDb = openDb(data_path);
// daily consistent copy of the database for file-level backups (data/snapshots, keeps 7)
require('./server/snapshots').createSnapshots({ raw: cinemaDb.raw, dir: path.join(data_path, 'snapshots') }).start();
const auth = createAuth({ db: cinemaDb });
const { createStreamLinks, loadSecret } = require('./server/streamlinks');
const streamLinksSecret = loadSecret(data_path);
const streamLinks = createStreamLinks({ secret: streamLinksSecret });

const app = express();


// Keep-alive agent for upstream connections to the Stremio streaming server
const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });

// Public trackers used to kick-start torrents that arrive without any announce list
const DEFAULT_TRACKERS = (process.env.DEFAULT_TRACKERS ||
    'udp://tracker.opentrackr.org:1337/announce,udp://open.demonii.com:1337/announce,udp://tracker.torrent.eu.org:451/announce,udp://open.stealth.si:80/announce,udp://exodus.desync.com:6969/announce,udp://tracker.openbittorrent.com:6969/announce'
).split(',').map((t) => t.trim()).filter(Boolean);
const WARM_TTL_MS = 30 * 60 * 1000;
const WARM_TIMEOUT_MS = 10000;
const warmedTorrents = new Map(); // infoHash -> { at, promise }
const TORRENT_PATH_RE = /^\/(?:streaming\/)?([0-9a-fA-F]{40})\/(\d+)(?:[/?]|$)/;

// Same as the official client's `create` call: starts the engine and searches DHT + trackers.
function warmTorrent(infoHash, extraTrackers) {
    const key = infoHash.toLowerCase();
    const cached = warmedTorrents.get(key);
    if (cached && Date.now() - cached.at < WARM_TTL_MS) return cached.promise;

    const sources = [`dht:${key}`]
        .concat(extraTrackers.concat(DEFAULT_TRACKERS).map((t) => `tracker:${t}`))
        .filter((v, i, a) => a.indexOf(v) === i);
    const body = JSON.stringify({
        torrent: { infoHash: key },
        peerSearch: { sources, min: 40, max: 200 },
        guessFileIdx: false
    });

    const promise = new Promise((resolve) => {
        const req = http.request({
            hostname: STREMIO_SERVER_HOST,
            port: STREMIO_SERVER_PORT,
            path: `/${key}/create`,
            method: 'POST',
            agent: upstreamAgent,
            timeout: WARM_TIMEOUT_MS,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
        }, (r) => { r.resume(); r.on('end', resolve); r.on('error', resolve); });
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.on('error', resolve);
        req.end(body);
    });
    warmedTorrents.set(key, { at: Date.now(), promise });
    if (warmedTorrents.size > 500) {
        for (const [k, v] of warmedTorrents) {
            if (Date.now() - v.at > WARM_TTL_MS) warmedTorrents.delete(k);
        }
    }
    return promise;
}

// Streaming Proxy to official Stremio Streaming Server container
const streamingPaths = [
    '/streaming', '/streaming/*',
    '/hlsv2', '/hlsv2/*',
    '/settings',
    '/stats.json',
    '/subtitles.vtt', '/subtitles.vtt*',
    '/opensubHash', '/subtitleSignature', // subtitle matching used by the player
    '/proxy', '/proxy/*',
    // Root-level torrent stream URLs (e.g. /<infohash>/0, /<infohash>/create, /<infohash>/0/stats.json)
    // that the player builds when the streaming server URL is the bare origin.
    /^\/[0-9a-fA-F]{40}(\/.*)?$/
];

app.use(streamingPaths, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400'
        });
        return res.end();
    }

    let targetPath = req.originalUrl.replace(/^\/streaming/, '') || '/';

    // Warm the torrent (peer search) before the first byte request for a cold infohash
    if ((req.method === 'GET' || req.method === 'HEAD') && TORRENT_PATH_RE.test(req.originalUrl.split('?')[0] + '/')) {
        const m = req.originalUrl.match(TORRENT_PATH_RE);
        if (m) {
            let trackers = [];
            try {
                trackers = new URL(req.originalUrl, 'http://x').searchParams.getAll('tr')
                    .map((t) => t.replace(/^tracker:/, '')).filter((t) => /^(udp|http|https|wss?):\/\//i.test(t));
            } catch (_) {}
            await warmTorrent(m[1], trackers);
        }
    }

    // The streaming server cannot fetch our public hostname (Cloudflare Access): point mediaURL= / videoUrl= at the
    // internal addresses (see server/proxy_rewrite.js).
    targetPath = rewriteUpstreamPath(targetPath, { hosts: ownHosts(req) }); // torrent URLs -> 127.0.0.1:11470 (the streaming server itself)
    // HEVC is re-encoded to H.264 for HLS instead of copied (copying causes timeline gaps / micro-stalls). HLS_FORCE_H264=0 disables.
    if (process.env.HLS_FORCE_H264 !== '0') targetPath = forceH264ForHls(targetPath);

    const headers = { ...req.headers };
    delete headers.host;

    const proxyReq = http.request({
        agent: upstreamAgent,
        hostname: STREMIO_SERVER_HOST,
        port: STREMIO_SERVER_PORT,
        path: targetPath,
        method: req.method,
        headers: {
            ...headers,
            host: `${STREMIO_SERVER_HOST}:${STREMIO_SERVER_PORT}`
        }
    }, (proxyRes) => {
        const responseHeaders = { ...proxyRes.headers };
        responseHeaders['access-control-allow-origin'] = '*';
        responseHeaders['access-control-allow-methods'] = 'GET, POST, OPTIONS, HEAD';
        responseHeaders['access-control-allow-headers'] = '*';
        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.on('error', () => res.destroy());
        proxyRes.pipe(res, { end: true });
    });

    // Abort the upstream request when the browser goes away (seek, tab close)
    let clientGone = false;
    res.on('close', () => {
        if (!res.writableFinished) {
            clientGone = true;
            proxyReq.destroy();
        }
    });

    proxyReq.on('error', (err) => {
        // our own abort after the viewer left shows up as "socket hang up"/ECONNRESET: expected, not an error
        if (clientGone) return;
        console.error('[Streaming Proxy Error]:', err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Streaming server unavailable', details: err.message });
        }
    });

    req.pipe(proxyReq, { end: true });
});

// Parse JSON request bodies up to 10MB
app.use(express.json({ limit: '10mb' }));

// Strict anti-cache headers for all API requests EXCEPT media streaming
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/downloads/stream')) {
        // Media bytes and their errors must never sit in a shared cache (Cloudflare caches *.mp4 by default,
        // which would keep serving a signed/authorised response to anyone after the link expires).
        res.set('Cache-Control', 'private, no-store');
        return next();
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
});

// Authentication gate: every /api route needs a verified Cloudflare Access login.
// Exception: /api/downloads/stream/<id> is bypassed at Cloudflare so external players
// (VLC/Infuse/IINA) can fetch it; there it must carry a valid signed, expiring link
// (see /api/downloads/link/:id). A normal logged-in browser session also still works.
app.use('/api', (req, res, next) => {
    const m = req.path.match(/^\/downloads\/stream\/([^/]+)/);
    if (m) {
        let id = m[1];
        try { id = decodeURIComponent(id); } catch (_) { /* keep raw */ }
        if (streamLinks.verify(id, req.query.exp, req.query.sig)) return next();
    }
    return auth.requireLogin(req, res, next);
});

// 1. Identity endpoints
app.get('/api/me', (req, res) => {
    res.json({
        email: req.login.email, isAdmin: req.login.isAdmin,
        // where "Sign out" goes: the Cloudflare Access logout of this deployment (the app's own /cdn-cgi path when no team is configured)
        signOutUrl: auth.config.team ? `https://${auth.config.team}/cdn-cgi/access/logout` : '/cdn-cgi/access/logout',
        // optional link to a companion dashboard (DASHBOARD_URL, https only); the menu entry is hidden without it
        dashboardUrl: /^https:\/\/[^\s]+$/.test(process.env.DASHBOARD_URL || '') ? process.env.DASHBOARD_URL : null,
    });
});
app.get('/api/sso_user', (req, res) => {
    res.json({ email: req.login.email, isAdmin: req.login.isAdmin, authenticated: true });
});

// Household profiles, avatars and per-profile library/settings sync
const profileApi = require('./server/profile_routes').registerProfileRoutes(app, {
    db: cinemaDb,
    secret: streamLinksSecret,
    dataPath: data_path,
    ownerName: process.env.OWNER_PROFILE_NAME || '',
    adminEmails: auth.config.admins
});

// 2. Universal Addons endpoint (controlled from backend)
app.get('/api/addons', (_req, res) => {
    const addonsFile = path.join(data_path, 'addons.json');
    if (fs.existsSync(addonsFile)) {
        try {
            const data = fs.readFileSync(addonsFile, 'utf8');
            return res.json(JSON.parse(data));
        } catch (e) {
            console.error('Error reading addons.json:', e);
        }
    }
    res.json([]);
});

// Initialize Downloads Manager and Sentinel Daemon
const DownloadsManager = require('./server/downloads_manager');
const SentinelDaemon = require('./server/sentinel');

const downloadsManager = new DownloadsManager(data_path);
const sentinelDaemon = new SentinelDaemon(downloadsManager, data_path);

// Grabber: quality profiles (Sonarr/Radarr style) used by Sentinel and the "Save" button
const { QualityStore } = require('./server/grabber/store');
const { registerGrabberRoutes } = require('./server/grabber/routes');
const qualityStore = new QualityStore(cinemaDb);
const { createSwarmProbe } = require('./server/grabber/swarm_probe');
const { registerProbeRoutes } = require('./server/grabber/probe_routes');
// live check: can the streaming server really pull data for this torrent right now?
const swarmProbe = createSwarmProbe({ host: STREMIO_SERVER_HOST, port: STREMIO_SERVER_PORT, warm: (hash) => warmTorrent(hash, []) });
sentinelDaemon.setGrabber({ resolve: (id) => qualityStore.resolve(id), probeMany: swarmProbe.probeMany });

// Start sentinel daemon in background (checks every 2 hours)
sentinelDaemon.start();

registerGrabberRoutes(app, { store: qualityStore, requireAdmin: auth.requireAdmin, downloadsManager, db: cinemaDb, probeMany: swarmProbe.probeMany });
registerProbeRoutes(app, { probeMany: swarmProbe.probeMany });

// Server media library (Jellyfin-style view over /Movies and /TV)
const { Library } = require('./server/library/library');
const { registerLibraryRoutes } = require('./server/library/routes');
const library = new Library({
    db: cinemaDb,
    roots: { movie: process.env.LIBRARY_MOVIES_DIR || '/Movies', series: process.env.LIBRARY_TV_DIR || '/TV' }
});
sentinelDaemon.setLibrary(library);
registerLibraryRoutes(app, {
    library,
    db: cinemaDb,
    requireAdmin: auth.requireAdmin,
    // an admin deleting an episode in the library is intentional: Sentinel must not fetch it again
    onEpisodeRemoved: (d) => {
        if (d.type === 'series' && d.imdbId && d.season !== null && d.season !== undefined && d.episode !== null && d.episode !== undefined) {
            sentinelDaemon.markEpisodeRemoved(d.imdbId, d.season, d.episode);
        }
    },
    // deleting a library file also drops the matching legacy download record / torrent (without touching other files)
    onFileDeleted: async (filePath) => {
        const rec = Object.values(downloadsManager.downloads).find((d) => d.filePath === filePath);
        if (rec) await downloadsManager.actionDownload(rec.id, 'delete', false);
    }
});
// Admin dashboard API
// Smart browse (TMDB discover). Without TMDB_API_KEY the routes answer "not configured" and the page explains how to enable it.
const tmdb = require('./server/smart/tmdb').createTmdb({ apiKey: process.env.TMDB_API_KEY, apiBase: process.env.TMDB_API_BASE || undefined, raw: cinemaDb.raw, region: process.env.WATCH_REGION || 'IN' });
require('./server/smart/routes').registerFindRoutes(app, { tmdb, library });

// AI copilot (Gemini): recommends titles, answers questions about the server and stages downloads that the user must confirm.
// Off until GEMINI_API_KEY is set; the key never leaves the server.
require('./server/ai').registerAi(app, {
    requireProfile: profileApi.requireProfile,
    db: cinemaDb, tmdb, library, downloadsManager, sentinel: sentinelDaemon, qualityStore, probeMany: swarmProbe.probeMany,
    region: process.env.WATCH_REGION || 'IN'
});

require('./server/admin_routes').registerAdminRoutes(app, {
    db: cinemaDb,
    auth,
    library,
    downloadsManager,
    sentinel: sentinelDaemon,
    // best-effort count of torrents the streaming server is currently handling
    streamingStats: () => new Promise((resolve) => {
        const r = http.get({ host: STREMIO_SERVER_HOST, port: STREMIO_SERVER_PORT, path: '/stats.json', timeout: 3000 }, (resp) => {
            let body = '';
            resp.on('data', (c) => { body += c; });
            resp.on('end', () => {
                try { resolve({ torrents: Object.keys(JSON.parse(body) || {}).length }); } catch (_) { resolve(null); }
            });
        });
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
    })
});
setTimeout(() => library.scan(), 15 * 1000);
setInterval(() => library.scan(), 30 * 60 * 1000);

// Live updates (SSE): pages refetch on these hints instead of polling.
const { createEventHub, emitAfter, createTorrentWatcher } = require('./server/events');
const eventHub = createEventHub();
app.get('/api/events', eventHub.handler);
emitAfter(downloadsManager, ['addDownload', 'actionDownload'], eventHub.emit, 'downloads');
emitAfter(library, ['scan', 'deleteFile', 'deleteItem', 'identify'], eventHub.emit, 'library');
emitAfter(sentinelDaemon, ['addMonitored', 'removeMonitored', 'redownload', 'checkSeries', 'checkAllMonitored', 'markEpisodeRemoved'], eventHub.emit, 'sentinel');
// A finished download shows up in the server library within ~20 s instead of at the next 30-minute scan.
let rescanTimer = null;
createTorrentWatcher({
    getTorrents: (fields) => downloadsManager.transmission.getTorrents(fields),
    emit: eventHub.emit,
    onComplete: () => {
        clearTimeout(rescanTimer);
        rescanTimer = setTimeout(() => {
            downloadsManager.listDownloads().catch(() => null).then(() => library.scan()).catch((e) => console.error('[Library] rescan after download failed:', e.message));
        }, 15 * 1000);
    },
}).start();

// 5. Downloads API: List all active & completed downloads + local discovery
app.get('/api/downloads', async (_req, res) => {
    try {
        const data = await downloadsManager.listDownloads();
        res.json(data);
    } catch (e) {
        console.error('[API /api/downloads error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 6. Downloads API: Add a new download task
app.post('/api/downloads/add', async (req, res) => {
    try {
        const { magnet, mediaId, imdbId, title, type, season, episode, poster, year } = req.body;
        if (!magnet) {
            return res.status(400).json({ error: 'Magnet link or stream URL required' });
        }
        const record = await downloadsManager.addDownload({
            magnet,
            mediaId,
            imdbId,
            title,
            type,
            season,
            episode,
            poster,
            year
        });
        res.json({ success: true, record });
    } catch (e) {
        console.error('[API /api/downloads/add error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 7. Downloads API: Action (pause, resume, delete)
app.post('/api/downloads/action', async (req, res) => {
    try {
        const { id, action, deleteLocalData } = req.body;
        if (!id || !action) {
            return res.status(400).json({ error: 'id and action required' });
        }
        if (action === 'delete' && !req.login.isAdmin) {
            return res.status(403).json({ error: 'admin_only' });
        }
        if (action === 'delete') cinemaDb.audit(req.login.email, null, 'download.delete', { id, deleteLocalData: !!deleteLocalData });
        const result = await downloadsManager.actionDownload(id, action, deleteLocalData);
        res.json(result);
    } catch (e) {
        console.error('[API /api/downloads/action error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 8. Downloads API: Check if media is downloaded or in progress
app.get('/api/downloads/check/:mediaId', async (req, res) => {
    try {
        const result = await downloadsManager.checkMedia(req.params.mediaId);
        res.json(result);
    } catch (e) {
        console.error('[API /api/downloads/check error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 8b. Downloads API: mint a signed, expiring stream link for external players
app.get('/api/downloads/link/:id', (req, res) => {
    const id = req.params.id;
    const { exp, sig } = streamLinks.sign(id);
    res.json({
        // Trailing slash is deliberate: Cloudflare mishandles the query string of URLs ending exactly in
        // a static media extension (.mp4/.mkv/.bin), which drops the signature. Express ignores the slash.
        path: `/api/downloads/stream/${encodeURIComponent(id)}/video.mp4/?exp=${exp}&sig=${sig}`,
        expiresAt: new Date(exp * 1000).toISOString()
    });
});

// 9. Downloads API: HTTP 206 Partial Content Range Streaming
app.get(['/api/downloads/stream/:id', '/api/downloads/stream/:id/:filename'], (req, res) => {
    try {
        let streamId = req.params.id;
        const lf = /^lf_(\d+)$/.exec(streamId);
        if (lf) {
            streamId = library.filePath(Number(lf[1]));
            if (!streamId) return res.status(404).json({ error: 'Media file not found on disk' });
        }
        downloadsManager.streamMedia(req, res, streamId);
    } catch (e) {
        console.error('[API /api/downloads/stream error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 10. Downloads API: Disk space info
app.get('/api/downloads/disk', (_req, res) => {
    try {
        res.json(downloadsManager.getDiskStats());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 11. Sentinel API: List monitored series
app.get('/api/sentinel/monitored', (_req, res) => {
    res.json(sentinelDaemon.getMonitored());
});

// 12. Sentinel API: Toggle / set monitored series
app.post('/api/sentinel/monitor', auth.requireAdmin, (req, res) => {
    try {
        const { imdbId, title, poster, quality, monitored, profileId, scope } = req.body;
        if (!imdbId) return res.status(400).json({ error: 'imdbId is required' });

        if (monitored === false) {
            const removed = sentinelDaemon.removeMonitored(imdbId);
            return res.json({ success: true, removed, imdbId });
        } else {
            const item = sentinelDaemon.addMonitored({ imdbId, title, poster, quality, profileId, scope });
            cinemaDb.audit(req.login.email, null, 'sentinel.monitor', { imdbId, scope: item.scope });
            return res.json({ success: true, item });
        }
    } catch (e) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        console.error('[API /api/sentinel/monitor error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// 12b. Sentinel API: fetch episodes again that were removed from disk on purpose
app.post('/api/sentinel/redownload', auth.requireAdmin, (req, res) => {
    try {
        const { imdbId, season } = req.body || {};
        if (!imdbId) return res.status(400).json({ error: 'imdbId is required' });
        const cleared = sentinelDaemon.redownload(imdbId, season === undefined ? undefined : Number(season));
        cinemaDb.audit(req.login.email, null, 'sentinel.redownload', { imdbId, season: season ?? null, episodes: cleared.length });
        res.json({ success: true, cleared });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
});

// 13. Sentinel API: Trigger immediate check
app.post('/api/sentinel/check', auth.requireAdmin, async (req, res) => {
    try {
        const { imdbId } = req.body || {};
        if (imdbId) {
            const result = await sentinelDaemon.checkSeries(imdbId);
            res.json(result);
        } else {
            const results = await sentinelDaemon.checkAllMonitored();
            res.json({ success: true, results });
        }
    } catch (e) {
        console.error('[API /api/sentinel/check error]:', e);
        res.status(500).json({ error: e.message });
    }
});

// Static files
app.use(express.static(build_path, {
    setHeaders: (res, filePath) => {
        const basename = path.basename(filePath);
        if (filePath === index_path || basename === 'index.html' || basename === 'service-worker.js' || basename === 'manifest.json') {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
            res.set('Surrogate-Control', 'no-store');
        } else if (filePath.includes('/v5.')) {
            // Versioned build assets (unique hash path) can be cached long-term
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
            res.set('Cache-Control', 'public, max-age=86400');
        }
    }
})).all('*', (_req, res) => {
    res.status(404).send('<h1>404! Page not found</h1>');
}).listen(HTTP_PORT, () => console.info(`HomeBot Cinema Server listening on port: ${HTTP_PORT}`));
