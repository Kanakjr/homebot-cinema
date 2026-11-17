'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../../../server/db');
const { createTmdb } = require('../../../server/tmdb');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');

const IMDB = { 1: 'tt0000001', 2: 'tt0000002', 3: 'tt0000003', 4: 'tt0000004' };
function fakeTmdb() {
    const calls = [];
    const fetchJson = async (path) => {
        calls.push(path);
        if (path === '/find/tt0000001') return { movie_results: [{ id: 1 }], tv_results: [] };
        if (path === '/movie/1/recommendations') return { results: [
            { id: 2, title: 'Two', release_date: '2010-01-01', poster_path: '/2.jpg', vote_average: 7.55, genre_ids: [] },
            { id: 1, title: 'Itself', poster_path: '/1.jpg' },
            { id: 3, title: 'No poster', poster_path: null },
            { id: 4, title: 'No imdb', release_date: '2011-01-01', poster_path: '/4.jpg' },
        ] };
        if (path === '/movie/1/similar') return { results: [{ id: 2, title: 'Two', poster_path: '/2.jpg' }, { id: 5, title: 'Five', release_date: '2012-01-01', poster_path: '/5.jpg', vote_average: 6 }] };
        const m = /^\/movie\/(\d+)\/external_ids$/.exec(path);
        if (m) return { imdb_id: { 2: 'tt0000002', 5: 'tt0000005' }[m[1]] || null };
        throw new Error('unexpected ' + path);
    };
    return { calls, fetchJson };
}
const mk = (fake) => createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson, apiKey: 'k' });

test('similarFor: recommendations then similar, no self, no poster-less, no IMDb-less, deduped, cached', async () => {
    const fake = fakeTmdb();
    const tmdb = mk(fake);
    const r = await tmdb.similarFor('tt0000001', 'movie');
    assert.deepEqual(r.items.map((i) => i.id), ['tt0000002', 'tt0000005']);
    assert.equal(r.items[0].rating, 7.6);
    assert.equal(r.items[0].type, 'movie');
    const before = fake.calls.length;
    await tmdb.similarFor('tt0000001', 'movie');
    assert.equal(fake.calls.length, before);
});

test('route: validates type and id, returns items', async () => {
    const app = express();
    const { ctx } = fakeCtx({ id: 'similar', app, services: { tmdb: mk(fakeTmdb()) } });
    register(ctx);
    const srv = app.listen(0);
    try {
        const base = `http://127.0.0.1:${srv.address().port}`;
        assert.equal((await fetch(`${base}/api/similar/book/tt0000001`)).status, 400);
        assert.equal((await fetch(`${base}/api/similar/movie/nope`)).status, 400);
        const j = await (await fetch(`${base}/api/similar/movie/tt0000001`)).json();
        assert.equal(j.items.length, 2);
    } finally { srv.close(); }
});
