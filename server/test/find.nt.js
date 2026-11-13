'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../db');
const { createTmdb, httpFetchJson, DEFAULT_API } = require('../smart/tmdb');
const { registerFindRoutes, parseFilters } = require('../smart/routes');

const GENRES_MOVIE = [{ id: 99, name: 'Documentary' }, { id: 18, name: 'Drama' }, { id: 28, name: 'Action' }];
const GENRES_TV = [{ id: 99, name: 'Documentary' }, { id: 10759, name: 'Action & Adventure' }];

// a fake TMDB: records every call, serves canned data
function fakeTmdb({ results, externalIds = {} } = {}) {
    const calls = [];
    const fetchJson = async (path, query = {}) => {
        calls.push({ path, query });
        if (path === '/genre/movie/list') return { genres: GENRES_MOVIE };
        if (path === '/genre/tv/list') return { genres: GENRES_TV };
        if (path === '/watch/providers/movie') return { results: [{ provider_id: 119, provider_name: 'Amazon Prime Video', display_priorities: { IN: 2 }, logo_path: '/p.jpg' }, { provider_id: 8, provider_name: 'Netflix', display_priorities: { IN: 1 }, logo_path: '/n.jpg' }] };
        if (path.startsWith('/discover/')) return { page: query.page, total_pages: 3, total_results: 55, results: results || [] };
        const m = /^\/(movie|tv)\/(\d+)\/external_ids$/.exec(path);
        if (m) {
            const v = externalIds[m[2]];
            if (v === 404) throw Object.assign(new Error('tmdb_http_404'), { status: 502, tmdbStatus: 404 });
            return { imdb_id: v };
        }
        throw new Error('unexpected ' + path);
    };
    return { calls, fetchJson };
}

const row = (id, name, extra = {}) => ({ id, title: name, name, vote_average: 8.04, vote_count: 900, release_date: '2020-05-01', poster_path: `/${id}.jpg`, original_language: 'en', overview: 'x', ...extra });

test('"top-rated documentaries on Netflix" becomes the right TMDB discover query', async () => {
    const fake = fakeTmdb({ results: [row(1, 'Doc One')], externalIds: { 1: 'tt0000001' } });
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson, region: 'IN' });
    const r = await t.discover({ type: 'movie', genres: ['documentary'], providers: [8], minRating: 7.5, minVotes: 200, sort: 'rating', region: 'IN', page: 1 });
    const q = fake.calls.find((c) => c.path === '/discover/movie').query;
    assert.equal(q.with_genres, '99');
    assert.equal(q.with_watch_providers, '8');
    assert.equal(q.watch_region, 'IN');
    assert.equal(q.with_watch_monetization_types, 'flatrate|free|ads');
    assert.equal(q['vote_average.gte'], 7.5);
    assert.equal(q['vote_count.gte'], 200);
    assert.equal(q.sort_by, 'vote_average.desc');
    assert.equal(q.include_adult, 'false');
    assert.deepEqual(r.items[0], { id: 'tt0000001', tmdbId: 1, type: 'movie', name: 'Doc One', year: 2020, poster: 'https://image.tmdb.org/t/p/w342/1.jpg', rating: 8, votes: 900, overview: 'x', language: 'en', genreIds: [] });
    assert.equal(r.totalPages, 3);
});

test('series use the tv endpoint, tv genre names and first_air_date; several providers mean "any of them"', async () => {
    const fake = fakeTmdb({ results: [] });
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson });
    await t.discover({ type: 'series', genres: ['Action & Adventure'], providers: [8, 119], yearFrom: 2015, yearTo: 2020, lang: 'ko', maxRuntime: 60, sort: 'newest', page: 2 });
    const q = fake.calls.find((c) => c.path === '/discover/tv').query;
    assert.equal(q.with_genres, '10759');
    assert.equal(q.with_watch_providers, '8|119');
    assert.equal(q['first_air_date.gte'], '2015-01-01');
    assert.equal(q['first_air_date.lte'], '2020-12-31');
    assert.equal(q.with_original_language, 'ko');
    assert.equal(q['with_runtime.lte'], 60);
    assert.equal(q.sort_by, 'first_air_date.desc');
    assert.equal(q.page, 2);
    await assert.rejects(() => t.discover({ type: 'series', genres: ['Action'] }), /unknown_genre:Action/, 'a genre that does not exist for tv must not widen the search');
});

