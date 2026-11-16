'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../../../server/db');
const { createTmdb } = require('../../../server/tmdb');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');

// fake TMDB: The Matrix (603) in collection 2344 with three parts; part 4 has no IMDb id yet
function fakeTmdb() {
    const calls = [];
    const fetchJson = async (path) => {
        calls.push(path);
        if (path === '/find/tt0133093') return { movie_results: [{ id: 603 }], tv_results: [] };
        if (path === '/find/tt0000001') return { movie_results: [{ id: 9 }], tv_results: [] };
        if (path === '/movie/603') return { id: 603, belongs_to_collection: { id: 2344, name: 'The Matrix Collection' } };
        if (path === '/movie/9') return { id: 9, belongs_to_collection: null };
        if (path === '/collection/2344') {
            return { name: 'The Matrix Collection', parts: [
                { id: 605, title: 'The Matrix Revolutions', release_date: '2003-11-05', poster_path: '/r.jpg', vote_average: 6.7 },
                { id: 603, title: 'The Matrix', release_date: '1999-03-30', poster_path: '/m.jpg', vote_average: 8.2 },
                { id: 604, title: 'The Matrix Reloaded', release_date: '2003-05-15', poster_path: null, vote_average: 7.0 },
                { id: 999, title: 'Matrix 5', release_date: '', poster_path: null },
            ] };
        }
        const m = /^\/movie\/(\d+)\/external_ids$/.exec(path);
        if (m) return { imdb_id: { 603: 'tt0133093', 604: 'tt0234215', 605: 'tt0242653' }[m[1]] || null };
        throw new Error('unexpected ' + path);
    };
    return { calls, fetchJson };
}

async function withServer(app, fn) {
    const srv = app.listen(0);
    try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('collectionFor: every part with an IMDb id, in release order, cached', async () => {
    const fake = fakeTmdb();
    const tmdb = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson });
    const c = await tmdb.collectionFor('tt0133093');
    assert.equal(c.name, 'The Matrix Collection');
    assert.deepEqual(c.items.map((m) => [m.id, m.year]), [['tt0133093', 1999], ['tt0234215', 2003], ['tt0242653', 2003]]);
    assert.equal(c.items[0].poster, 'https://image.tmdb.org/t/p/w342/m.jpg');
    const before = fake.calls.length;
    await tmdb.collectionFor('tt0133093');
    assert.equal(fake.calls.length, before, 'second lookup is cached');
    assert.equal(await tmdb.collectionFor('tt0000001'), null, 'not in a collection');
});

test('plugin: inactive without TMDB, route validates ids', async () => {
    const off = fakeCtx({ id: 'collections', app: express(), services: { tmdb: { configured: () => false } } });
    register(off.ctx);
    assert.match(off.disabled(), /TMDB_API_KEY/);

    const app = express();
    const tmdb = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fakeTmdb().fetchJson });
    const on = fakeCtx({ id: 'collections', app, services: { tmdb } });
    register(on.ctx);
    assert.equal(on.disabled(), null);
    await withServer(app, async (base) => {
        assert.equal((await fetch(`${base}/api/collections/movie/nope`)).status, 400);
        const body = await (await fetch(`${base}/api/collections/movie/tt0133093`)).json();
        assert.equal(body.collection.items.length, 3);
        assert.deepEqual(await (await fetch(`${base}/api/collections/movie/tt0000001`)).json(), { collection: null });
    });
});
