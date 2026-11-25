'use strict';
// Admin = admin login AND the unlocked owner profile (OWNER_PROFILE_NAME). Run: node --test server/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require('jose');
const { openDb } = require('../db');
const { createAuth } = require('../auth');
const { registerProfileRoutes } = require('../profile_routes');
const { hashPin } = require('../profiles');

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-1';
const ADMIN = 'owner@example.com';
const MEMBER = 'friend@example.com';

async function boot({ ownerName = 'Owner', ownerPin = '1234' } = {}) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1', use: 'sig' };
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const db = openDb(dataPath, ':memory:');
    const ins = db.raw.prepare('INSERT INTO profiles (name, pin_hash, created_at, sort) VALUES (?, ?, ?, ?) RETURNING id');
    const owner = ins.get('Owner', ownerPin ? hashPin(ownerPin) : null, 'x', 0).id;
    const guest = ins.get('Guest', null, 'x', 1).id;
    const auth = createAuth({ db, env: { CF_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN }, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const app = express();
    app.use(express.json());
    app.use('/api', auth.requireLogin);
    app.get('/api/me', (req, res) => res.json({ isAdmin: req.login.isAdmin }));
    app.get('/api/admin/ping', auth.requireAdmin, (_req, res) => res.json({ ok: true }));
    const api = registerProfileRoutes(app, { db, secret: 's'.repeat(32), dataPath, ownerName, adminEmails: [ADMIN], presetDir: dataPath });
    if (api.adminProfileGate) auth.setAdminProfileGate(api.adminProfileGate);
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const jwt = (email) => new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(`https://${TEAM}`).setAudience(AUD).setExpirationTime('5m').sign(privateKey);
    const call = async (method, url, { email = ADMIN, headers = {}, body } = {}) => {
        const res = await fetch(base + url, {
            method,
            headers: { 'content-type': 'application/json', 'cf-access-jwt-assertion': await jwt(email), ...headers },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    const unlock = async (id, pin, email = ADMIN) => (await call('POST', `/api/profiles/${id}/unlock`, { email, body: { pin } })).json.token;
    const isAdmin = async (opts) => (await call('GET', '/api/me', opts)).json.isAdmin;
    return { call, unlock, isAdmin, owner, guest, db, close: () => server.close() };
}

test('admin login on the unlocked owner profile is admin (header or cookie)', async () => {
    const t = await boot();
    const token = await t.unlock(t.owner, '1234');
    assert.ok(token);
    assert.equal(await t.isAdmin({ headers: { 'x-profile-id': String(t.owner), 'x-profile-token': token } }), true);
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}; cinema_ptok=${encodeURIComponent(token)}` } }), true);
    assert.equal((await t.call('GET', '/api/admin/ping', { headers: { cookie: `cinema_pid=${t.owner}; cinema_ptok=${token}` } })).status, 200);
    t.close();
});

test('admin login without the owner profile, or without its PIN token, is not admin', async () => {
    const t = await boot();
    assert.equal(await t.isAdmin({}), false, 'no profile');
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}` } }), false, 'owner profile, no token');
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}; cinema_ptok=${t.owner}.9999999999999.forged` } }), false, 'forged token');
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.guest}` } }), false, 'another profile');
    assert.equal(await t.isAdmin({ headers: { cookie: 'cinema_pid=%E0%A4%A; cinema_ptok=%E0%A4%A' } }), false, 'malformed cookie');
    assert.equal((await t.call('GET', '/api/admin/ping', { headers: { cookie: `cinema_pid=${t.guest}` } })).status, 403);
    t.close();
});

test('a non-admin login is never admin, even on the unlocked owner profile', async () => {
    const t = await boot();
    const token = await t.unlock(t.owner, '1234', MEMBER);
    assert.equal(await t.isAdmin({ email: MEMBER, headers: { cookie: `cinema_pid=${t.owner}; cinema_ptok=${token}` } }), false);
    t.close();
});

test('a newer profile renamed to the owner name does not become the owner profile', async () => {
    const t = await boot();
    assert.equal((await t.call('PATCH', `/api/profiles/${t.guest}`, { email: MEMBER, body: { name: 'owner' } })).status, 200);
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.guest}` } }), false);
    t.close();
});

test('a token issued to another login does not unlock the owner profile for the admin', async () => {
    const t = await boot();
    const token = await t.unlock(t.owner, '1234', MEMBER);
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}; cinema_ptok=${token}` } }), false);
    t.close();
});

test('owner profile without a PIN: selecting it is enough for the admin login', async () => {
    const t = await boot({ ownerPin: null });
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}` } }), true);
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.guest}` } }), false);
    t.close();
});

test('no OWNER_PROFILE_NAME: admin by login email alone (previous behaviour)', async () => {
    const t = await boot({ ownerName: '' });
    assert.equal(await t.isAdmin({}), true);
    assert.equal(await t.isAdmin({ email: MEMBER }), false);
    t.close();
});

test('OWNER_PROFILE_NAME set but no such profile: nobody is admin (fails closed)', async () => {
    const t = await boot({ ownerName: 'Nobody' });
    assert.equal(await t.isAdmin({ headers: { cookie: `cinema_pid=${t.owner}` } }), false);
    t.close();
});
