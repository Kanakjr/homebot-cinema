'use strict';
// Run: pnpm test:server (needs express in NODE_PATH)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { fakeCtx } = require('../../../server/plugins/testing');
const { openDb } = require('../../../server/db');
const { register } = require('../server');
const S = require('../server/secrets');
const { createStore, MIGRATIONS } = require('../server/store');
const { createThumbs } = require('../server/thumbs');
const { resolveInside } = require('../server/media');

const KB = 1024;
function put(p, bytes = 60 * KB) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 7));
}
function vaultDir({ marker = true } = {}) {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-')));
    const dir = path.join(base, 'Locked');
    put(path.join(dir, 'Trips', '2024', 'beach.mp4'));
    put(path.join(dir, 'Trips', '2024', 'beach.jpg'), 2 * KB); // cover image next to the video
    put(path.join(dir, 'Trips', 'hike.mov'));
    put(path.join(dir, 'Clips', 'one.mp4'));
    put(path.join(dir, 'Clips', 'two.mpeg'));
    put(path.join(dir, 'Clips', '._one.mp4')); // macOS resource fork
    put(path.join(dir, 'Clips', 'tiny.mp4'), 1 * KB); // broken download
    put(path.join(dir, 'Clips', 'notes.txt'));
    put(path.join(dir, 'top.m4v'));
    if (marker) put(path.join(dir, '.cinema-root'), 0);
    return { base, dir };
}

// ---------- secrets ----------
test('passcode: scrypt hash, rules, numeric', () => {
    const h = S.hashPasscode('123456');
    assert.ok(S.checkPasscode('123456', h));
    assert.ok(!S.checkPasscode('123457', h));
    assert.ok(!S.checkPasscode(123456, h), 'only strings');
    assert.ok(!S.checkPasscode('123456', 'garbage'));
    assert.equal(S.passcodeProblem('12345'), 'passcode_too_short');
    assert.equal(S.passcodeProblem(' 123456'), 'passcode_spaces');
    assert.equal(S.passcodeProblem('x'.repeat(65)), 'passcode_too_long');
    assert.equal(S.passcodeProblem(undefined), 'passcode_required');
    assert.equal(S.passcodeProblem('correct horse'), null);
    assert.ok(S.isNumeric('004211') && !S.isNumeric('12a456'));
});

test('sessions: bound to the login, idle auto-lock, max age, close; grants die with their session', () => {
    let t = 1_000_000;
    const s = S.createSessions({ secret: 'x'.repeat(32), now: () => t, idleMs: 60_000, maxMs: 300_000, grantTtlS: 3600 });
    const { token } = s.open('a@example.com');
    assert.ok(s.check(token, 'a@example.com'));
    assert.equal(s.check(token, 'b@example.com'), null, 'another login cannot use it');
    assert.equal(s.check(`${token}x`, 'a@example.com'), null, 'tampered');
    const sid = s.check(token, 'a@example.com').id;
    const g = s.grant(sid, 7, 'a@example.com');
    assert.ok(s.checkGrant(g, 7, 'a@example.com'));
    assert.ok(!s.checkGrant(g, 8, 'a@example.com'), 'another file');
    assert.ok(!s.checkGrant(g, 7, 'b@example.com'), 'another login');
    assert.ok(!s.checkGrant(undefined, 7, 'a@example.com'));
    t += 50_000;
    assert.ok(s.checkGrant(g, 7, 'a@example.com'), 'streaming counts as activity');
    t += 50_000;
    assert.ok(s.check(token, 'a@example.com'), 'still unlocked: the grant refreshed it');
    t += 61_000;
    assert.equal(s.check(token, 'a@example.com'), null, 'auto-locked after a minute idle');
    assert.ok(!s.checkGrant(g, 7, 'a@example.com'), 'its grants stop working');

    const second = s.open('a@example.com');
    const sid2 = s.check(second.token, 'a@example.com').id;
    const g2 = s.grant(sid2, 1, 'a@example.com');
    s.close(sid2);
    assert.equal(s.check(second.token, 'a@example.com'), null, 'Lock closes it');
    assert.ok(!s.checkGrant(g2, 1, 'a@example.com'));

    const third = s.open('a@example.com');
    for (let i = 0; i < 5; i++) { t += 55_000; assert.ok(s.check(third.token, 'a@example.com')); }
    t += 55_000;
    assert.equal(s.check(third.token, 'a@example.com'), null, 'never longer than maxMs, even when in use');
});

