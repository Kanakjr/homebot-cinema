'use strict';
// The copilot's tools against fake TMDB / library / downloader, with the real quality profiles and real staging.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { QualityStore } = require('../grabber/store');
const { createStaging } = require('../ai/staging');
const { createTools } = require('../ai/tools');

const HASH = 'a'.repeat(40);
const DEAD = 'c'.repeat(40);
const stream = (hash, seeds = 300) => ({ name: 'StreamAddon\n1080p', title: `Movie.2026.1080p.WEB-DL.x264\n👤 ${seeds} 💾 2.1 GB`, infoHash: hash, fileIdx: 0 });
const item = (id, name, type = 'movie', extra = {}) => ({ id, type, name, year: 2020, rating: 8.1, votes: 5000, language: 'en', overview: 'An overview. '.repeat(30), poster: `https://img/${id}.jpg`, ...extra });

function world(over = {}) {
    const calls = { discover: [], search: [], stream: [], monitored: [] };
    const db = openDb(':memory:', ':memory:');
    const qualityStore = new QualityStore(db);
    const staging = createStaging();
    const onServer = new Set(['tt0000001']);
    const deps = {
        qualityStore, staging, region: 'IN',
        tmdb: {
            options: async () => ({ providers: [{ id: 8, name: 'Netflix' }, { id: 119, name: 'Amazon Prime Video' }], genres: { movie: [{ id: 35, name: 'Comedy' }], series: [{ id: 18, name: 'Drama' }] } }),
            discover: async (f) => {
                calls.discover.push(f);
                if (f.genres.includes('Nope')) throw Object.assign(new Error('unknown_genre:Nope'), { status: 400 });
                return { total: 42, items: [item('tt0000001', 'On Server Movie'), item('tt0000002', 'Other Movie')] };
            },
            search: async (q, o) => { calls.search.push({ q, o }); return { items: [item('tt0000003', 'Found It')] }; },
            byImdb: async (id) => (id === 'tt0000009' ? null : { kind: 'movie', tmdbId: 1, type: 'movie' }),
            details: async () => ({ type: 'movie', name: 'Detail Movie', year: 2021, rating: 7.4, votes: 900, overview: 'about', genres: ['Comedy'], genreIds: [35, 18], runtimeMin: 95, language: 'en', status: 'Released', seasons: null, episodes: null, nextEpisode: null, poster: 'p.jpg', streamingIn: ['Netflix'], freeIn: [], rentOrBuyIn: [], region: 'IN' }),
        },
        library: {
            imdbIdsOnServer: () => onServer,
            getByImdb: (id) => (onServer.has(id) ? { id: 7, type: 'movie', fileCount: 1, files: [{ resolution: '1080p', size: 2e9 }] } : null),
            episodeIds: () => ['tt0000020:1:1'],
            list: () => ({ counts: { all: 1, movie: 1, series: 0, unmatched: 0 }, items: [{ imdbId: 'tt0000001', type: 'movie', title: 'On Server Movie', year: 2020, poster: 'p', id: 7, totalSize: 2e9, lastAdded: '2026-11-01' }] }),
        },
        downloadsManager: { checkMedia: async (id) => (id === 'tt0000005' ? { status: 'downloading', downloaded: false, progress: 0.4 } : { downloaded: false }), listDownloads: async () => ({ active: [{ title: 'Silo S02E05', status: 'downloading', progress: 0.4, eta: 300 }], completed: [], disk: { freeGB: 400, totalGB: 931 } }) },
        sentinel: { getMonitored: () => [{ imdbId: 'tt0000020', scopeLabel: 'New episodes only' }] },
        probeMany: async (items) => Object.fromEntries(items.map((i) => [i.infoHash.toLowerCase(), { verdict: i.infoHash === DEAD ? 'dead' : 'good' }])),
        fetchStreams: async (type, videoId) => { calls.stream.push({ type, videoId }); return over.streams || [stream(HASH)]; },
        fetchMeta: async (type, id) => (over.meta ? over.meta(type, id) : { name: type === 'series' ? 'Some Show' : 'Some Movie', poster: 'poster.jpg', year: '2024', videos: type === 'series' ? [{ season: 1, episode: 2, released: '2020-01-01T00:00:00Z' }, { season: 1, episode: 3, released: '2999-01-01T00:00:00Z' }] : [] }),
        history: () => [{ id: 'tt0000030', type: 'movie', name: 'Watched One', poster: 'w.jpg', lastWatched: Date.now() - 2 * 86400000, season: null, episode: null, progress: 0.5, finished: false }],
    };
    const tools = createTools(deps);
    const ctx = (extra = {}) => ({ profile: { id: 1, is_kid: 0 }, login: { email: 'a@example.com', isAdmin: false }, kids: false, catalog: new Map(), known: new Set(), titles: [], staged: [], ...extra });
    return { tools, deps, calls, staging, ctx };
}

