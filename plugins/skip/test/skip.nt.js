'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { openDb } = require('../../../server/db');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');
const S = require('../server/segments');
const { createIntroDb, createChapterReader, EMPTY_TTL } = require('../server/sources');

const seg = (start, end) => ({ start_sec: start, end_sec: end, start_ms: start * 1000, end_ms: end * 1000, confidence: 1 });

// a fake IntroDB: counts calls per URL and answers from a table (or fails)
function fakeIntroDb(table = {}, { fail = false } = {}) {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        if (fail) throw new Error('offline');
        const u = new URL(url);
        const key = u.searchParams.get('is_movie') ? u.searchParams.get('imdb_id')
            : `${u.searchParams.get('imdb_id')}:${u.searchParams.get('season')}:${u.searchParams.get('episode')}`;
        const body = table[key] || { intro: null, recap: null, outro: null, post_credits: null };
        return { ok: true, status: 200, json: async () => body };
    };
    return { calls, fetchImpl };
}

async function withServer(app, fn) {
    const srv = app.listen(0);
    try {
        return await fn(`http://127.0.0.1:${srv.address().port}`);
    } finally {
        srv.close();
    }
}

test('parseVideoId accepts IMDb episode and movie ids only', () => {
    assert.deepEqual(S.parseVideoId('tt0944947:1:2'), { imdbId: 'tt0944947', season: 1, episode: 2, movie: false });
    assert.deepEqual(S.parseVideoId('tt0816692'), { imdbId: 'tt0816692', movie: true });
    for (const bad of ['', null, 'kitsu:1:2', 'tt1:1', 'tt1:a:b', 'tt1:1:2/../x', 'tt1 ; rm', 'tt12345678901']) assert.equal(S.parseVideoId(bad), null, String(bad));
});

test('IntroDB response: outro is credits, credits stop where the post-credits scene starts', () => {
    const out = S.fromIntroDb({ intro: seg(10, 70), recap: null, outro: seg(6000, 6300), post_credits: seg(6200, 6260) });
    assert.deepEqual(out.map((s) => [s.type, s.start, s.end, s.source]), [
        ['intro', 10, 70, 'introdb'],
        ['credits', 6000, 6200, 'introdb'],
        ['postcredits', 6200, 6260, 'introdb'],
    ]);
});

test('IntroDB response: implausible or broken segments are dropped', () => {
    const out = S.fromIntroDb({ intro: seg(10, 9), recap: seg(0, 1), outro: { start_sec: 'x', end_sec: 5 }, post_credits: seg(0, 5000) });
    assert.deepEqual(out, []);
    assert.deepEqual(S.fromIntroDb(null), []);
    // ms only is fine too
    assert.deepEqual(S.fromIntroDb({ intro: { start_ms: 5000, end_ms: 35000 } }).map((s) => [s.start, s.end]), [[5, 35]]);
});

test('chapter titles map to segment types', () => {
    const cases = {
        Intro: 'intro', 'Opening Credits': 'intro', OP: 'intro', 'Main Titles': 'intro', Opening: 'intro',
        Recap: 'recap', 'Previously on': 'recap',
        Credits: 'credits', 'End Credits': 'credits', ED: 'credits', Ending: 'credits', Outro: 'credits',
        'Post-Credits Scene': 'postcredits', 'Mid credits': 'postcredits', Stinger: 'postcredits',
        'Chapter 1': null, Prologue: null, 'Part A': null, '': null, Operation: null, Edward: null,
    };
    for (const [title, type] of Object.entries(cases)) assert.equal(S.chapterType(title), type, title);
});

test('chapters: first of each type wins, back-to-back chapters of one type merge', () => {
    const ch = (s, e, title) => ({ start_time: String(s), end_time: String(e), tags: { title } });
    const out = S.fromChapters([ch(0, 5, 'Prologue'), ch(5, 60, 'Intro'), ch(60, 1200, 'Chapter 2'), ch(1200, 1260, 'Credits'), ch(1260, 1290, 'Credits'), ch(1290, 1300, 'Intro')]);
    assert.deepEqual(out.map((s) => [s.type, s.start, s.end, s.source]), [['intro', 5, 60, 'chapters'], ['credits', 1200, 1290, 'chapters']]);
    assert.deepEqual(S.fromChapters(undefined), []);
});

