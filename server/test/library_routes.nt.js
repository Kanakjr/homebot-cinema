'use strict';
// Run: NODE_PATH=<dir with express> node --test server/test/library_routes.nt.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { openDb } = require('../db');
const { Library } = require('../library/library');
const { registerLibraryRoutes } = require('../library/routes');

async function boot() {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'libr-')));
    const T = path.join(base, 'TV');
    const file = path.join(T, 'Silo - S01E01', 'Season 1', 'Silo.S01E01.1080p.mkv');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const db = openDb(base, ':memory:');
    const library = new Library({
        db, roots: { movie: path.join(base, 'Movies'), series: T }, minBytes: 1,
        fetchJson: async (u) => (/meta\//.test(u) ? { meta: { name: 'Silo', year: '2023' } } : { metas: [{ id: 'tt14688458', imdb_id: 'tt14688458', name: 'Silo', releaseInfo: '2023–' }] }),
    });
    await library.scan();
    const cleaned = [];
    const app = express();
    app.use(express.json());
    app.use('/api', (req, _res, next) => {
        req.login = { email: 'u@example.com', isAdmin: req.headers['x-admin'] === '1' };
        next();
    });
    const requireAdmin = (req, res, next) => (req.login.isAdmin ? next() : res.status(403).json({ error: 'admin_only' }));
    registerLibraryRoutes(app, { library, db, requireAdmin, onFileDeleted: async (p) => { cleaned.push(p); } });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const call = async (method, url, { body, admin } = {}) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
            method, headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    return { call, file, cleaned, close: () => server.close() };
}

test('list / detail / by-imdb are available to any login', async () => {
    const t = await boot();
    const list = (await t.call('GET', '/api/library')).json;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].title, 'Silo');
    const id = list.items[0].id;
    assert.equal((await t.call('GET', `/api/library/${id}`)).json.seasons[0].episodes[0].episode, 1);
    assert.equal((await t.call('GET', '/api/library/by-imdb/tt14688458')).status, 200);
    assert.equal((await t.call('GET', '/api/library/by-imdb/tt0')).status, 404);
    const soft = await t.call('GET', '/api/library/by-imdb/tt0?soft=1');
    assert.equal(soft.status, 200, 'soft lookup never 404s');
    assert.equal(soft.json, null);
    assert.equal((await t.call('GET', '/api/library/99999')).status, 404);
    assert.equal((await t.call('GET', '/api/library/scan/status')).json.running, false);
    t.close();
});

test('every mutation is admin-only', async () => {
    const t = await boot();
    const id = (await t.call('GET', '/api/library')).json.items[0].id;
    const fileId = (await t.call('GET', `/api/library/${id}`)).json.seasons[0].episodes[0].files[0].id;
    for (const [m, u, body] of [['POST', '/api/library/scan'], ['DELETE', `/api/library/${id}`], ['DELETE', `/api/library/${id}/season/1`],
        ['DELETE', `/api/library/files/${fileId}`], ['POST', `/api/library/${id}/identify`, { imdbId: 'tt1375666' }]]) {
        assert.equal((await t.call(m, u, { body })).status, 403, `${m} ${u}`);
    }
    assert.ok(fs.existsSync(t.file), 'nothing was deleted');
    t.close();
});

test('admin can identify and delete; download cleanup hook is called with the path', async () => {
    const t = await boot();
    const id = (await t.call('GET', '/api/library')).json.items[0].id;
    assert.equal((await t.call('POST', `/api/library/${id}/identify`, { body: { imdbId: 'bad' }, admin: true })).status, 400);
    assert.equal((await t.call('POST', `/api/library/${id}/identify`, { body: { imdbId: 'tt14688458' }, admin: true })).status, 200);
    const fileId = (await t.call('GET', `/api/library/${id}`)).json.seasons[0].episodes[0].files[0].id;
    assert.equal((await t.call('DELETE', `/api/library/files/${fileId}`, { admin: true })).status, 200);
    assert.ok(!fs.existsSync(t.file));
    assert.deepEqual(t.cleaned, [t.file]);
    assert.equal((await t.call('GET', '/api/library')).json.items.length, 0);
    assert.equal((await t.call('DELETE', `/api/library/${id}`, { admin: true })).status, 404);
    t.close();
});
