'use strict';
// Starts the real server (http_server.js) in a child process with a scratch data dir and a dev login, twice:
// with no plugins (the open-source baseline must work on its own) and with every plugin switched on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
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
    return { get, post, log: () => log, stop: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

test('boots with no plugins: core routes answer, plugin routes do not exist', { timeout: 30000 }, async () => {
    const s = await boot('none');
    try {
        const me = await s.get('/api/me');
        assert.equal(me.status, 200);
        assert.equal(me.headers.get('referrer-policy'), 'same-origin', 'our hostname must not leak to outside services');
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
    } finally {
        await admin.stop();
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
