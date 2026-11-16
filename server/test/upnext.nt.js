'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const express = require('express');
const { openDb } = require('../db');
const U = require('../upnext');

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-17T12:00:00Z');
const iso = (t) => new Date(t).toISOString();

// The Office-like list: 14 specials (season 0), season 1 (6), season 2 (22); season 3 episode 1 airs in 3 days
function officeMeta() {
    const videos = [];
    for (let e = 1; e <= 14; e++) videos.push({ id: `tt0386676:0:${e}`, season: 0, episode: e, released: '2001-01-31T22:00:00.000Z' });
    for (let e = 1; e <= 6; e++) videos.push({ id: `tt0386676:1:${e}`, season: 1, episode: e, name: `S1E${e}`, released: '2005-03-24T00:00:00.000Z' });
    for (let e = 1; e <= 22; e++) videos.push({ id: `tt0386676:2:${e}`, season: 2, episode: e, name: `S2E${e}`, released: '2005-09-20T00:00:00.000Z' });
    videos.push({ id: 'tt0386676:3:1', season: 3, episode: 1, name: 'Gay Witch Hunt', released: iso(NOW + 3 * DAY), thumbnail: 'https://img.example.com/t.jpg' });
    return { id: 'tt0386676', name: 'The Office', videos };
}

// writes a bitfield the way stremio-core does: bits in video order, LSB first, anchored on the last watched video
function encode(watchedIds, videoIds) {
    const bytes = Buffer.alloc(Math.ceil(videoIds.length / 8));
    let last = -1;
    videoIds.forEach((id, i) => { if (watchedIds.includes(id)) { bytes[i >> 3] |= 1 << (i & 7); last = i; } });
    return `${videoIds[last]}:${last + 1}:${zlib.deflateSync(bytes).toString('base64')}`;
}

const series = (state, extra = {}) => ({ _id: 'tt0386676', name: 'The Office', type: 'series', _mtime: iso(NOW - DAY), state, ...extra });

test('decodeWatched reads a real stremio-core bitfield', () => {
    const ids = officeMeta().videos.map((v) => v.id);
    const watched = U.decodeWatched('tt0386676:2:2:21:eJxjYBBgwA4AAZoAEQ==', ids);
    assert.deepEqual([...watched], ['tt0386676:2:2']);
    assert.equal(U.decodeWatched('garbage', ids).size, 0);
    assert.equal(U.decodeWatched('tt9:1:1:5:@@@', ids).size, 0);
});

test('decodeWatched realigns on the anchor when episodes were added before it', () => {
    const ids = officeMeta().videos.map((v) => v.id);
    const old = ids.filter((id) => id !== 'tt0386676:0:1'); // written before special 0:1 existed
    const s = encode(['tt0386676:1:1', 'tt0386676:1:2'], old);
    assert.deepEqual([...U.decodeWatched(s, ids)], ['tt0386676:1:1', 'tt0386676:1:2']);
});

test('in progress: resume with the time left', () => {
    const r = U.continueState(series({ video_id: 'tt0386676:2:5', timeOffset: 600000, duration: 1320000 }), officeMeta(), NOW);
    assert.equal(r.mode, 'resume');
    assert.equal(r.remainingMs, 720000);
    const movie = U.continueState({ _id: 'tt1', type: 'movie', state: { timeOffset: 3000000, duration: 7200000 } }, null, NOW);
    assert.deepEqual([movie.mode, movie.remainingMs], ['resume', 4200000]);
});

test('finished: next up is the episode after the FURTHEST one watched, not after the rewatch', () => {
    const meta = officeMeta();
    const ids = meta.videos.map((v) => v.id);
    // watched up to S2E10, then rewatched S1E2 to the end (core leaves video_id on S1E2, offset 1)
    const watched = encode(['tt0386676:1:1', 'tt0386676:1:2', ...Array.from({ length: 10 }, (_, i) => `tt0386676:2:${i + 1}`)], ids);
    const r = U.continueState(series({ video_id: 'tt0386676:1:2', timeOffset: 1, duration: 1320000, flaggedWatched: 1, timesWatched: 2, watched }), meta, NOW);
    assert.equal(r.mode, 'next');
    assert.deepEqual([r.next.id, r.next.season, r.next.episode, r.next.title], ['tt0386676:2:11', 2, 11, 'S2E11']);
});