test('grants expire on their own', () => {
    let t = 1_000_000;
    const s = S.createSessions({ secret: 'x'.repeat(32), now: () => t, idleMs: 10 * 3600_000, maxMs: 24 * 3600_000, grantTtlS: 60 });
    const sid = s.check(s.open('a@example.com').token, 'a@example.com').id;
    const g = s.grant(sid, 1, 'a@example.com');
    t += 61_000;
    assert.ok(!s.checkGrant(g, 1, 'a@example.com'));
});

test('resolveInside refuses ".." and symlinks that leave the folder', () => {
    const { base, dir } = vaultDir();
    put(path.join(base, 'outside.mp4'));
    fs.symlinkSync(path.join(base, 'outside.mp4'), path.join(dir, 'link.mp4'));
    assert.equal(resolveInside(dir, '../outside.mp4'), null);
    assert.equal(resolveInside(dir, 'link.mp4'), null);
    assert.equal(resolveInside(dir, 'Clips/one.mp4'), path.join(dir, 'Clips', 'one.mp4'));
    assert.equal(resolveInside(dir, 'missing.mp4'), null);
});

// ---------- index ----------
function storeFor(dir) {
    const db = openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'vdb-')), ':memory:');
    db.migratePlugin('vault', MIGRATIONS);
    return { db, store: createStore({ raw: db.raw, root: dir }) };
}

test('scan: videos only (no hidden, resource forks, tiny files or other types), folders with counts', () => {
    const { dir } = vaultDir();
    const { store } = storeFor(dir);
    const st = store.scan();
    assert.equal(st.online, true);
    assert.equal(st.files, 5);
    assert.deepEqual(store.folders('').map((f) => [f.name, f.count]), [['Clips', 2], ['Trips', 2]]);
    assert.deepEqual(store.folders('Trips').map((f) => [f.path, f.count]), [['Trips/2024', 1]]);
    assert.ok(store.folders('Trips')[0].coverId > 0);
    assert.deepEqual(store.files({ folder: '' }).map((f) => f.name), ['top.m4v']);
    assert.deepEqual(store.files({ folder: 'Clips', sort: 'name' }).map((f) => f.name), ['one.mp4', 'two.mpeg']);
    assert.deepEqual(store.files({ search: 'BEACH' }).map((f) => f.folder), ['Trips/2024']);
    assert.deepEqual(store.files({ search: '%' }), [], 'LIKE wildcards are literal');
});

test('scan: no marker = not connected, nothing indexed or dropped; a removed file goes only after a clean scan', () => {
    const { dir } = vaultDir({ marker: false });
    const { store } = storeFor(dir);
    assert.equal(store.scan().online, false);
    assert.equal(store.counts().files, 0);
    put(path.join(dir, '.cinema-root'), 0);
    store.scan();
    assert.equal(store.counts().files, 5);
    fs.rmSync(path.join(dir, '.cinema-root'));
    fs.rmSync(path.join(dir, 'Clips', 'one.mp4'));
    store.scan();
    assert.equal(store.counts().files, 5, 'drive away: rows kept');
    put(path.join(dir, '.cinema-root'), 0);
    const st = store.scan();
    assert.equal(st.removed, 1);
    assert.equal(store.counts().files, 4);
});

