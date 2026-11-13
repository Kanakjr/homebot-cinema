'use strict';
// The per-profile brief: built from the stremio-core library buckets, titles only, never emails or profile names.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createBrief, parseHistory } = require('../ai/brief');

const NOW = Date.parse('2026-11-13T12:00:00Z');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const lib = (id, name, type, state, extra = {}) => ({ _id: id, name, type, poster: `https://img/${id}.jpg`, removed: false, temp: false, state: { lastWatched: day(1), timeOffset: 0, duration: 0, timesWatched: 0, flaggedWatched: 0, video_id: null, ...state }, ...extra });

const recent = {
    uid: null,
    items: {
        tt1: lib('tt1', 'Finished Movie', 'movie', { lastWatched: day(3), timeOffset: 7000, duration: 7200, timesWatched: 1 }),
        tt2: lib('tt2', 'Half Watched', 'movie', { lastWatched: day(1), timeOffset: 1800, duration: 7200 }),
        tt3: lib('tt3', 'Silo', 'series', { lastWatched: day(0), timeOffset: 1000, duration: 3000, video_id: 'tt3:2:5' }),
        tt4: lib('tt4', 'Removed Show', 'series', { lastWatched: day(2) }, { removed: true }),
        'kitsu:1': lib('kitsu:1', 'Not Imdb', 'series', {}),
        tt6: lib('tt6', 'Never Played', 'movie', { lastWatched: null }),
        tt7: lib('tt7', 'TV Channel', 'tv', {}),
    },
};
const saved = { uid: null, items: { tt2: lib('tt2', 'Half Watched', 'movie', { lastWatched: day(10) }), tt8: lib('tt8', 'Old Favourite', 'movie', { lastWatched: day(90), timesWatched: 2 }) } };

test('parseHistory: newest first, one entry per title, only movies and series with an IMDb id, progress and episodes understood', () => {
    const h = parseHistory([saved, recent]);
    assert.deepEqual(h.map((x) => x.id), ['tt3', 'tt2', 'tt1', 'tt8']);
    const silo = h[0];
    assert.equal(silo.season, 2);
    assert.equal(silo.episode, 5);
    assert.equal(silo.finished, false);
    assert.ok(Math.abs(silo.progress - 1 / 3) < 0.01);
    assert.equal(h.find((x) => x.id === 'tt1').finished, true);
    assert.equal(h.find((x) => x.id === 'tt2').progress, 0.25);
    assert.equal(h.find((x) => x.id === 'tt2').lastWatched, Date.parse(day(1)), 'the newer of the two buckets wins');
    assert.deepEqual(parseHistory([null, undefined, {}, { items: null }]), []);
    assert.equal(parseHistory([recent], 2).length, 2);
});

function world({ kid = false } = {}) {
    const db = openDb(':memory:', ':memory:');
    const now = new Date().toISOString();
    db.raw.prepare("INSERT INTO profiles (name, is_kid, created_at) VALUES ('Atharv Secretname', ?, ?)").run(kid ? 1 : 0, now);
    const put = db.raw.prepare('INSERT INTO profile_blobs (profile_id, key, json, updated_at) VALUES (?, ?, ?, ?)');
    put.run(1, 'library', JSON.stringify(saved), now);
    put.run(1, 'library_recent', JSON.stringify(recent), now);
    const staging = { list: () => [] };
    const brief = createBrief({
        raw: db.raw, staging, region: 'IN', now: () => NOW,
        library: { list: ({ limit }) => ({ counts: { all: 2, movie: 1, series: 1, unmatched: 0 }, items: limit === 1 ? [] : [{ imdbId: 'tt9', type: 'movie', title: 'Server Movie', year: 2024, poster: 'p', id: 3, episodeCount: 0 }, { imdbId: 'tt10', type: 'series', title: 'Server Show', year: 2023, poster: 'p', id: 4, episodeCount: 12 }] }) },
        downloadsManager: { listDownloads: async () => ({ active: [{ title: 'Downloading Thing', status: 'downloading', progress: 0.42 }], disk: { freeGB: 400, totalGB: 931 } }) },
        sentinel: { getMonitored: () => [{ title: 'Monitored Show', scopeLabel: 'New episodes only' }] },
        qualityStore: { list: () => [{ name: 'HD Balanced', isDefault: true }, { name: 'Space Saver', isDefault: false }] },
    });
    return { brief, db, profile: { id: 1, name: 'Atharv Secretname', is_kid: kid ? 1 : 0 } };
}