test('IMDb ids are looked up once and remembered; titles without an IMDb id are hidden and counted', async () => {
    const fake = fakeTmdb({ results: [row(1, 'A'), row(2, 'B'), row(3, 'C'), row(4, 'D')], externalIds: { 1: 'tt0000001', 2: null, 3: 404, 4: 'not-an-id' } });
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson });
    const r1 = await t.discover({ type: 'movie', page: 1 });
    assert.deepEqual(r1.items.map((i) => i.id), ['tt0000001']);
    assert.equal(r1.hidden, 3);
    const lookups = () => fake.calls.filter((c) => /external_ids/.test(c.path)).length;
    assert.equal(lookups(), 4);
    const r2 = await t.discover({ type: 'movie', page: 1, sort: 'popularity' }); // different query, same titles
    assert.equal(r2.items.length, 1);
    assert.equal(lookups(), 4, 'all four are in SQLite now, including the ones TMDB has no IMDb id for');
});

test('the lookups after 30 days are retried for titles that had no IMDb id, never for ones that did', async () => {
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const fake = fakeTmdb({ results: [row(1, 'A'), row(2, 'B')], externalIds: { 1: 'tt0000001', 2: null } });
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson, now: () => clock });
    await t.discover({ type: 'movie', page: 1 });
    clock += 31 * 24 * 3600 * 1000;
    await t.discover({ type: 'movie', page: 1, sort: 'votes' });
    const ids = fake.calls.filter((c) => /external_ids/.test(c.path)).map((c) => c.path);
    assert.equal(ids.filter((p) => p.includes('/1/')).length, 1);
    assert.equal(ids.filter((p) => p.includes('/2/')).length, 2);
});

test('options: genres per type, providers for the region ordered by popularity there; cached for a day', async () => {
    const fake = fakeTmdb();
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson });
    const o = await t.options();
    assert.equal(o.region, 'IN');
    assert.deepEqual(o.providers.map((p) => p.name), ['Netflix', 'Amazon Prime Video']);
    assert.equal(o.providers[0].logo, 'https://image.tmdb.org/t/p/w92/n.jpg');
    assert.equal(o.genres.series[1].name, 'Action & Adventure');
    await t.options();
    assert.equal(fake.calls.filter((c) => c.path === '/genre/movie/list').length, 1);
});

test('the API key goes in a header for v4 tokens and in the query for v3 keys, and never appears in errors', async () => {
    const real = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, init) => { seen.push({ url: String(url), headers: init.headers }); return { ok: false, status: 401, json: async () => ({}) }; };
    try {
        const v3 = httpFetchJson('abc123secretkey');
        await assert.rejects(() => v3('/genre/movie/list'), (e) => e.message === 'tmdb_auth_failed' && !e.message.includes('abc123') && e.status === 502);
        assert.match(seen[0].url, /api_key=abc123secretkey/);
        assert.ok(seen[0].url.startsWith('https://api.tmdb.org/3/genre/movie/list'), 'default host is the alternate domain that is not blocked by some ISPs');
        assert.equal(DEFAULT_API, 'https://api.tmdb.org/3');
        assert.throws(() => httpFetchJson('k', 'http://insecure.example/3'), /https/, 'the key is never sent over plain http');
        const v4 = httpFetchJson('eyJhbGciOi.payload.sig');
        await assert.rejects(() => v4('/genre/movie/list'));
        assert.ok(!seen[1].url.includes('eyJ'), 'v4 token is not put in the URL');
        assert.equal(seen[1].headers.Authorization, 'Bearer eyJhbGciOi.payload.sig');
        globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED api_key=abc123secretkey'); };
        await assert.rejects(() => v3('/x'), (e) => e.message === 'tmdb_unreachable');
        let n = 0;
        globalThis.fetch = async () => { n++; if (n === 1) throw new Error('ETIMEDOUT'); return { ok: true, status: 200, json: async () => ({ fine: true }) }; };
        assert.deepEqual(await v3('/y'), { fine: true }, 'one failed attempt is retried');
        assert.equal(n, 2);
        n = 0;
        globalThis.fetch = async () => { n++; return { ok: false, status: 404, json: async () => ({}) }; };
        await assert.rejects(() => v3('/z'), (e) => e.message === 'tmdb_http_404');
        assert.equal(n, 1, 'an answer from TMDB is never retried');
    } finally { globalThis.fetch = real; }
});