test('thumbnails: cover image when there is one, else a frame; failures are remembered', async () => {
    const { dir } = vaultDir();
    const { store } = storeFor(dir);
    store.scan();
    const calls = [];
    const run = async (cmd, args) => {
        calls.push([cmd, args]);
        if (cmd === 'ffprobe') return args[args.length - 1].endsWith('one.mp4') ? 'N/A' : '42.0\n';
        if (args.some((a) => a.endsWith('two.mpeg'))) throw new Error('bad file');
        fs.writeFileSync(args[args.length - 1], 'jpg');
        return '';
    };
    const thumbs = createThumbs({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'vth-')), store, run, waitMs: 2000 });
    const byName = Object.fromEntries(store.files({ search: '.' }).map((f) => [f.name, f.id]));
    const beach = await thumbs.ensure(byName['beach.mp4']);
    assert.ok(beach && fs.existsSync(beach));
    assert.ok(calls.some(([c, a]) => c === 'ffmpeg' && a.includes(path.join(dir, 'Trips', '2024', 'beach.jpg'))), 'used the cover image');
    assert.equal(store.get(byName['beach.mp4']).duration_ms, 42000);
    const hike = await thumbs.ensure(byName['hike.mov']);
    assert.ok(hike);
    assert.ok(calls.some(([c, a]) => c === 'ffmpeg' && a.includes('-ss') && a.includes('4.20')), 'a frame 10% in');
    assert.equal(await thumbs.ensure(byName['two.mpeg']), null);
    assert.equal(store.get(byName['two.mpeg']).thumb_state, -1);
    const n = calls.length;
    assert.equal(await thumbs.ensure(byName['two.mpeg']), null);
    assert.equal(calls.length, n, 'a failed thumbnail is not retried on every request');
});

// ---------- plugin + routes ----------
test('register refuses a VAULT_DIR that is missing, relative, or overlaps MEDIA_ROOTS / a library folder', () => {
    const { base, dir } = vaultDir();
    const saved = process.env.MEDIA_ROOTS;
    try {
        process.env.MEDIA_ROOTS = path.join(base, 'Movies');
        const db = openDb(base, ':memory:');
        const reason = (env, services = {}) => {
            const f = fakeCtx({ id: 'vault', app: express(), db, env, services });
            register(f.ctx, { timers: false });
            return f.disabled();
        };
        assert.match(reason({}), /VAULT_DIR/);
        assert.match(reason({ VAULT_DIR: 'Locked' }), /absolute/);
        process.env.MEDIA_ROOTS = base;
        assert.match(reason({ VAULT_DIR: dir }), /overlaps/, 'inside a media root');
        process.env.MEDIA_ROOTS = path.join(dir, 'Clips');
        assert.match(reason({ VAULT_DIR: dir }), /overlaps/, 'a media root inside it');
        process.env.MEDIA_ROOTS = path.join(base, 'Movies');
        assert.match(reason({ VAULT_DIR: dir }, { library: { allowedRoots: () => [path.join(dir, 'Trips')] } }), /overlaps/, 'a library folder inside it');
        assert.equal(reason({ VAULT_DIR: dir }, { library: { allowedRoots: () => [path.join(base, 'TV')] } }), null);
    } finally {
        if (saved === undefined) delete process.env.MEDIA_ROOTS; else process.env.MEDIA_ROOTS = saved;
    }
});

async function boot({ admin = true } = {}) {
    const { base, dir } = vaultDir();
    const saved = process.env.MEDIA_ROOTS;
    process.env.MEDIA_ROOTS = path.join(base, 'Movies');
    const app = express();
    app.use(express.json());
    // stands in for the server's login gate: X-Test-Email is the verified Cloudflare login (none = signed out)
    app.use('/api', (req, _res, next) => {
        if (req.get('x-test-email')) req.login = { email: req.get('x-test-email'), isAdmin: false };
        next();
    });
    const db = openDb(base, ':memory:');
    const audits = [];
    db.audit = (...a) => audits.push(a);
    const run = async (cmd, args) => { if (cmd === 'ffmpeg') fs.writeFileSync(args[args.length - 1], 'jpg'); return '3.0'; };
    const f = fakeCtx({ id: 'vault', app, db, env: { VAULT_DIR: dir, VAULT_AUTOLOCK_MIN: '10' }, login: { email: 'owner@example.com', isAdmin: admin } });
    const api = register(f.ctx, { timers: false, run });
    process.env.MEDIA_ROOTS = saved === undefined ? '' : saved;
    if (saved === undefined) delete process.env.MEDIA_ROOTS;
    api.store.scan();
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const url = (p) => `http://127.0.0.1:${srv.address().port}${p}`;
    const call = async (method, p, { body, token, as = 'owner@example.com', headers = {} } = {}) => {
        const res = await fetch(url(p), {
            method,
            headers: { 'content-type': 'application/json', ...(token ? { 'x-vault-token': token } : {}), ...(as ? { 'x-test-email': as } : {}), ...headers },
            body: body ? JSON.stringify(body) : undefined,
        });
        const type = res.headers.get('content-type') || '';
        return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, text: type.includes('json') ? null : await res.text() };
    };
    return { dir, api, call, audits, close: () => srv.close() };
}

