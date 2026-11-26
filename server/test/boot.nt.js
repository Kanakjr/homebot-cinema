'use strict';
// Starts the real server (http_server.js) in a child process with a scratch data dir and a dev login, twice:
// with no plugins (the open-source baseline must work on its own) and with every plugin switched on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ADMIN = 'admin@example.com';

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });

async function boot(plugins, extraEnv = {}, prepare = null) {
    const port = await freePort();
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    if (prepare) prepare(data);
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'http_server.js'], {
        cwd: ROOT,
        env: {
            PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', PORT: String(port), CINEMA_DATA_DIR: data, CINEMA_PLUGINS: plugins,
            NODE_ENV: 'development', DEV_EMAIL: ADMIN, ADMIN_EMAILS: ADMIN,
            // nothing real to talk to: unroutable hosts fail fast
            STREMIO_SERVER_HOST: '127.0.0.1', STREMIO_SERVER_PORT: '9', TRANSMISSION_HOST: '127.0.0.1', TRANSMISSION_PORT: '9',
            LIBRARY_MOVIES_DIR: path.join(data, 'Movies'), LIBRARY_TV_DIR: path.join(data, 'TV'),
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
        if (/listening on port/.test(log)) break;
        if (child.exitCode !== null) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(log, /listening on port/, `server did not start:\n${log}`);
    const get = async (p) => { const r = await fetch(base + p); return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.clone().arrayBuffer()), body: await r.json().catch(() => null) }; };
    const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;
    return { base, get, post, log: () => log, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

test('boots with no plugins: core routes answer, plugin routes do not exist', { timeout: 30000 }, async () => {
    const s = await boot('none');
    try {
        const me = await s.get('/api/me');
        assert.equal(me.status, 200);
        assert.equal(me.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', 'only the origin, never a path, goes to outside services; trailers need it (YouTube error 153)');
        assert.equal(me.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(me.headers.get('x-frame-options'), 'SAMEORIGIN');
        assert.equal(me.headers.get('x-powered-by'), null);
        assert.equal(me.body.isAdmin, true);
        const pl = await s.get('/api/plugins');
        assert.equal(pl.status, 200);
        assert.ok(pl.body.plugins.length >= 4, 'admins see every installed plugin');
        assert.ok(pl.body.plugins.every((p) => !p.active));
        assert.equal((await s.get('/api/ai/status')).status, 404);
        assert.equal((await s.get('/api/find/options')).status, 404);
        assert.equal((await s.get('/api/grabber/profiles')).status, 200);
        assert.doesNotMatch(s.log(), /\[plugins\] .* failed to load/);
    } finally {
        await s.stop();
    }
});

test('boots with every plugin on: each loads or explains why it is inactive', { timeout: 30000 }, async () => {
    const s = await boot('all', { TELEGRAM_BOT_TOKEN: '', GEMINI_API_KEY: '' });
    try {
        const pl = await s.get('/api/plugins');
        const byId = Object.fromEntries(pl.body.plugins.map((p) => [p.id, p]));
        for (const p of pl.body.plugins) assert.equal(p.error, null, `${p.id} failed: ${p.error}`);
        assert.equal(byId.ai.active, true);
        assert.equal(byId.find.active, true);
        assert.equal(byId.telegram.active, false);
        assert.match(byId.telegram.reason, /TELEGRAM_BOT_TOKEN/);
        assert.equal(byId.gdrive.active, false);
        const ai = await s.get('/api/ai/status');
        assert.equal(ai.status, 200);
        assert.equal(ai.body.configured, false);
        assert.equal((await s.get('/api/find/options')).body.configured, false);
    } finally {
        await s.stop();
    }
});

test('streaming-server settings are admin-only (both proxy paths); reading them is not blocked', { timeout: 30000 }, async () => {
    const user = await boot('none', { ADMIN_EMAILS: 'someone-else@example.com' });
    try {
        assert.equal((await user.get('/api/me')).body.isAdmin, false);
        assert.equal(await user.post('/settings', { cacheSize: 0 }), 403);
        assert.equal(await user.post('/streaming/settings', { cacheSize: 0 }), 403);
        assert.equal(await user.post('/SETTINGS/', { cacheSize: 0 }), 403);
        assert.notEqual((await user.get('/settings')).status, 403, 'reading settings stays open to logged-in profiles');
    } finally {
        await user.stop();
    }
    const admin = await boot('none');
    try {
        // passes the guard and reaches the (absent) streaming server
        assert.equal(await admin.post('/settings', { cacheSize: 0 }), 502);
        assert.equal(await admin.post('/streaming/settings', { cacheSize: 0 }), 502);
        const putRes = await fetch(`${admin.base}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(putRes.status, 502);
    } finally {
        await admin.stop();
    }
});

test('streaming proxy requires login, blocks PUT for non-admin, and strips wildcard CORS', { timeout: 30000 }, async () => {
    const H = 'a'.repeat(40);
    // 1. Unauthenticated requests in production fail closed (401) with no Access-Control-Allow-Origin: *
    const prod = await boot('none', { NODE_ENV: 'production', DEV_EMAIL: '', CF_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-1' });
    try {
        for (const [method, p] of [
            ['GET', '/settings'],
            ['PUT', '/settings'],
            ['POST', '/streaming/settings'],
            ['GET', '/stats.json'],
            ['GET', '/proxy/http://169.254.169.254/latest/meta-data/'],
            ['GET', '/hlsv2/test/master.m3u8'],
            ['POST', `/${H}/create`],
        ]) {
            const r = await fetch(`${prod.base}${p}`, { method, headers: { Origin: 'https://evil.example' } });
            assert.equal(r.status, 401, `${method} ${p} must require login`);
            assert.equal(r.headers.get('access-control-allow-origin'), null, `${method} ${p} must not emit ACAO`);
        }
        const preflight = await fetch(`${prod.base}/settings`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
        assert.equal(preflight.status, 403);
        assert.equal(preflight.headers.get('access-control-allow-origin'), null);
    } finally {
        await prod.stop();
    }

    // 2. Mock upstream streaming server returning ACAO: * — proxy strips it for untrusted origins & blocks PUT for non-admin
    const mockStream = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    await new Promise((r) => mockStream.listen(0, '127.0.0.1', r));
    const streamPort = mockStream.address().port;
    const member = await boot('none', { ADMIN_EMAILS: 'someone-else@example.com', STREMIO_SERVER_PORT: String(streamPort) });
    try {
        assert.equal((await fetch(`${member.base}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
        assert.equal((await fetch(`${member.base}/streaming/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
        const evilStats = await fetch(`${member.base}/stats.json`, { headers: { Origin: 'https://evil.example' } });
        assert.equal(evilStats.status, 200);
        assert.equal(evilStats.headers.get('access-control-allow-origin'), null);
        const sameStats = await fetch(`${member.base}/stats.json`, { headers: { Origin: member.base } });
        assert.equal(sameStats.status, 200);
        assert.equal(sameStats.headers.get('access-control-allow-origin'), member.base);
    } finally {
        await member.stop();
        mockStream.closeAllConnections();
        await new Promise((r) => mockStream.close(r));
    }
});

test('data/art/<name>.png replaces the built-in system image; other names are untouched', { timeout: 30000 }, async () => {
    const s = await boot('none', {}, (data) => {
        fs.mkdirSync(path.join(data, 'art'));
        fs.writeFileSync(path.join(data, 'art', 'empty.png'), 'OVERRIDE-EMPTY');
        fs.writeFileSync(path.join(data, 'art', 'logo.png'), 'NOT-ALLOWED');
    });
    try {
        const a = await s.get('/images/empty.png');
        assert.equal(a.status, 200);
        assert.equal(a.bytes.toString(), 'OVERRIDE-EMPTY');
        assert.notEqual((await s.get('/images/logo.png')).bytes.toString(), 'NOT-ALLOWED', 'only the listed system images can be replaced');
        assert.notEqual((await s.get('/images/anonymous.png')).bytes.toString(), 'OVERRIDE-EMPTY');
    } finally {
        await s.stop();
    }
});

test('kids profiles and missing profiles cannot queue/control downloads, grab, or probe swarms', { timeout: 30000 }, async () => {
    const s = await boot('none');
    try {
        const kid = await (await fetch(`${s.base}/api/profiles`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'KidTest', isKid: true }),
        })).json();
        const kidHeaders = { 'content-type': 'application/json', 'x-profile-id': String(kid.id) };

        assert.equal(await s.post('/api/downloads/add', { magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }), 400);
        assert.equal((await fetch(`${s.base}/api/downloads/add`, { method: 'POST', headers: kidHeaders, body: JSON.stringify({ magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }) })).status, 403);
        assert.equal((await fetch(`${s.base}/api/downloads/action`, { method: 'POST', headers: kidHeaders, body: JSON.stringify({ id: 'dl_1', action: 'pause' }) })).status, 403);
        assert.equal((await fetch(`${s.base}/api/grabber/grab`, { method: 'POST', headers: kidHeaders, body: JSON.stringify({ streams: [], meta: { type: 'movie' } }) })).status, 403);
        assert.equal((await fetch(`${s.base}/api/streams/probe`, { method: 'POST', headers: kidHeaders, body: JSON.stringify({ streams: [{ infoHash: 'a'.repeat(40), fileIdx: 0 }] }) })).status, 403);
    } finally {
        await s.stop();
    }
});