test('finished the last aired episode: upcoming with its air date; end of the show: done', () => {
    const meta = officeMeta();
    const ids = meta.videos.map((v) => v.id);
    const r = U.continueState(series({ video_id: 'tt0386676:2:22', timeOffset: 1, duration: 1320000, flaggedWatched: 1, watched: encode(['tt0386676:2:22'], ids) }), meta, NOW);
    assert.equal(r.mode, 'upcoming');
    assert.equal(r.next.released, iso(NOW + 3 * DAY));
    const allIds = encode(ids.filter((id) => !id.includes(':0:')), ids);
    assert.equal(U.continueState(series({ video_id: 'tt0386676:3:1', timeOffset: 1, flaggedWatched: 1, watched: allIds }), meta, NOW).mode, 'done');
    // nothing watched and nothing in progress: nothing to say
    assert.equal(U.continueState(series({ video_id: 'tt0386676:1:1', timeOffset: 0 }), meta, NOW).mode, 'none');
});

test('upcomingEpisodes: next two weeks plus the last day, soonest first', () => {
    const meta = officeMeta();
    meta.videos.push({ id: 'tt0386676:3:2', season: 3, episode: 2, released: iso(NOW - 2 * DAY) }); // too old
    meta.videos.push({ id: 'tt0386676:3:3', season: 3, episode: 3, name: 'TBA', released: iso(NOW - 3600000) }); // aired an hour ago
    meta.videos.push({ id: 'tt0386676:3:9', season: 3, episode: 9, released: iso(NOW + 30 * DAY) }); // too far
    const out = U.upcomingEpisodes([{ id: 'tt0386676', name: 'The Office' }], new Map([['tt0386676', meta]]), NOW);
    assert.deepEqual(out.map((e) => e.videoId), ['tt0386676:3:3', 'tt0386676:3:1']);
    assert.equal(out[1].thumbnail, 'https://img.example.com/t.jpg');
    assert.equal(out[0].title, null, '"TBA" is not a title');
    assert.equal(out[1].title, 'Gay Witch Hunt');
    assert.equal(out[1].name, 'The Office');
});

test('routes: per profile, from the synced buckets, Cinemeta cached', async () => {
    const db = openDb(':memory:', ':memory:');
    db.raw.prepare("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Owner', ?)").run(iso(NOW));
    const put = db.raw.prepare('INSERT INTO profile_blobs (profile_id, key, json, updated_at) VALUES (?, ?, ?, ?)');
    const ids = officeMeta().videos.map((v) => v.id);
    put.run(1, 'library_recent', JSON.stringify({ items: {
        tt0386676: series({ lastWatched: iso(NOW - DAY), video_id: 'tt0386676:2:22', timeOffset: 1, duration: 1320000, flaggedWatched: 1, watched: encode(['tt0386676:2:22'], ids) }, { removed: true, temp: true }),
        tt0111161: { _id: 'tt0111161', type: 'movie', name: 'Film', _mtime: iso(NOW), state: { timeOffset: 600000, duration: 8520000 } },
    } }), iso(NOW));
    let fetches = 0;
    const fetchImpl = async (url) => {
        fetches++;
        assert.equal(url, 'https://v3-cinemeta.strem.io/meta/series/tt0386676.json');
        return { ok: true, json: async () => ({ meta: officeMeta() }) };
    };
    const app = express();
    U.registerUpNextRoutes(app, {
        upnext: U.createUpNext({ raw: db.raw, fetchImpl, now: () => NOW }),
        requireProfile: (req, _res, next) => { req.profile = { id: 1 }; next(); },
    });
    const srv = app.listen(0);
    try {
        const base = `http://127.0.0.1:${srv.address().port}`;
        const cont = await (await fetch(`${base}/api/upnext/continue?ids=tt0386676,tt0111161,tt404,bad`)).json();
        assert.deepEqual(cont.items.map((i) => [i.id, i.mode]), [['tt0386676', 'upcoming'], ['tt0111161', 'resume']]);
        const up = await (await fetch(`${base}/api/upnext/upcoming`)).json();
        assert.deepEqual(up.items.map((i) => i.videoId), ['tt0386676:3:1']);
        assert.equal(fetches, 1, 'Cinemeta asked once');
    } finally {
        srv.close();
    }
});