test('routes: set up, unlock, browse, stream with a grant, resume, lock', async () => {
    const t = await boot();
    try {
        let r = await t.call('GET', '/api/vault/status');
        assert.equal(r.status, 200);
        assert.equal(r.json.configured, false);
        assert.equal(r.json.files, undefined, 'no counts while locked');
        assert.match(r.headers.get('cache-control'), /private, no-store/);
        assert.equal((await t.call('POST', '/api/vault/setup', { body: { passcode: '123' } })).json.error, 'passcode_too_short');
        r = await t.call('POST', '/api/vault/setup', { body: { passcode: '246810' } });
        assert.equal(r.status, 200);
        assert.equal(r.json.numeric, true);
        const token = r.json.token;
        assert.equal((await t.call('POST', '/api/vault/unlock', { body: { passcode: '246810' } })).status, 200);

        assert.equal((await t.call('GET', '/api/vault/browse')).status, 401, 'no token: locked');
        r = await t.call('GET', '/api/vault/browse', { token });
        assert.deepEqual(r.json.folders.map((f) => f.name), ['Clips', 'Trips']);
        assert.deepEqual(r.json.files.map((f) => f.name), ['top.m4v']);
        const clip = (await t.call('GET', '/api/vault/browse?folder=Clips&sort=name', { token })).json.files[0];
        assert.equal(clip.name, 'one.mp4');

        r = await t.call('GET', `/api/vault/link/${clip.id}`, { token });
        assert.equal(r.json.webPlayable, true);
        assert.match(r.json.url, /^\/api\/vault\/stream\/\d+\?g=.+&cinema_private=1$/);
        const link = r.json.url;
        const g = new URL(link, 'http://x').searchParams.get('g');

        r = await t.call('GET', link, { headers: { range: 'bytes=0-9' } });
        assert.equal(r.status, 206);
        assert.equal(r.headers.get('content-range'), `bytes 0-9/${60 * KB}`);
        assert.equal(r.headers.get('content-type'), 'video/mp4');
        assert.match(r.headers.get('cache-control'), /private, no-store/);
        assert.equal((await t.call('GET', link)).status, 200);
        assert.equal((await t.call('GET', link, { as: null })).status, 401, 'signed out: the grant alone is not enough');
        assert.equal((await t.call('GET', link, { as: 'someone@example.com' })).status, 401, 'another login');
        assert.equal((await t.call('GET', link.replace(`/${clip.id}?`, '/999?'))).status, 401, 'another file');
        assert.equal((await t.call('GET', link, { headers: { range: 'bytes=99999999-' } })).status, 416);

        // thumbnails: authenticated via X-Vault-Token header (query-string ?vt= is refused)
        r = await t.call('GET', `/api/vault/thumb/${clip.id}`, { token });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'image/jpeg');
        assert.match(r.headers.get('cache-control'), /private, no-store/);
        assert.equal((await t.call('GET', `/api/vault/thumb/${clip.id}?vt=${encodeURIComponent(token)}`)).status, 401);
        assert.equal((await t.call('GET', `/api/vault/thumb/${clip.id}`)).status, 401);

        // private resume point, written with the grant from the player URL
        assert.equal((await t.call('POST', `/api/vault/progress/${clip.id}`, { body: { g, positionMs: 61000, durationMs: 120000 } })).status, 200);
        assert.equal((await t.call('GET', `/api/vault/progress/${clip.id}?g=${encodeURIComponent(g)}`)).json.progress.positionMs, 61000);
        assert.equal((await t.call('POST', `/api/vault/progress/${clip.id}`, { body: { g: 'nope', positionMs: 1 } })).status, 401);
        await t.call('POST', `/api/vault/progress/${clip.id}`, { body: { g, positionMs: 119000, durationMs: 120000 } });
        assert.equal(t.api.store.progress(clip.id).positionMs, 0, 'watched to the end: starts over next time');

        assert.equal((await t.call('POST', '/api/vault/lock', { token })).status, 200);
        assert.equal((await t.call('GET', '/api/vault/browse', { token })).status, 401);
        assert.equal((await t.call('GET', link)).status, 401, 'Lock stops streams too');
        assert.ok(t.audits.every((a) => a[3] === null || a[3] === undefined), 'the activity log never holds names');
    } finally {
        t.close();
    }
});