test('the brief has the date, region, role, recent and unfinished titles, the server, downloads, monitors and quality profiles', async () => {
    const w = world();
    const { text, catalog } = await w.brief.build({ profile: w.profile, login: { email: 'secret.person@example.com', isAdmin: true } });
    assert.match(text, /TODAY: 2026-11-13 \(Friday\)\. Streaming region: IN/);
    assert.match(text, /Admin: may also stage a monitor/);
    assert.match(text, /Silo S02E05 \(series\), today, 33% through \[tt3\]/);
    assert.match(text, /Finished Movie \(movie\), 3 days ago, finished/);
    assert.match(text, /UNFINISHED[\s\S]*Half Watched/);
    assert.match(text, /Saved library: 2 titles/);
    assert.match(text, /1 movies and 1 series on the server[\s\S]*Server Show \(2023\) \(series, 12 episodes\) \[tt10\]/);
    assert.match(text, /Downloading Thing: downloading, 42%/);
    assert.match(text, /Disk: 400 GB free of 931 GB/);
    assert.match(text, /Monitored Show \(New episodes only\)/);
    assert.match(text, /HD Balanced \(default\); Space Saver/);
    assert.ok(!/Removed Show|Not Imdb|Never Played|TV Channel/.test(text));
    assert.ok(catalog.has('tt3') && catalog.has('tt9'), 'the titles it mentions can be shown as cards');
    assert.equal(catalog.get('tt9').onServer, true);
});

test('the brief never contains emails or profile names', async () => {
    const w = world();
    const { text } = await w.brief.build({ profile: w.profile, login: { email: 'secret.person@example.com', isAdmin: false } });
    assert.ok(!/secret\.person|example\.com|@|Atharv|Secretname/.test(text), text);
    assert.match(text, /Not an admin: cannot stage monitors/);
});

test('kids profiles are told so, and do not see server titles, downloads or monitors', async () => {
    const w = world({ kid: true });
    const { text } = await w.brief.build({ profile: w.profile, login: { email: 'p@example.com', isAdmin: false } });
    assert.match(text, /KIDS profile[\s\S]*cannot stage downloads or monitors/);
    assert.match(text, /titles are not listed for kids profiles/);
    assert.ok(!/Server Movie|Server Show|Downloading Thing|Monitored Show/.test(text));
});

test('pending staged actions are part of the brief every turn, and the rest is cached for a short while', async () => {
    const w = world();
    let pending = [];
    const b = createBrief({ raw: w.db.raw, staging: { list: () => pending }, now: () => NOW, library: { list: () => ({ counts: { movie: 0, series: 0 }, items: [] }) }, downloadsManager: { listDownloads: async () => ({ active: [] }) }, sentinel: { getMonitored: () => [] }, qualityStore: { list: () => [] } });
    const first = await b.build({ profile: w.profile, login: { email: 'a@example.com', isAdmin: false } });
    assert.ok(!first.text.includes('PENDING FOR CONFIRMATION'));
    pending = [{ card: { summary: 'Download Dune (1080p, 2.1 GB)' } }];
    const second = await b.build({ profile: w.profile, login: { email: 'a@example.com', isAdmin: false } });
    assert.match(second.text, /PENDING FOR CONFIRMATION: Download Dune \(1080p, 2\.1 GB\)/);
});
