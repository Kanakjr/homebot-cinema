'use strict';
// TMDB additions used by the copilot: title search, IMDb -> TMDB lookup, title details, and the kids filter.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createTmdb, kidSafe } = require('../smart/tmdb');

const calls = [];
const GENRES = [{ id: 99, name: 'Documentary' }];
const fake = {
    'search/movie': { results: [
        { id: 1, title: 'Toy Story', genre_ids: [16, 10751, 35], vote_count: 18000, vote_average: 8.0, release_date: '1995-11-22', poster_path: '/ts.jpg', overview: 'toys' },
        { id: 2, title: 'Toy Horror', genre_ids: [27, 16], vote_count: 90, vote_average: 5.1, release_date: '2010-01-01', poster_path: null, overview: '' },
        { id: 3, title: 'Toy Drama', genre_ids: [18], vote_count: 500, vote_average: 7.0, release_date: '2012-01-01', poster_path: null, overview: '' },
    ] },
    'search/tv': { results: [{ id: 10, name: 'Toy Show', genre_ids: [10762], vote_count: 300, vote_average: 7.5, first_air_date: '2019-01-01', poster_path: '/s.jpg', overview: 'kids' }] },
    ids: { movie: { 1: 'tt0114709', 2: 'tt0000002', 3: 'tt0000003' }, tv: { 10: 'tt0000010' } },
    find: { tt0114709: { movie_results: [{ id: 1 }], tv_results: [] }, tt0000010: { movie_results: [], tv_results: [{ id: 10 }] }, tt9999999: { movie_results: [], tv_results: [] } },
};
const fetchJson = async (path, query = {}) => {
    calls.push({ path, query });
    if (path === '/genre/movie/list' || path === '/genre/tv/list') return { genres: GENRES };
    if (path === '/watch/providers/movie') return { results: [] };
    const s = /^\/search\/(movie|tv)$/.exec(path);
    if (s) return fake[`search/${s[1]}`];
    const e = /^\/(movie|tv)\/(\d+)\/external_ids$/.exec(path);
    if (e) return { imdb_id: fake.ids[e[1]][e[2]] };
    const f = /^\/find\/(tt\d+)$/.exec(path);
    if (f) return fake.find[f[1]];
    const d = /^\/(movie|tv)\/(\d+)$/.exec(path);
    if (d && d[1] === 'tv') {
        return {
            name: 'Toy Show', overview: 'o'.repeat(900), first_air_date: '2019-01-01', vote_average: 7.46, vote_count: 300, genres: [{ id: 10762, name: 'Kids' }],
            episode_run_time: [24], original_language: 'en', status: 'Returning Series', number_of_seasons: 3, number_of_episodes: 30, poster_path: '/s.jpg',
            next_episode_to_air: { season_number: 4, episode_number: 1, air_date: '2026-12-01' },
            'watch/providers': { results: { IN: { flatrate: [{ provider_name: 'Netflix' }], ads: [{ provider_name: 'MX Player' }], rent: [{ provider_name: 'Apple TV Store' }] }, US: { flatrate: [{ provider_name: 'Hulu' }] } } },
        };
    }
    if (d) return { title: 'Toy Story', overview: 'toys', release_date: '1995-11-22', vote_average: 7.97, vote_count: 18000, genres: [{ id: 16, name: 'Animation' }], runtime: 81, original_language: 'en', status: 'Released', poster_path: '/ts.jpg', 'watch/providers': { results: {} } };
    throw new Error('unexpected ' + path);
};
const mk = () => createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson });

test('search returns movies and series with IMDb ids, most voted first, and only the first 8 per kind', async () => {
    const r = await mk().search('toy');
    assert.deepEqual(r.items.map((i) => i.id), ['tt0114709', 'tt0000003', 'tt0000010', 'tt0000002'], 'ordered by votes: 18000, 500, 300, 90');
    assert.equal(r.items[0].type, 'movie');
    assert.equal(r.items[2].type, 'series');
    assert.equal(r.items[0].poster, 'https://image.tmdb.org/t/p/w342/ts.jpg');
    assert.deepEqual((await mk().search('toy', { type: 'series' })).items.map((i) => i.type), ['series'], 'type limits the kinds searched');
    assert.deepEqual((await mk().search('x')).items, [], 'a one-letter query is not sent to TMDB');
    assert.ok(calls.some((c) => c.path === '/search/movie' && c.query.include_adult === 'false'));
});

test('kids profiles only get child-friendly genres and nothing from the blocked ones', async () => {
    const r = await mk().search('toy', { kids: true });
    assert.deepEqual(r.items.map((i) => i.id).sort(), ['tt0000010', 'tt0114709'], 'horror and drama are dropped');
    assert.equal(kidSafe('movie', [16, 10751]), true);
    assert.equal(kidSafe('movie', [16, 27]), false, 'animated horror');
    assert.equal(kidSafe('movie', [18]), false);
    assert.equal(kidSafe('series', [10762]), true, 'the Kids genre only exists for series');
    assert.equal(kidSafe('movie', [10762]), false);
    assert.equal(kidSafe('movie', undefined), false);
});

test('kids discover queries are limited to a US rating of PG or lower for movies', async () => {
    const seen = [];
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, fetchJson: async (p, q) => { if (p.startsWith('/discover')) { seen.push({ p, q }); return { page: 1, total_pages: 1, total_results: 0, results: [] }; } return fetchJson(p, q); } });
    await t.discover({ type: 'movie', kids: true, page: 1 });
    await t.discover({ type: 'movie', page: 1 });
    assert.equal(seen[0].q.certification_country, 'US');
    assert.equal(seen[0].q['certification.lte'], 'PG');
    assert.equal(seen[1].q.certification_country, undefined);
});

test('byImdb finds the TMDB id and kind; an unknown id gives null; a bad id is refused', async () => {
    const t = mk();
    assert.deepEqual(await t.byImdb('tt0114709'), { kind: 'movie', tmdbId: 1, type: 'movie' });
    assert.deepEqual(await t.byImdb('tt0000010'), { kind: 'tv', tmdbId: 10, type: 'series' });
    assert.equal(await t.byImdb('tt9999999'), null);
    await assert.rejects(() => t.byImdb('../etc'), /invalid_imdb_id/);
});

test('details: runtime, genres, seasons, next episode and where it streams in the chosen region', async () => {
    const d = await mk().details('tv', 10, 'IN');
    assert.equal(d.type, 'series');
    assert.equal(d.runtimeMin, 24);
    assert.equal(d.seasons, 3);
    assert.deepEqual(d.nextEpisode, { season: 4, episode: 1, airDate: '2026-12-01' });
    assert.deepEqual(d.streamingIn, ['Netflix']);
    assert.deepEqual(d.freeIn, ['MX Player']);
    assert.deepEqual(d.rentOrBuyIn, ['Apple TV Store']);
    assert.equal(d.overview.length, 600, 'long overviews are cut');
    assert.equal(d.rating, 7.5);
    assert.deepEqual((await mk().details('tv', 10, 'US')).streamingIn, ['Hulu']);
    const m = await mk().details('movie', 1);
    assert.equal(m.runtimeMin, 81);
    assert.deepEqual(m.streamingIn, []);
});

test('without a key every new lookup says tmdb_not_configured', async () => {
    const t = createTmdb({ raw: openDb(':memory:', ':memory:').raw, apiKey: '' });
    for (const call of [() => t.search('toy story'), () => t.byImdb('tt0114709'), () => t.details('movie', 1)]) {
        await assert.rejects(call, (e) => e.message === 'tmdb_not_configured' && e.status === 503);
    }
});