test('routes: wrong passcodes lock out for 15 minutes; changing the passcode needs the current one', async () => {
    const t = await boot();
    try {
        await t.call('POST', '/api/vault/setup', { body: { passcode: 'first-pass' } });
        for (let i = 0; i < 4; i++) {
            const r = await t.call('POST', '/api/vault/unlock', { body: { passcode: 'wrong-pass' } });
            assert.equal(r.status, 401);
            assert.equal(r.json.remaining, 4 - i);
        }
        const r = await t.call('POST', '/api/vault/unlock', { body: { passcode: 'wrong-pass' } });
        assert.equal(r.status, 429);
        assert.equal((await t.call('POST', '/api/vault/unlock', { body: { passcode: 'first-pass' } })).status, 429, 'even the right one waits');
        assert.ok((await t.call('GET', '/api/vault/status')).json.lockedForSec > 0);
        t.api.store.setFails(0, null);
        assert.equal((await t.call('POST', '/api/vault/setup', { body: { passcode: 'second-pass' } })).status, 401, 'no current passcode');
        assert.equal((await t.call('POST', '/api/vault/setup', { body: { passcode: 'second-pass', currentPasscode: 'first-pass' } })).status, 200);
        assert.equal((await t.call('POST', '/api/vault/unlock', { body: { passcode: 'second-pass' } })).status, 200);
    } finally {
        t.close();
    }
});

test('routes: admin only; delete removes the video, never a same-name image', async () => {
    const member = await boot({ admin: false });
    try {
        assert.equal((await member.call('GET', '/api/vault/status')).status, 403);
        assert.equal((await member.call('POST', '/api/vault/setup', { body: { passcode: '246810' } })).status, 403);
    } finally {
        member.close();
    }
    const t = await boot();
    try {
        const { token } = (await t.call('POST', '/api/vault/setup', { body: { passcode: '246810' } })).json;
        const beach = (await t.call('GET', '/api/vault/browse?q=beach', { token })).json.files[0];
        assert.equal((await t.call('DELETE', `/api/vault/files/${beach.id}`)).status, 401);
        assert.equal((await t.call('DELETE', `/api/vault/files/${beach.id}`, { token })).status, 200);
        assert.ok(!fs.existsSync(path.join(t.dir, 'Trips', '2024', 'beach.mp4')));
        assert.ok(fs.existsSync(path.join(t.dir, 'Trips', '2024', 'beach.jpg')), 'a same-name image is never deleted (it can be a photo of its own)');
        assert.ok(fs.existsSync(path.join(t.dir, 'Trips', 'hike.mov')), 'nothing else');
        assert.equal((await t.call('GET', '/api/vault/browse?q=beach', { token })).json.files.length, 0);
        assert.equal((await t.call('DELETE', `/api/vault/files/${beach.id}`, { token })).status, 404);
    } finally {
        t.close();
    }
});