test('merge: chapters in the file beat IntroDB per type', () => {
    const fromFile = [{ type: 'intro', start: 3, end: 50, source: 'chapters' }];
    const fromDb = [{ type: 'intro', start: 0, end: 40, source: 'introdb' }, { type: 'credits', start: 1200, end: 1260, source: 'introdb' }];
    assert.deepEqual(S.mergeSegments(fromFile, fromDb).map((s) => [s.type, s.source]), [['intro', 'chapters'], ['credits', 'introdb']]);
});

test('library file ids come only from lf_<n>', () => {
    assert.equal(S.libraryFileId('lf_12'), 12);
    assert.equal(S.libraryFileId('https://x.example.com/api/downloads/stream/lf_7/video.mp4'), 7);
    assert.equal(S.libraryFileId('/etc/passwd'), null);
    assert.equal(S.libraryFileId('lf_1/../../x'), 1); // the route validates the raw param strictly (below)
});

test('IntroDB: one fetch per key, cached; empty answers expire after a day; errors are not cached', async () => {
    const raw = openDb(':memory:', ':memory:').raw;
    raw.exec('CREATE TABLE skip_segments (key TEXT PRIMARY KEY, segments_json TEXT NOT NULL, fetched_at INTEGER NOT NULL)');
    let t = 1_000_000;
    const fake = fakeIntroDb({ 'tt1:1:1': { intro: seg(0, 31) } });
    const db = createIntroDb({ baseUrl: 'https://introdb.example.com/', raw, fetchImpl: fake.fetchImpl, now: () => t });

    const id = { imdbId: 'tt1', season: 1, episode: 1, movie: false };
    const [a, b] = await Promise.all([db.lookup(id), db.lookup(id)]);
    assert.equal(fake.calls.length, 1, 'parallel lookups share one request');
    assert.equal(a.segments[0].end, 31);
    assert.equal(b.segments[0].end, 31);
    assert.equal(fake.calls[0], 'https://introdb.example.com/segments?imdb_id=tt1&season=1&episode=1');
    assert.equal((await db.lookup(id)).cached, true);
    assert.equal(fake.calls.length, 1);

    const movie = { imdbId: 'tt2', movie: true };
    await db.lookup(movie);
    assert.equal(fake.calls[1], 'https://introdb.example.com/segments?imdb_id=tt2&is_movie=true');
    t += EMPTY_TTL - 1;
    await db.lookup(movie);
    assert.equal(fake.calls.length, 2, 'empty answer still fresh');
    t += 2;
    await db.lookup(movie);
    assert.equal(fake.calls.length, 3, 'empty answer expired');

    const down = fakeIntroDb({}, { fail: true });
    const db2 = createIntroDb({ baseUrl: 'https://introdb.example.com', raw, fetchImpl: down.fetchImpl, now: () => t });
    await assert.rejects(db2.lookup({ imdbId: 'tt3', season: 1, episode: 1, movie: false }));
    await assert.rejects(db2.lookup({ imdbId: 'tt3', season: 1, episode: 1, movie: false }));
    assert.equal(down.calls.length, 2, 'errors are retried, not cached');
});

test('chapter reader: absolute paths only, cached by size+mtime, ffprobe missing means no chapters', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-ch-'));
    const file = path.join(dir, 'Show S01E01.mkv');
    fs.writeFileSync(file, 'x');
    let runs = 0;
    const json = JSON.stringify({ chapters: [{ start_time: '0.0', end_time: '42.5', tags: { title: 'Opening' } }] });
    const reader = createChapterReader({ execFileImpl: (cmd, args, opts, cb) => { runs++; assert.equal(cmd, 'ffprobe'); assert.equal(args.at(-1), file); cb(null, json); } });
    assert.deepEqual((await reader.read(file)).map((s) => [s.type, s.end]), [['intro', 42.5]]);
    await reader.read(file);
    assert.equal(runs, 1);
    assert.deepEqual(await reader.read('relative/path.mkv'), []);
    assert.equal(runs, 1);

    const warnings = [];
    const missing = createChapterReader({ log: { warn: (m) => warnings.push(m) }, execFileImpl: (c, a, o, cb) => cb(Object.assign(new Error('nope'), { code: 'ENOENT' })) });
    assert.deepEqual(await missing.read(file), []);
    assert.deepEqual(await missing.read(file), []);
    assert.equal(warnings.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
});

function setup({ env = {}, table = {}, filePath = null, chapters = [] } = {}) {
    const app = express();
    const db = openDb(':memory:', ':memory:');
    const fake = fakeIntroDb(table);
    const reads = [];
    const library = { filePath: (n) => (n === 5 ? filePath : null) };
    const { ctx, disabled } = fakeCtx({ id: 'skip', app, db, env, services: { library } });
    register(ctx, { fetchImpl: fake.fetchImpl, chapterReader: { read: async (p) => { reads.push(p); return chapters; } } });
    return { app, fake, reads, disabled };
}

