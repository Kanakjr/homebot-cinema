'use strict';
// Run: NODE_PATH=<dir with express> node --test server/test/profiles.nt.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { openDb } = require('../db');
const { registerProfileRoutes } = require('../profile_routes');
const { checkPin, hashPin, createTokens, loadPresetCatalog } = require('../profiles');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function boot({ users = null, legacyAvatar = false } = {}) {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
    const presetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-'));
    for (const k of ['zed', 'robot', 'fox', 'panda']) fs.writeFileSync(path.join(presetDir, `${k}.png`), Buffer.from(PNG.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(presetDir, 'SOURCE.txt'), 'not an avatar');
    if (users) {
        fs.mkdirSync(path.join(dataPath, 'users'));
        for (const [email, body] of Object.entries(users)) fs.writeFileSync(path.join(dataPath, 'users', `${email}.json`), JSON.stringify({ email, ...body }));
    }
    const db = openDb(dataPath, ':memory:');
    if (legacyAvatar) db.raw.prepare("INSERT INTO profiles (name, avatar, created_at) VALUES ('Old', '/api/avatars/preset/a01.svg', 'x')").run();
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    // stand-in for the Cloudflare gate
    app.use('/api', (req, _res, next) => {
        req.login = { email: req.headers['x-test-email'] || 'member@example.com', isAdmin: req.headers['x-test-admin'] === '1' };
        next();
    });
    registerProfileRoutes(app, { db, secret: 's'.repeat(32), dataPath, ownerName: 'Owner', adminEmails: ['admin@example.com'], presetDir });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, { body, headers = {} } = {}) => {
        const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* not json */ }
        return { status: res.status, json, text, headers: res.headers };
    };
    return { call, db, close: () => server.close(), dataPath };
}
const ADMIN = { 'x-test-admin': '1', 'x-test-email': 'admin@example.com' };

test('legacy users are seeded into profiles with their library, owner gets the configured name', async () => {
    const t = await boot({ users: { 'admin@example.com': { library: { uid: null, items: { a: 1 } }, library_recent: { uid: null, items: {} } } } });
    const list = (await t.call('GET', '/api/profiles')).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Owner');
    assert.equal(list[0].avatar, '/api/avatars/preset/fox.png', 'first catalog entry is the preferred one');
    const lib = (await t.call('GET', '/api/sync/library', { headers: { 'x-profile-id': String(list[0].id) } })).json;
    assert.deepEqual(lib.library.items, { a: 1 });
    t.close();
});

test('create / validate / limit', async () => {
    const t = await boot();
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: '   ' } })).status, 400);
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: 'x'.repeat(25) } })).status, 400);
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: 'A', pin: '12' } })).status, 400);
    const ok = await t.call('POST', '/api/profiles', { body: { name: 'Kid', isKid: true, avatar: 'http://evil/x.png' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.isKid, true);
    assert.match(ok.json.avatar, /^\/api\/avatars\/preset\//, 'external avatar URLs are replaced by a preset');
    for (let i = 0; i < 7; i++) assert.equal((await t.call('POST', '/api/profiles', { body: { name: `P${i}` } })).status, 201);
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: 'Nine' } })).status, 409);
    t.close();
});

