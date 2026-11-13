'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcile, markSkipped, clearSkipped, tagOf, parseTag } = require('../sentinel_state');

const NOW = Date.parse('2026-11-12T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();
const season = (n, eps) => eps.map((e) => tagOf(n, e));

test('episodes whose files are gone become skipped, not downloaded, and are not silently re-queued', () => {
    // Silo: S01 and S03 on disk, S02 (10 episodes) was deleted by hand
    const item = { downloadedEpisodes: [...season(1, [1, 2, 3]), ...season(2, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ...season(3, [1, 2])] };
    const onDisk = new Set([...season(1, [1, 2, 3]), ...season(3, [1, 2])]);
    const removed = reconcile(item, { onDisk, active: () => false, now: NOW });
    assert.deepEqual(removed, season(2, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    assert.deepEqual(item.downloadedEpisodes, [...season(1, [1, 2, 3]), ...season(3, [1, 2])]);
    assert.equal(item.skippedEpisodes.length, 10);
    assert.deepEqual(reconcile(item, { onDisk, active: () => false, now: NOW }), [], 'idempotent');
});

test('an episode that is downloading, or was queued recently, is never treated as removed', () => {
    const item = { downloadedEpisodes: ['S03E04', 'S03E05', 'S03E06'], downloadedAt: { S03E05: hoursAgo(2), S03E06: hoursAgo(30) } };
    const removed = reconcile(item, { onDisk: new Set(), active: (t) => t === 'S03E04', now: NOW });
    assert.deepEqual(removed, ['S03E06'], 'S03E04 is active, S03E05 is inside the 24 h grace period');
    assert.deepEqual(item.downloadedEpisodes, ['S03E04', 'S03E05']);
});

test('legacy tags without a timestamp are checked immediately', () => {
    const item = { downloadedEpisodes: ['S01E01'] };
    assert.deepEqual(reconcile(item, { onDisk: new Set(), active: () => false, now: NOW }), ['S01E01']);
});

test('markSkipped (admin deleted it in the library) and clearSkipped (Re-download)', () => {
    const item = { downloadedEpisodes: ['S02E01', 'S02E02', 'S03E01'], downloadedAt: { S02E01: hoursAgo(100) }, skippedEpisodes: ['S01E01'] };
    markSkipped(item, 'S02E01');
    assert.deepEqual(item.downloadedEpisodes, ['S02E02', 'S03E01']);
    assert.deepEqual(item.skippedEpisodes, ['S01E01', 'S02E01']);
    assert.equal(item.downloadedAt.S02E01, undefined);

    assert.deepEqual(clearSkipped(item, 2), ['S02E01'], 'only season 2 is cleared');
    assert.deepEqual(item.skippedEpisodes, ['S01E01']);
    assert.deepEqual(clearSkipped(item), ['S01E01'], 'no season = everything');
    assert.deepEqual(item.skippedEpisodes, []);
});

test('tag helpers', () => {
    assert.equal(tagOf(2, 5), 'S02E05');
    assert.equal(tagOf(12, 103), 'S12E103');
    assert.deepEqual(parseTag('S02E05'), { season: 2, episode: 5 });
    assert.equal(parseTag('nope'), null);
});

const { normalizeScope, inScope, scopeLabel } = require('../sentinel_state');

test('scope: "new" only lets in episodes that air from the day the monitor was set; unknown air dates are not "new"', () => {
    const sc = normalizeScope({ mode: 'new' }, Date.parse('2026-11-12T22:00:00Z'));
    assert.deepEqual(sc, { mode: 'new', since: '2026-11-12' });
    assert.equal(inScope(sc, 1, '2022-07-01T00:00:00.000Z'), false, 'the back catalog stays out');
    assert.equal(inScope(sc, 2, '2026-11-12T00:00:00.000Z'), true, 'an episode airing today counts');
    assert.equal(inScope(sc, 2, '2026-11-19T00:00:00.000Z'), true);
    assert.equal(inScope(sc, 2, undefined), false);
    assert.equal(inScope(sc, 2, 'garbage'), false);
});

test('scope: chosen seasons only, all seasons, and monitors saved before scopes existed', () => {
    const s2 = normalizeScope({ mode: 'seasons', seasons: ['2', 2, 1, '2'] });
    assert.deepEqual(s2, { mode: 'seasons', seasons: [1, 2] });
    assert.equal(inScope(s2, 2, '2022-01-01'), true, 'any air date inside a chosen season');
    assert.equal(inScope(s2, 3, '2026-11-20'), false, 'a newer season is not included');
    assert.equal(inScope({ mode: 'all' }, 9, undefined), true);
    assert.equal(inScope(undefined, 1, '2010-01-01'), true, 'legacy monitors keep fetching everything');
});

test('scope validation: bad input is a 400, never a silent "download everything"', () => {
    for (const bad of [{ mode: 'seasons', seasons: [] }, { mode: 'seasons' }, { mode: 'seasons', seasons: ['x', 0, 999] }, { mode: 'everything' }]) {
        assert.throws(() => normalizeScope(bad), (e) => e.status === 400, JSON.stringify(bad));
    }
    assert.deepEqual(normalizeScope(undefined, Date.parse('2026-01-05T00:00:00Z')), { mode: 'new', since: '2026-01-05' }, 'no scope given = the safe default');
    assert.equal(scopeLabel({ mode: 'seasons', seasons: [2] }), 'Season 2');
    assert.equal(scopeLabel({ mode: 'seasons', seasons: [1, 3] }), 'Seasons 1, 3');
    assert.equal(scopeLabel({ mode: 'new', since: '2026-01-01' }), 'New episodes only');
    assert.equal(scopeLabel(undefined), 'All seasons');
});