test('find_titles maps service names to ids, defaults to 200+ votes, flags titles on the server and remembers them for cards', async () => {
    const w = world();
    const ctx = w.ctx();
    const r = await w.tools.run('find_titles', { type: 'movie', services: ['netflix'], genres: ['Comedy'], min_rating: 7.5 }, ctx);
    const f = w.calls.discover[0];
    assert.deepEqual(f.providers, [8]);
    assert.equal(f.minVotes, 200);
    assert.equal(f.minRating, 7.5);
    assert.equal(f.kids, false);
    assert.equal(f.region, 'IN');
    assert.equal(r.titles[0].on_server, true);
    assert.equal(r.titles[1].on_server, false);
    assert.ok(r.titles[0].overview.length <= 140, 'overviews are shortened for the model');
    assert.ok(ctx.known.has('tt0000001') && ctx.catalog.get('tt0000001').onServer === true);
});

test('find_titles tells the model when a service or genre does not exist instead of silently widening', async () => {
    const w = world();
    const a = await w.tools.run('find_titles', { type: 'movie', services: ['Disney+ Hotstar Plus'] }, w.ctx());
    assert.equal(a.error, 'service_not_available');
    assert.deepEqual(a.available_services, ['Netflix', 'Amazon Prime Video']);
    const b = await w.tools.run('find_titles', { type: 'movie', genres: ['Nope'] }, w.ctx());
    assert.match(b.error, /unknown_genre/);
    assert.deepEqual(b.valid_genres, ['Comedy']);
    assert.equal(w.calls.discover.length, 1, 'the bad service never reached TMDB');
});

test('kids profiles: searches carry the kids flag, and server, downloads and stage tools are refused', async () => {
    const w = world();
    const ctx = w.ctx({ kids: true, profile: { id: 2, is_kid: 1 } });
    await w.tools.run('find_titles', { type: 'movie' }, ctx);
    await w.tools.run('search_titles', { query: 'toy' }, ctx);
    assert.equal(w.calls.discover[0].kids, true);
    assert.equal(w.calls.search[0].o.kids, true);
    for (const [name, args] of [['get_server_library', {}], ['get_downloads', {}], ['stage_download', { imdb_id: 'tt0000004', type: 'movie' }], ['stage_monitor', { imdb_id: 'tt0000020', scope: 'new' }]]) {
        assert.equal((await w.tools.run(name, args, ctx)).error, 'not_available_for_kids_profile', name);
    }
    assert.equal(w.staging.list({ email: 'a@example.com', profileId: 2 }).length, 0);
    assert.equal(w.calls.stream.length, 0);
});

test('get_title for a kids profile hides titles that are not child-friendly', async () => {
    const w = world();
    const r = await w.tools.run('get_title', { imdb_id: 'tt0000004' }, w.ctx({ kids: true }));
    assert.equal(r.error, 'not_available_for_kids_profile', 'genres Comedy + Drama are not in the kid list');
    assert.equal((await w.tools.run('get_title', { imdb_id: 'tt0000009' }, w.ctx())).error, 'title_not_found');
    assert.match((await w.tools.run('get_title', { imdb_id: 'nope' }, w.ctx())).error, /imdb_id/);
});

