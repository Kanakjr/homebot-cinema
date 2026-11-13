'use strict';
// Sentinel end to end: a monitor only fetches what its scope allows (the "it downloaded every season" bug).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SentinelDaemon = require('../sentinel');
const { BUILTIN, normalizeProfile } = require('../grabber/quality');

process.env.STREAM_ADDON_URL = 'https://streams.example.test/some-config'; // Sentinel only asks the addon the operator configured
const IMDB = 'tt11743610';
const daysFromNow = (d) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
const VIDEOS = [
    { season: 1, number: 1, released: '2022-07-01T00:00:00.000Z' },
    { season: 1, number: 2, released: '2022-07-08T00:00:00.000Z' },
    { season: 2, number: 1, released: '2025-12-01T00:00:00.000Z' },
    { season: 2, number: 2, released: '2025-12-08T00:00:00.000Z' },
    { season: 2, number: 3, released: daysFromNow(0) }, // airs today
    { season: 2, number: 4, released: daysFromNow(7) }, // not aired yet
];

function daemon() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
    const added = [];
    const dm = { downloads: {}, addDownload: async (a) => { added.push(a); return { title: a.title }; } };
    const d = new SentinelDaemon(dm, dir);
    d.fetchJson = async (url) => {
        if (url.includes('/meta/series/')) return { meta: { name: 'Show', videos: VIDEOS } };
        const [, s, e] = /:(\d+):(\d+)\.json$/.exec(url);
        return { streams: [{ name: 'StreamAddon\n1080p', title: `Show.S0${s}E0${e}.1080p.WEB-DL.x264\n👤 300 💾 1.5 GB`, infoHash: String(s * 10 + Number(e)).padStart(40, 'a') }] };
    };
    d.grabber = { resolve: () => ({ name: 'HD', config: normalizeProfile(BUILTIN.find((b) => b.key === 'hd-balanced').config) }) };
    d.sendTelegramNotification = async () => {};
    return { d, added, tags: () => added.map((a) => `S${a.season}E${a.episode}`) };
}

test('a brand-new monitor defaults to "new episodes only": the back catalog is never queued', async () => {
    const { d, tags } = daemon();
    const item = d.addMonitored({ imdbId: IMDB, title: 'Show' }); // no scope given
    assert.equal(item.scope.mode, 'new');
    await d.checkSeries(IMDB);
    assert.deepEqual(tags(), ['S2E3'], 'only the episode that airs today; not S1, not S2E1-2, not the unaired S2E4');
});

test('"Season 2" fetches that season only (aired episodes), never season 1', async () => {
    const { d, tags } = daemon();
    d.addMonitored({ imdbId: IMDB, title: 'Show', scope: { mode: 'seasons', seasons: [2] } });
    await d.checkSeries(IMDB);
    assert.deepEqual(tags(), ['S2E1', 'S2E2', 'S2E3']);
    assert.equal(d.getMonitored()[0].scopeLabel, 'Season 2');
});

test('"All seasons" fetches everything that has aired, and a monitor saved before scopes existed still does', async () => {
    const all = daemon();
    all.d.addMonitored({ imdbId: IMDB, title: 'Show', scope: { mode: 'all' } });
    await all.d.checkSeries(IMDB);
    assert.deepEqual(all.tags(), ['S1E1', 'S1E2', 'S2E1', 'S2E2', 'S2E3']);

    const legacy = daemon();
    legacy.d.monitored[IMDB] = { imdbId: IMDB, title: 'Show', quality: '1080p', monitored: true, downloadedEpisodes: [], skippedEpisodes: [], downloadedAt: {} };
    await legacy.d.checkSeries(IMDB);
    assert.equal(legacy.tags().length, 5);
    assert.equal(legacy.d.getMonitored()[0].scopeLabel, 'All seasons');
});

test('changing the scope keeps what was already downloaded; an invalid scope is refused', async () => {
    const { d, added } = daemon();
    d.addMonitored({ imdbId: IMDB, title: 'Show', scope: { mode: 'seasons', seasons: [2] } });
    await d.checkSeries(IMDB);
    assert.equal(added.length, 3);
    d.addMonitored({ imdbId: IMDB, title: 'Show', scope: { mode: 'all' } });
    await d.checkSeries(IMDB);
    assert.equal(added.length, 5, 'only season 1 is new; season 2 is not fetched twice');
    assert.throws(() => d.addMonitored({ imdbId: IMDB, title: 'Show', scope: { mode: 'seasons', seasons: [] } }), (e) => e.status === 400);
    assert.equal(d.monitored[IMDB].scope.mode, 'all', 'a refused change leaves the monitor as it was');
    d.addMonitored({ imdbId: IMDB, title: 'Show' }); // no scope given on an existing monitor: keep it
    assert.equal(d.monitored[IMDB].scope.mode, 'all');
});
