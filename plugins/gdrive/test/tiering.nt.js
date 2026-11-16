'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectCandidates, watchedBy } = require('../server/tiering');

const DAY = 86400000;
const now = Date.UTC(2026, 10, 16);
const f = (o) => ({ path: `/TV/${o.rel}`, root: '/TV', type: 'series', imdbId: 'tt1', season: 1, episode: 1, mtime: now - 30 * DAY, size: 1, ...o });
const hist = (o) => new Map([['tt1', { id: 'tt1', finished: true, season: 1, episode: 5, ...o }]]);
const pick = (files, extra = {}) => selectCandidates({ files, watched: [hist()], now, ...extra });
const rels = (r) => r.candidates.map((c) => c.rel);

test('old, watched, unseeded episodes are candidates; unwatched and too-new are not', () => {
    const r = pick([f({ rel: 'a', episode: 2 }), f({ rel: 'b', episode: 9 }), f({ rel: 'c', episode: 1, mtime: now - 2 * DAY })]);
    assert.deepEqual(rels(r), ['a']);
    assert.equal(r.skipped.not_watched, 1);
    assert.equal(r.skipped.too_new, 1);
});

test('a torrent still in Transmission protects the file (and anything inside its folder)', () => {
    const files = [f({ rel: 'Show/S01E01.mkv', episode: 1 })];
    assert.deepEqual(rels(pick(files, { torrentPaths: new Set(['/TV/Show']) })), []);
    assert.deepEqual(rels(pick(files, { torrentPaths: new Set(['/TV/Other']) })), ['Show/S01E01.mkv']);
});

test('the newest local season of a monitored show stays local; older seasons may go', () => {
    const files = [f({ rel: 's1', season: 1, episode: 1 }), f({ rel: 's2', season: 2, episode: 1 })];
    const r = selectCandidates({ files, watched: [hist({ season: 3, episode: 1 })], monitored: new Set(['tt1']), now });
    assert.deepEqual(rels(r), ['s1']);
});

test('movies need a finished watch; \'all\' mode needs every profile', () => {
    const m = { rel: 'm', type: 'movie', season: null, episode: null };
    assert.deepEqual(rels(pick([f(m)])), ['m']);
    assert.deepEqual(rels(selectCandidates({ files: [f(m)], watched: [hist({ finished: false })], now })), []);
    assert.deepEqual(rels(selectCandidates({ files: [f(m)], watched: [hist(), new Map()], now, watchedMode: 'all' })), []);
    assert.deepEqual(rels(selectCandidates({ files: [f(m)], watched: [hist(), new Map()], now })), ['m']);
});

test('files without an IMDb match are never moved', () => {
    assert.deepEqual(rels(pick([f({ rel: 'x', imdbId: null })])), []);
});

test('watchedBy: earlier episodes count, the current one only when finished', () => {
    assert.equal(watchedBy({ season: 1, episode: 5, finished: false }, { type: 'series', season: 1, episode: 4 }), true);
    assert.equal(watchedBy({ season: 1, episode: 5, finished: false }, { type: 'series', season: 1, episode: 5 }), false);
    assert.equal(watchedBy({ season: 1, episode: 5, finished: true }, { type: 'series', season: 1, episode: 5 }), true);
});
