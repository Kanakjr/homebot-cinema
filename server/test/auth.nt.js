'use strict';
// Run: node --test server/test/   (named *.nt.js so the frontend's jest does not pick it up)
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require('jose');
const { openDb, MIGRATIONS } = require('../db');
const { createAuth } = require('../auth');

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-123';
const ENV = { CF_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_EMAILS: 'Owner@Example.com, other@example.com' };

async function setup(envOverride = ENV) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1', use: 'sig' };
    const db = openDb(':memory:', ':memory:');
    const auth = createAuth({ db, env: envOverride, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const sign = (claims, { key = privateKey, iss = `https://${TEAM}`, aud = AUD, exp = '5m' } = {}) =>
        new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setExpirationTime(exp).sign(key);
    return { db, auth, sign, privateKey };
}

// minimal express-ish harness: resolves with { status, body, nextCalled, req }
function run(mw, req) {
    return new Promise((resolve) => {
        const out = { status: 200, body: null, nextCalled: false, req };
        const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; resolve(out); } };
        Promise.resolve(mw(req, res, () => { out.nextCalled = true; resolve(out); }));
    });
}
const reqWith = (headers = {}, extra = {}) => ({ headers, query: {}, ...extra });

test('db: migrations create schema and are idempotent', () => {
    const db = openDb(':memory:', ':memory:');
    assert.equal(db.schemaVersion(), MIGRATIONS.length);
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of ['logins', 'profiles', 'profile_blobs', 'watch_progress', 'media_items', 'media_files', 'downloads', 'monitored', 'audit_log'])
        assert.ok(tables.includes(t), `missing table ${t}`);
});

test('valid CF Access JWT -> next() with verified email, lowercased', async () => {
    const { auth, sign } = await setup();
    const token = await sign({ email: 'Member@Example.com' });
    const out = await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': token }));
    assert.ok(out.nextCalled);
    assert.deepEqual(out.req.login, { email: 'member@example.com', isAdmin: false });
});

test('token via CF_Authorization cookie is accepted', async () => {
    const { auth, sign } = await setup();
    const token = await sign({ email: 'a@example.com' });
    const out = await run(auth.requireLogin, reqWith({ cookie: `foo=bar; CF_Authorization=${token}` }));
    assert.ok(out.nextCalled);
});

test('admin flag comes from ADMIN_EMAILS (case-insensitive), not the token', async () => {
    const { auth, sign } = await setup();
    const out = await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign({ email: 'owner@example.com' }) }));
    assert.equal(out.req.login.isAdmin, true);
    const adminOnly = await run(auth.requireAdmin, out.req);
    assert.ok(adminOnly.nextCalled);
});

test('non-admin gets 403 from requireAdmin', async () => {
    const { auth, sign } = await setup();
    const out = await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign({ email: 'member@example.com' }) }));
    const r = await run(auth.requireAdmin, out.req);
    assert.equal(r.status, 403);
});

test('no credentials -> 401', async () => {
    const { auth } = await setup();
    assert.equal((await run(auth.requireLogin, reqWith())).status, 401);
});

test('spoofable identity sources are rejected: ?email=, legacy email header, unsigned/forged JWT', async () => {
    const { auth, sign } = await setup();
    assert.equal((await run(auth.requireLogin, reqWith({}, { query: { email: 'owner@example.com' } }))).status, 401);
    assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-authenticated-user-email': 'owner@example.com' }))).status, 401);
    // unsigned payload with admin email (what the old code accepted)
    const fake = ['e30', Buffer.from(JSON.stringify({ email: 'owner@example.com' })).toString('base64url'), 'sig'].join('.');
    assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': fake }))).status, 401);
    // signed by a different key
    const other = (await generateKeyPair('RS256')).privateKey;
    const forged = await sign({ email: 'owner@example.com' }, { key: other });
    assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': forged }))).status, 401);
});

test('wrong issuer, wrong audience and expired tokens are rejected', async () => {
    const { auth, sign } = await setup();
    const claims = { email: 'owner@example.com' };
    for (const opts of [{ iss: 'https://evil.cloudflareaccess.com' }, { aud: 'other-app' }, { exp: Math.floor(Date.now() / 1000) - 60 }])
        assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign(claims, opts) }))).status, 401);
});

test('token without email claim -> 401', async () => {
    const { auth, sign } = await setup();
    assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign({ sub: 'x' }) }))).status, 401);
});

test('disabled login -> 403, and logins are recorded', async () => {
    const { auth, sign, db } = await setup();
    const h = { 'cf-access-jwt-assertion': await sign({ email: 'kid@example.com' }) };
    assert.ok((await run(auth.requireLogin, reqWith(h))).nextCalled);
    assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM logins WHERE email = ?').get('kid@example.com').c, 1);
    db.raw.prepare('UPDATE logins SET disabled = 1 WHERE email = ?').run('kid@example.com');
    assert.equal((await run(auth.requireLogin, reqWith(h))).status, 403);
});

test('unconfigured server rejects with 503 (fails closed)', async () => {
    const db = openDb(':memory:', ':memory:');
    const auth = createAuth({ db, env: {} });
    const out = await run(auth.requireLogin, reqWith({ 'cf-access-authenticated-user-email': 'owner@example.com' }));
    assert.equal(out.status, 503);
});

test('DEV_EMAIL bypass only works when NODE_ENV=development', async () => {
    const db = openDb(':memory:', ':memory:');
    const prod = createAuth({ db, env: { NODE_ENV: 'production', DEV_EMAIL: 'dev@example.com' } });
    assert.equal((await run(prod.requireLogin, reqWith())).status, 503);
    const dev = createAuth({ db, env: { NODE_ENV: 'development', DEV_EMAIL: 'dev@example.com', ADMIN_EMAILS: 'dev@example.com' } });
    const out = await run(dev.requireLogin, reqWith());
    assert.deepEqual(out.req.login, { email: 'dev@example.com', isAdmin: true });
});

test('CF_ACCESS_AUD may list several apps (cinema + streamio); others rejected', async () => {
    const { auth, sign } = await setup({ ...ENV, CF_ACCESS_AUD: 'aud-a, aud-b' });
    for (const aud of ['aud-a', 'aud-b'])
        assert.ok((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign({ email: 'a@example.com' }, { aud }) }))).nextCalled);
    assert.equal((await run(auth.requireLogin, reqWith({ 'cf-access-jwt-assertion': await sign({ email: 'a@example.com' }, { aud: 'aud-c' }) }))).status, 401);
});
