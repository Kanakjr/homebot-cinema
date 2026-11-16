'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { register } = require('../server');
const { fakeCtx } = require('../../../server/plugins/testing');
const { openDb } = require('../../../server/db');
const { Library, COLD_MARKER } = require('../../../server/library/library');

test('inactive until extra roots are configured', () => {
    const { ctx, disabled, hooks } = fakeCtx({ id: 'gdrive', app: express() });
    register(ctx);
    assert.match(disabled(), /LIBRARY_EXTRA_MOVIES_DIRS/);
    assert.equal(hooks.count('library.roots'), 0);
});

test('provides cold roots to the core library through the library.roots hook', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-')));
    const touch = (p, n = 2) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(n)); };
    touch(path.join(base, 'Movies', 'Local.Film.2024.1080p.mkv'));
    touch(path.join(base, 'Drive', 'Cloud.Film.2020.1080p.mkv'));
    touch(path.join(base, 'Drive', COLD_MARKER), 0);
    fs.mkdirSync(path.join(base, 'TV'));
    const db = openDb(base, ':memory:');
    const app = express();
    let lib = null; // the core library reads the hook; the plugin's status route reads the library (late-bound for the test)
    const { ctx, hooks } = fakeCtx({
        id: 'gdrive', app, db, env: { LIBRARY_EXTRA_MOVIES_DIRS: path.join(base, 'Drive') },
        services: { library: { coldRootList: () => lib.coldRootList(), coldRootOnline: (r) => lib.coldRootOnline(r) } },
    });
    lib = new Library({
        db, roots: { movie: path.join(base, 'Movies'), series: path.join(base, 'TV') }, fetchJson: async () => ({ metas: [] }), minBytes: 1,
        extraRoots: () => ({ movie: hooks.collect('library.roots').flatMap((r) => r.movie || []), series: [] }),
    });
    register(ctx);
    assert.equal(hooks.count('library.roots'), 1);
    await lib.scan();
    assert.deepEqual(lib.list().items.map((i) => i.title).sort(), ['Cloud Film', 'Local Film']);

    const srv = app.listen(0);
    try {
        const r = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/gdrive/status`)).json();
        assert.deepEqual(r.roots, [{ path: path.join(base, 'Drive'), online: true }]);
    } finally { srv.close(); }
});

test('tiering plan fails closed when Transmission cannot be asked, and writes the plan into the plugin data dir', async () => {
    const db = openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'gdp-')), ':memory:');
    const lib = { coldRootList: () => [], roots: { movie: '/Movies', series: '/TV' } };
    const app = express();
    let torrents = () => { throw new Error('transmission down'); };
    const { ctx, dataPath } = fakeCtx({
        id: 'gdrive', app, db, env: { LIBRARY_EXTRA_TV_DIRS: '/GDriveTV' },
        services: { library: lib, downloads: { transmission: { getTorrents: async () => torrents() } }, sentinel: { monitored: {} } },
    });
    register(ctx);
    const srv = app.listen(0);
    const url = `http://127.0.0.1:${srv.address().port}/api/gdrive/tiering/plan`;
    try {
        let r = await fetch(url, { method: 'POST' });
        assert.equal(r.status, 503);
        torrents = () => [];
        r = await (await fetch(url, { method: 'POST' })).json();
        assert.equal(r.count, 0);
        assert.equal(r.planDir, path.join(dataPath, 'plugin-data', 'gdrive', 'tiering'));
        assert.ok(fs.existsSync(path.join(r.planDir, 'Movies.txt')));
    } finally { srv.close(); }
});
