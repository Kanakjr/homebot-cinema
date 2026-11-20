'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../../../server/db');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register, parseRatings } = require('../server');

test('parseRatings: extracts Rotten Tomatoes, Popcorn, IMDb, Metacritic and Letterboxd', () => {
    const raw = {
        ids: { imdb: 'tt0111161' },
        type: 'movie',
        score: 89,
        ratings: [
            { source: 'imdb', value: 9.3, votes: 3000000 },
            { source: 'tomatoes', value: 89, fresh: 1, votes: 147 },
            { source: 'popcorn', value: 98, votes: 250000 },
            { source: 'metacritic', value: 82, votes: 22 },
            { source: 'letterboxd', value: 4.6, votes: 3200000 },
        ],
    };
    const parsed = parseRatings(raw);
    assert.equal(parsed.id, 'tt0111161');
    assert.equal(parsed.type, 'movie');
    assert.equal(parsed.score, 89);
    assert.deepEqual(parsed.tomatoes, { score: 89, fresh: true, votes: 147 });
    assert.deepEqual(parsed.popcorn, { score: 98, fresh: true, votes: 250000 });
    assert.deepEqual(parsed.imdb, { score: 9.3, votes: 3000000 });
    assert.deepEqual(parsed.metacritic, { score: 82, votes: 22 });
    assert.deepEqual(parsed.letterboxd, { score: 4.6, votes: 3200000 });
});

test('register: inactive without MDBLIST_API_KEY', () => {
    const app = express();
    const { ctx, disabled } = fakeCtx({ id: 'mdblist', app, env: {} });
    register(ctx);
    assert.equal(disabled(), 'MDBLIST_API_KEY is not set');
});

test('routes: validates input and caches results in SQLite', async () => {
    const app = express();
    app.use(express.json());
    const db = openDb(':memory:', ':memory:');
    const { ctx } = fakeCtx({
        id: 'mdblist',
        app,
        db,
        env: { MDBLIST_API_KEY: 'test-key' },
    });
    register(ctx);
    const srv = app.listen(0);

    try {
        const base = `http://127.0.0.1:${srv.address().port}`;
        // bad type
        assert.equal((await fetch(`${base}/api/mdblist/book/tt0111161`)).status, 400);
        // bad imdb id
        assert.equal((await fetch(`${base}/api/mdblist/movie/badid`)).status, 400);

        // Pre-populate DB cache
        db.raw.prepare(`
            INSERT INTO mdblist_ratings (imdb_id, type, score, tomatoes, tomatoes_fresh, popcorn, imdb, metacritic, letterboxd, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('tt0111161', 'movie', 89, 89, 1, 98, 9.3, 82, 4.6, Date.now());

        // Single lookup reads from cache
        const single = await (await fetch(`${base}/api/mdblist/movie/tt0111161`)).json();
        assert.equal(single.rating.id, 'tt0111161');
        assert.equal(single.rating.tomatoes.score, 89);
        assert.equal(single.rating.popcorn.score, 98);

        // Batch lookup reads from cache
        const batch = await (await fetch(`${base}/api/mdblist/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ['tt0111161'] }),
        })).json();
        assert.equal(batch.ratings['tt0111161'].score, 89);
        assert.equal(batch.ratings['tt0111161'].tomatoes.score, 89);
    } finally {
        srv.close();
    }
});