test('get_title combines TMDB facts with the server library, downloads and monitors', async () => {
    const w = world();
    const ctx = w.ctx();
    const r = await w.tools.run('get_title', { imdb_id: 'tt0000001' }, ctx);
    assert.equal(r.title, 'Detail Movie');
    assert.equal(r.on_server, true);
    assert.deepEqual(r.on_server_files, [{ resolution: '1080p', size_gb: 2 }]);
    assert.deepEqual(r.streaming_in, ['Netflix']);
    assert.equal(ctx.catalog.get('tt0000001').libraryId, 7);
    const m = await w.tools.run('get_title', { imdb_id: 'tt0000020' }, ctx);
    assert.deepEqual(m.monitored, { scope: 'New episodes only' });
    const d = await w.tools.run('get_title', { imdb_id: 'tt0000005' }, ctx);
    assert.deepEqual(d.download, { status: 'downloading', progress_pct: 40 });
});

test('present_titles shows only ids the tools or the brief produced, never invented ones, once each', async () => {
    const w = world();
    const ctx = w.ctx();
    await w.tools.run('find_titles', { type: 'movie' }, ctx);
    const r = await w.tools.run('present_titles', { imdb_ids: ['tt0000001', 'tt0000002', 'tt0000001', 'tt6666666', '<script>'] }, ctx);
    assert.deepEqual(r.shown, ['tt0000001', 'tt0000002']);
    assert.deepEqual(r.refused_unknown_ids, ['tt6666666', '<script>']);
    assert.deepEqual(ctx.titles.map((t) => t.id), ['tt0000001', 'tt0000002']);
    assert.equal(ctx.titles[0].onServer, true);
    assert.equal(ctx.titles[0].libraryId, 7, 'cards for titles on the server can link to the library page');
    await w.tools.run('present_titles', { imdb_ids: ['tt0000001'] }, ctx);
    assert.equal(ctx.titles.length, 2, 'not shown twice');
});

test('server library, downloads and watch history tools return compact, model-friendly data', async () => {
    const w = world();
    const ctx = w.ctx();
    const lib = await w.tools.run('get_server_library', {}, ctx);
    assert.equal(lib.titles[0].size_gb, 2);
    assert.equal(lib.counts.movie, 1);
    const dl = await w.tools.run('get_downloads', {}, ctx);
    assert.deepEqual(dl.active[0], { title: 'Silo S02E05', status: 'downloading', progress_pct: 40, eta_seconds: 300 });
    assert.deepEqual(dl.disk, { free_gb: 400, total_gb: 931 });
    const h = await w.tools.run('get_watch_history', { limit: 5 }, ctx);
    assert.deepEqual(h.titles[0], { imdb_id: 'tt0000030', type: 'movie', title: 'Watched One', days_ago: 2, season: undefined, episode: undefined, progress_pct: 50, finished: false });
    assert.ok(ctx.known.has('tt0000030'));
});

test('stage_download picks a live release, stages it for the owner, and does not start anything', async () => {
    const w = world({ streams: [stream(DEAD, 5000), stream(HASH, 300)] });
    const ctx = w.ctx();
    const r = await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'movie' }, ctx);
    assert.equal(r.status, 'STAGED_PENDING_USER_CONFIRMATION');
    assert.equal(r.resolution, '1080p');
    assert.equal(r.peers, 'good', 'the dead swarm with more seeders was skipped');
    assert.equal(ctx.staged.length, 1);
    assert.equal(ctx.staged[0].card.title, 'Some Movie');
    assert.equal(ctx.staged[0].status, 'PENDING_CONFIRMATION');
    assert.deepEqual(w.calls.stream, [{ type: 'movie', videoId: 'tt0000004' }]);
    const mine = w.staging.list({ email: 'a@example.com', profileId: 1 });
    assert.equal(mine.length, 1);
    assert.equal(w.staging.list({ email: 'b@example.com', profileId: 1 }).length, 0);
    const claimed = w.staging.claim(r.staged_id, { email: 'a@example.com', profileId: 1 });
    assert.equal(claimed.payload.picked.stream.infoHash, HASH, 'the confirm step has the release to queue');
    assert.equal(claimed.payload.meta.mediaId, 'tt0000004');
});