test('GET /api/skip/segments: IntroDB by video id, not cached by the browser', async () => {
    const { app, fake, disabled } = setup({ table: { 'tt9:2:3': { intro: seg(0, 31), outro: seg(1228, 1268) } } });
    assert.equal(disabled(), null);
    await withServer(app, async (base) => {
        const r = await fetch(`${base}/api/skip/segments?videoId=tt9:2:3`);
        assert.equal(r.headers.get('cache-control'), 'private, no-store');
        const body = await r.json();
        assert.equal(body.introdb, 'found');
        assert.deepEqual(body.segments.map((s) => [s.type, s.start, s.end]), [['intro', 0, 31], ['credits', 1228, 1268]]);
        assert.equal(fake.calls.length, 1);
    });
});

test('GET /api/skip/segments: chapters from a library file inside the media roots win', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-root-'));
    const file = path.join(dir, 'ep.mkv');
    fs.writeFileSync(file, 'x');
    const prev = process.env.MEDIA_ROOTS;
    process.env.MEDIA_ROOTS = dir;
    try {
        const { app, reads } = setup({
            table: { 'tt9:1:1': { intro: seg(0, 40), outro: seg(1200, 1260) } },
            filePath: file,
            chapters: [{ type: 'intro', start: 2, end: 45, source: 'chapters' }],
        });
        await withServer(app, async (base) => {
            const body = await (await fetch(`${base}/api/skip/segments?videoId=tt9:1:1&file=lf_5`)).json();
            assert.deepEqual(body.segments.map((s) => [s.type, s.source]), [['intro', 'chapters'], ['credits', 'introdb']]);
            assert.deepEqual(reads, [file]);
            // a file the library does not know: no chapters, no error
            const other = await (await fetch(`${base}/api/skip/segments?file=lf_6`)).json();
            assert.deepEqual(other.segments, []);
        });
    } finally {
        if (prev === undefined) delete process.env.MEDIA_ROOTS; else process.env.MEDIA_ROOTS = prev;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GET /api/skip/segments: files outside the media roots are never probed', async () => {
    const prev = process.env.MEDIA_ROOTS;
    process.env.MEDIA_ROOTS = path.join(os.tmpdir(), 'skip-no-such-root');
    try {
        const { app, reads } = setup({ filePath: __filename });
        await withServer(app, async (base) => {
            const body = await (await fetch(`${base}/api/skip/segments?file=lf_5`)).json();
            assert.deepEqual(body.segments, []);
            assert.deepEqual(reads, []);
        });
    } finally {
        if (prev === undefined) delete process.env.MEDIA_ROOTS; else process.env.MEDIA_ROOTS = prev;
    }
});

test('GET /api/skip/segments: bad input is rejected before any lookup', async () => {
    const { app, fake, reads } = setup();
    await withServer(app, async (base) => {
        for (const q of ['videoId=kitsu:1:2', 'videoId=tt1:1:1%2F..', 'file=/etc/passwd', 'file=lf_1/../x', 'file=lf_abc']) {
            const r = await fetch(`${base}/api/skip/segments?${q}`);
            assert.equal(r.status, 400, q);
        }
        assert.equal(fake.calls.length, 0);
        assert.deepEqual(reads, []);
    });
});

test('SKIP_INTRODB_URL=off keeps every lookup local', async () => {
    const { app, fake } = setup({ env: { SKIP_INTRODB_URL: 'off' }, table: { 'tt9:1:1': { intro: seg(0, 40) } } });
    await withServer(app, async (base) => {
        const body = await (await fetch(`${base}/api/skip/segments?videoId=tt9:1:1`)).json();
        assert.deepEqual(body, { segments: [], introdb: 'off' });
        assert.equal(fake.calls.length, 0);
    });
});

test('an IntroDB outage answers with no segments instead of failing playback', async () => {
    const app = express();
    const { ctx } = fakeCtx({ id: 'skip', app, db: openDb(':memory:', ':memory:'), services: { library: {} } });
    register(ctx, { fetchImpl: async () => { throw new Error('offline'); }, chapterReader: { read: async () => [] } });
    await withServer(app, async (base) => {
        const r = await fetch(`${base}/api/skip/segments?videoId=tt9:1:1`);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { segments: [], introdb: 'error' });
    });
});
