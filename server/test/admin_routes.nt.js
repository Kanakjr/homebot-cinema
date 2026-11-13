'use strict';
// Run: NODE_PATH=<dir with express> node --test server/test/admin_routes.nt.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../db');
const { registerAdminRoutes } = require('../admin_routes');

async function boot() {
    const db = openDb(':memory:', ':memory:');
    db.touchLogin('admin@example.com');
    db.touchLogin('member@example.com');
    db.audit('admin@example.com', null, 'test.action', { a: 1 });
    const app = express();
    app.use(express.json());
    const admins = ['admin@example.com'];
    app.use('/api', (req, _res, next) => {
        const email = req.headers['x-email'] || 'member@example.com';
        req.login = { email, isAdmin: admins.includes(email) };
        next();
    });
    const auth = {
        requireAdmin: (req, res, next) => (req.login.isAdmin ? next() : res.status(403).json({ error: 'admin_only' })),
        isAdminEmail: (e) => admins.includes(e),
    };
    const library = {
        status: { running: false },
        list: () => ({ counts: { all: 2, movie: 1, series: 1, unmatched: 1 }, items: [{ id: 1, title: 'Big', type: 'movie', totalSize: 9, fileCount: 1, poster: null }, { id: 2, title: 'Small', type: 'series', totalSize: 1, fileCount: 3, poster: null }] }),
    };
    const downloadsManager = {
        getDiskStats: () => ({ totalBytes: 100, usedBytes: 40, freeBytes: 60 }),
        listDownloads: async () => ({ active: [{ id: 'd1', title: 'X', progress: 0.5, rateDownload: 10, status: 'downloading' }], completed: [{}, {}] }),
    };
    registerAdminRoutes(app, { db, auth, library, downloadsManager, sentinel: { getMonitored: () => [{ imdbId: 'tt1' }] }, streamingStats: async () => ({ torrents: 1 }) });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const call = async (method, url, { body, email = 'admin@example.com' } = {}) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'content-type': 'application/json', 'x-email': email }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    return { call, db, close: () => server.close() };
}

test('non-admins are refused everywhere under /api/admin', async () => {
    const t = await boot();
    for (const [m, u] of [['GET', '/api/admin/overview'], ['GET', '/api/admin/logins'], ['PATCH', '/api/admin/logins/member@example.com'], ['GET', '/api/admin/audit']]) {
        assert.equal((await t.call(m, u, { email: 'member@example.com', body: m === 'PATCH' ? { disabled: true } : undefined })).status, 403, `${m} ${u}`);
    }
    t.close();
});

test('overview aggregates storage, library, downloads, sentinel, streaming, people', async () => {
    const t = await boot();
    const o = (await t.call('GET', '/api/admin/overview')).json;
    assert.equal(o.storage.freeBytes, 60);
    assert.deepEqual([o.library.titles, o.library.unmatched, o.library.totalBytes, o.library.fileCount], [2, 1, 10, 4]);
    assert.equal(o.library.biggest[0].title, 'Big');
    assert.equal(o.downloads.active, 1);
    assert.equal(o.downloads.completed, 2);
    assert.equal(o.sentinel.monitoredShows, 1);
    assert.deepEqual(o.streaming, { torrents: 1 });
    assert.equal(o.people.logins, 2);
    t.close();
});

test('logins: list shows admin flag; disable/quota work; admins cannot be disabled; bad input rejected', async () => {
    const t = await boot();
    const list = (await t.call('GET', '/api/admin/logins')).json;
    assert.equal(list.find((l) => l.email === 'admin@example.com').isAdmin, true);
    assert.equal(list.find((l) => l.email === 'member@example.com').isAdmin, false);
    assert.equal((await t.call('PATCH', '/api/admin/logins/member@example.com', { body: { disabled: true, quotaGb: 50 } })).status, 200);
    const m = (await t.call('GET', '/api/admin/logins')).json.find((l) => l.email === 'member@example.com');
    assert.deepEqual([m.disabled, m.quotaGb], [true, 50]);
    assert.equal((await t.call('PATCH', '/api/admin/logins/admin@example.com', { body: { disabled: true } })).status, 409);
    assert.equal((await t.call('PATCH', '/api/admin/logins/member@example.com', { body: { quotaGb: 'lots' } })).status, 400);
    assert.equal((await t.call('PATCH', '/api/admin/logins/nobody@example.com', { body: { disabled: true } })).status, 404);
    assert.equal((await t.call('PATCH', '/api/admin/logins/member@example.com', { body: { quotaGb: null } })).status, 200);
    t.close();
});

test('audit log lists newest first with parsed payloads and records admin changes', async () => {
    const t = await boot();
    await t.call('PATCH', '/api/admin/logins/member@example.com', { body: { disabled: true } });
    const log = (await t.call('GET', '/api/admin/audit?limit=5')).json;
    assert.equal(log[0].action, 'login.update');
    assert.deepEqual(log[1].payload, { a: 1 });
    t.close();
});