test('parseFilters validates everything it forwards to TMDB', () => {
    const ok = parseFilters({ type: 'series', genre: 'Documentary, Crime', provider: '8,119', minRating: '7.5', minVotes: '200', yearFrom: '2010', lang: 'ja', sort: 'votes', page: '2', region: 'US' });
    assert.deepEqual(ok.genres, ['Documentary', 'Crime']);
    assert.deepEqual(ok.providers, [8, 119]);
    assert.equal(ok.minRating, 7.5);
    assert.equal(ok.region, 'US');
    assert.equal(ok.page, 2);
    const d = parseFilters({}, 'IN');
    assert.deepEqual([d.type, d.sort, d.region, d.page], ['movie', 'rating', 'IN', 1]);
    for (const q of [{ type: 'tv' }, { minRating: '11' }, { minRating: 'x' }, { minVotes: '1.5' }, { sort: 'drop table' }, { lang: 'EN' }, { region: 'india' }, { provider: '8,abc' }, { provider: '1,2,3,4,5,6,7,8,9' }, { genre: 'a<script>' }, { page: '501' }, { yearFrom: '2020', yearTo: '2010' }]) {
        assert.throws(() => parseFilters(q), (e) => e.status === 400, JSON.stringify(q));
    }
});

async function boot(tmdb, library) {
    const app = express();
    registerFindRoutes(app, { tmdb, library });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const get = async (url) => { const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`); return { status: res.status, json: await res.json(), headers: res.headers }; };
    return { get, close: () => server.close() };
}

test('routes: not configured, bad input, TMDB failure, and the "On server" flag', async () => {
    const lib = { imdbIdsOnServer: () => new Set(['tt0000001']) };
    const off = await boot(createTmdb({ raw: openDb(':memory:', ':memory:').raw }), lib);
    assert.deepEqual((await off.get('/api/find/options')).json, { configured: false });
    const r = await off.get('/api/find?genre=Documentary');
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'tmdb_not_configured');
    off.close();

    const fake = fakeTmdb({ results: [row(1, 'On Disk'), row(2, 'Elsewhere')], externalIds: { 1: 'tt0000001', 2: 'tt0000002' } });
    const on = await boot(createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: fake.fetchJson }), lib);
    const ok = await on.get('/api/find?genre=Documentary&provider=8&minRating=7.5');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.items.map((i) => [i.name, i.onServer]), [['On Disk', true], ['Elsewhere', false]]);
    assert.match(ok.headers.get('cache-control'), /no-store/);
    assert.equal((await on.get('/api/find?minRating=99')).status, 400);
    assert.equal((await on.get('/api/find?genre=Nonexistent')).json.error, 'unknown_genre:Nonexistent');
    assert.equal((await on.get('/api/find/options?region=xx')).status, 400);
    assert.equal((await on.get('/api/find/options')).json.providers[0].name, 'Netflix');
    on.close();

    const broken = await boot(createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: async () => { throw Object.assign(new Error('tmdb_auth_failed'), { status: 502 }); } }), lib);
    const bad = await broken.get('/api/find');
    assert.equal(bad.status, 502);
    assert.equal(bad.json.error, 'tmdb_auth_failed');
    broken.close();
});