test('PIN: locked sync, wrong/right PIN, token binding, lockout', async () => {
    const t = await boot();
    const p = (await t.call('POST', '/api/profiles', { body: { name: 'Locked', pin: '1234' } })).json;
    assert.equal(p.hasPin, true);
    assert.ok(!('pin_hash' in p) && !JSON.stringify(p).includes('scrypt'), 'hash never leaves the server');
    const H = { 'x-profile-id': String(p.id) };
    assert.equal((await t.call('GET', '/api/sync/library', { headers: H })).status, 423);

    const wrong = await t.call('POST', `/api/profiles/${p.id}/unlock`, { body: { pin: '0000' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.remaining, 4);

    const good = await t.call('POST', `/api/profiles/${p.id}/unlock`, { body: { pin: '1234' } });
    assert.equal(good.status, 200);
    const withTok = { ...H, 'x-profile-token': good.json.token };
    assert.equal((await t.call('GET', '/api/sync/library', { headers: withTok })).status, 200);
    // token is bound to the login email
    assert.equal((await t.call('GET', '/api/sync/library', { headers: { ...withTok, 'x-test-email': 'someone@else.com' } })).status, 423);
    // token for another profile does not unlock this one
    const other = (await t.call('POST', '/api/profiles', { body: { name: 'Other' } })).json;
    assert.equal((await t.call('GET', '/api/sync/library', { headers: { 'x-profile-id': String(p.id), 'x-profile-token': `${other.id}.${good.json.token.split('.').slice(1).join('.')}` } })).status, 423);

    let last;
    for (let i = 0; i < 5; i++) last = await t.call('POST', `/api/profiles/${p.id}/unlock`, { body: { pin: '9999' } });
    assert.equal(last.status, 429);
    assert.ok(last.json.retryAfterSec > 0);
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/unlock`, { body: { pin: '1234' } })).status, 429, 'correct PIN rejected while locked');
    t.close();
});

test('PIN change needs current PIN (admin may reset); remove works', async () => {
    const t = await boot();
    const p = (await t.call('POST', '/api/profiles', { body: { name: 'X', pin: '1111' } })).json;
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/pin`, { body: { pin: '2222' } })).status, 401);
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/pin`, { body: { pin: '2222', currentPin: '1111' } })).status, 200);
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/pin`, { body: { pin: '3333' }, headers: ADMIN })).status, 200);
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/pin/remove`, { body: { currentPin: 'nope' } })).status, 401);
    assert.equal((await t.call('POST', `/api/profiles/${p.id}/pin/remove`, { body: {}, headers: ADMIN })).status, 200);
    assert.equal((await t.call('GET', '/api/profiles')).json.find((x) => x.id === p.id).hasPin, false);
    t.close();
});

test('editing a PIN-locked profile needs its token (or admin); unlocked profiles are editable', async () => {
    const t = await boot();
    const p = (await t.call('POST', '/api/profiles', { body: { name: 'Priv', pin: '1234' } })).json;
    assert.equal((await t.call('PATCH', `/api/profiles/${p.id}`, { body: { name: 'Hacked' } })).status, 423);
    assert.equal((await t.call('PATCH', `/api/profiles/${p.id}`, { body: { name: 'Renamed' }, headers: ADMIN })).json.name, 'Renamed');
    const open = (await t.call('POST', '/api/profiles', { body: { name: 'Open' } })).json;
    const upd = await t.call('PATCH', `/api/profiles/${open.id}`, { body: { accent: 'amber', settings: { amoled: true } } });
    assert.equal(upd.json.accent, 'amber');
    assert.deepEqual(upd.json.settings, { amoled: true });
    t.close();
});

test('delete is admin-only and never removes the last profile', async () => {
    const t = await boot();
    const a = (await t.call('POST', '/api/profiles', { body: { name: 'A' } })).json;
    const b = (await t.call('POST', '/api/profiles', { body: { name: 'B' } })).json;
    assert.equal((await t.call('DELETE', `/api/profiles/${a.id}`)).status, 403);
    assert.equal((await t.call('DELETE', `/api/profiles/${a.id}`, { headers: ADMIN })).status, 200);
    assert.equal((await t.call('DELETE', `/api/profiles/${b.id}`, { headers: ADMIN })).status, 409);
    t.close();
});

test('library sync round-trips per profile and is isolated between profiles', async () => {
    const t = await boot();
    const a = (await t.call('POST', '/api/profiles', { body: { name: 'A' } })).json;
    const b = (await t.call('POST', '/api/profiles', { body: { name: 'B' } })).json;
    const HA = { 'x-profile-id': String(a.id) }, HB = { 'x-profile-id': String(b.id) };
    assert.equal((await t.call('GET', '/api/sync/library')).status, 400, 'no profile header');
    await t.call('POST', '/api/sync/library', { headers: HA, body: { library: { uid: 'u', items: { tt1: { name: 'One' } } }, library_recent: null } });
    assert.equal((await t.call('GET', '/api/sync/library', { headers: HA })).json.library.items.tt1.name, 'One');
    assert.equal((await t.call('GET', '/api/sync/library', { headers: HB })).json.library, null);
    t.close();
});

test('avatars: catalog is ordered, preset files are served safely, uploads are validated', async () => {
    const t = await boot();
    const cat = (await t.call('GET', '/api/avatars')).json;
    assert.deepEqual(cat.map((c) => c.key), ['fox', 'panda', 'robot', 'zed'], 'preferred first, rest alphabetical, non-png ignored');
    assert.equal(cat[1].label, 'Panda');
    const img = await t.call('GET', '/api/avatars/preset/fox.png');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await t.call('GET', '/api/avatars/preset/nope.png')).status, 404);
    assert.equal((await t.call('GET', '/api/avatars/preset/..%2Fprofiles.js')).status, 404);
    assert.equal((await t.call('GET', '/api/avatars/preset/SOURCE.txt')).status, 404);
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: 'Bad', avatar: '/api/avatars/preset/nope.png' } })).json.avatar !== '/api/avatars/preset/nope.png', true, 'unknown preset is replaced');
    assert.equal((await t.call('POST', '/api/profiles', { body: { name: 'Good', avatar: '/api/avatars/preset/robot.png' } })).json.avatar, '/api/avatars/preset/robot.png');
    assert.equal((await t.call('POST', '/api/avatars', { body: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } })).status, 400, 'svg uploads rejected (script risk)');
    assert.equal((await t.call('POST', '/api/avatars', { body: { dataUrl: 'nope' } })).status, 400);
    const up = await t.call('POST', '/api/avatars', { body: { dataUrl: PNG } });
    assert.equal(up.status, 201);
    const got = await t.call('GET', up.json.url);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await t.call('GET', '/api/avatars/file/..%2F..%2Fetc%2Fpasswd')).status, 404);
    const p = (await t.call('POST', '/api/profiles', { body: { name: 'WithPic', avatar: up.json.url } })).json;
    assert.equal(p.avatar, up.json.url);
    t.close();
});

test('profiles still on a removed placeholder avatar are migrated to a catalog avatar', async () => {
    const t = await boot({ legacyAvatar: true });
    const p = (await t.call('GET', '/api/profiles')).json[0];
    assert.equal(p.name, 'Old');
    assert.equal(p.avatar, '/api/avatars/preset/fox.png');
    t.close();
});

test('loadPresetCatalog tolerates a missing directory', () => {
    assert.deepEqual(loadPresetCatalog('/definitely/not/here'), []);
});

test('pin hashing and tokens', () => {
    const h = hashPin('1234');
    assert.ok(checkPin('1234', h) && !checkPin('1235', h) && !checkPin('1234', 'garbage'));
    let now = 1000;
    const tk = createTokens('k'.repeat(32), () => now);
    const { token } = tk.issue(5, 'a@b.c');
    assert.ok(tk.verify(token, 5, 'a@b.c'));
    assert.ok(!tk.verify(token, 6, 'a@b.c') && !tk.verify(token, 5, 'x@b.c'));
    now += 31 * 24 * 3600 * 1000;
    assert.ok(!tk.verify(token, 5, 'a@b.c'), 'expired');
});