test('stage_download for an episode needs season and episode, and checks it exists and has aired', async () => {
    const w = world();
    assert.equal((await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'series' }, w.ctx())).error, 'single_episode_required');
    assert.equal((await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'series', season: 1, episode: 9 }, w.ctx())).error, 'episode_not_found');
    const future = await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'series', season: 1, episode: 3 }, w.ctx());
    assert.equal(future.error, 'not_released_yet');
    assert.equal(future.air_date, '2999-01-01');
    const ok = await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'series', season: 1, episode: 2 }, w.ctx());
    assert.equal(ok.status, 'STAGED_PENDING_USER_CONFIRMATION');
    assert.equal(ok.title, 'Some Show - S01E02');
    assert.deepEqual(w.calls.stream.at(-1), { type: 'series', videoId: 'tt0000004:1:2' });
});

test('stage_download refuses what is already on the server or downloading, and reports a dead swarm instead of staging', async () => {
    const w = world();
    assert.equal((await w.tools.run('stage_download', { imdb_id: 'tt0000001', type: 'movie' }, w.ctx())).error, 'already_on_server');
    assert.equal((await w.tools.run('stage_download', { imdb_id: 'tt0000020', type: 'series', season: 1, episode: 1 }, w.ctx())).error, 'already_on_server');
    const dl = await w.tools.run('stage_download', { imdb_id: 'tt0000005', type: 'movie' }, w.ctx());
    assert.equal(dl.error, 'already_downloading');
    const dead = world({ streams: [stream(DEAD, 900)] });
    const r = await dead.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'movie' }, dead.ctx());
    assert.equal(r.error, 'no_live_swarm');
    assert.equal(dead.staging.list({ email: 'a@example.com', profileId: 1 }).length, 0);
    const none = world({ streams: [] });
    assert.equal((await none.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'movie' }, none.ctx())).error, 'no_releases_found');
});

test('stage_download uses a named quality profile when it exists and the default otherwise', async () => {
    const w = world();
    const r = await w.tools.run('stage_download', { imdb_id: 'tt0000004', type: 'movie', quality_profile: 'space saver' }, w.ctx());
    assert.match(r.quality_profile, /Space Saver/i);
    const d = await w.tools.run('stage_download', { imdb_id: 'tt0000008', type: 'movie', quality_profile: 'does not exist' }, w.ctx());
    assert.equal(d.quality_profile, w.deps.qualityStore.getDefault().name);
});

test('stage_monitor is admin only, validates the scope, and stages without starting a monitor', async () => {
    const w = world();
    const member = await w.tools.run('stage_monitor', { imdb_id: 'tt0000040', scope: 'new' }, w.ctx());
    assert.equal(member.error, 'admin_only');
    const admin = w.ctx({ login: { email: 'admin@example.com', isAdmin: true } });
    assert.match((await w.tools.run('stage_monitor', { imdb_id: 'tt0000040', scope: 'seasons' }, admin)).error, /seasons/, 'seasons scope needs seasons');
    const ok = await w.tools.run('stage_monitor', { imdb_id: 'tt0000040', scope: 'seasons', seasons: [2, 3] }, admin);
    assert.equal(ok.status, 'STAGED_PENDING_USER_CONFIRMATION');
    assert.equal(ok.scope, 'Seasons 2, 3');
    const staged = w.staging.claim(ok.staged_id, { email: 'admin@example.com', profileId: 1 });
    assert.deepEqual(staged.payload.scope, { mode: 'seasons', seasons: [2, 3] });
    assert.equal(w.calls.monitored.length, 0);
});

test('an unknown tool name is reported, not thrown', async () => {
    const w = world();
    assert.equal((await w.tools.run('format_disk', {}, w.ctx())).error, 'unknown_tool:format_disk');
});
