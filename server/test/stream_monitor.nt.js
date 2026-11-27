'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStreamMonitor } = require('../stream_monitor');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const MIN = 60 * 1000;
const flush = () => new Promise((r) => setImmediate(r));

function setup(opts = {}) {
    let t = 1000000;
    const engines = {};
    const removed = [];
    const forgotten = [];
    const logs = [];
    let removeOk = true;
    let reachable = true;
    const m = createStreamMonitor({
        listEngines: async () => (reachable ? { ...engines } : null),
        removeEngine: async (h) => {
            if (!removeOk) return false;
            removed.push(h);
            delete engines[h];
            return true;
        },
        statsOf: async (h) => engines[h] || null,
        onRemoved: (h) => forgotten.push(h),
        log: (l) => logs.push(l),
        now: () => t,
        idleMs: 20 * MIN,
        sweepMs: 0,
        ...opts,
    });
    return {
        m, engines, removed, forgotten, logs,
        advance: (ms) => { t += ms; },
        failRemoves: (v) => { removeOk = !v; },
        unreachable: (v) => { reachable = !v; },
    };
}

test('classify finds the torrent behind every kind of streaming request', () => {
    const { m } = setup();
    assert.deepEqual(m.classify(`/${A}/0`), { hash: A, idx: 0, kind: 'media' });
    assert.deepEqual(m.classify(`/streaming/${A.toUpperCase()}/2?tr=udp%3A%2F%2Fx`), { hash: A, idx: 2, kind: 'media' });
    assert.deepEqual(m.classify(`/${A}/1/video.mkv`), { hash: A, idx: 1, kind: 'media' });
    assert.equal(m.classify(`/${A}/0/stats.json`).kind, 'stats');
    assert.equal(m.classify(`/${A}/stats.json`).kind, 'stats');
    assert.deepEqual(m.classify(`/${A}/create`), { hash: A, idx: null, kind: 'other' });
    // HLS: the master playlist names the torrent; later segment requests only carry the session id
    assert.deepEqual(m.classify(`/hlsv2/s1/master.m3u8?mediaURL=http%3A%2F%2F127.0.0.1%3A11470%2F${B}%2F0&videoCodecs=h264`),
        { hash: B, idx: null, kind: 'hls' });
    assert.deepEqual(m.classify('/hlsv2/s1/video0/segment3.m4s'), { hash: B, idx: null, kind: 'hls' });
    assert.equal(m.classify('/hlsv2/11470-nvenc-linux-video-hevc.mkv/destroy'), null);
    assert.deepEqual(m.classify(`/opensubHash?videoUrl=http%3A%2F%2F127.0.0.1%3A11470%2F${C}%2F0`), { hash: C, idx: null, kind: 'other' });
    assert.equal(m.classify('/settings'), null);
    assert.equal(m.classify('/stats.json'), null);
    assert.equal(m.classify(`/${A}x/0`), null, 'not a 40-hex hash');
});

test('a torrent nobody watches is closed after the idle time, timed from when it was first seen', async () => {
    const s = setup();
    s.engines[A] = { name: 'Probe.Only.Release', swarmConnections: 200 };
    assert.deepEqual((await s.m.sweep()).removed, [], 'first sighting starts the clock');
    s.advance(19 * MIN);
    assert.deepEqual((await s.m.sweep()).removed, []);
    s.advance(2 * MIN);
    const r = await s.m.sweep();
    assert.deepEqual(r.removed, [A]);
    assert.deepEqual(s.forgotten, [A], 'the warm-up cache is told, so playing it again starts it again');
    assert.equal(r.open, 0);
    assert.equal(r.conns, 0);
    assert.match(s.logs.at(-1), /^\[streams\] closed 1 torrent\(s\) nobody watched for 20 min: aaaaaaaa "Probe\.Only\.Release"; 0 open/);
});

test('an open viewer connection keeps its torrent however long it lasts', async () => {
    const s = setup();
    s.engines[A] = { swarmConnections: 30 };
    const w = s.m.track(`/${A}/0`);
    s.advance(3 * 60 * MIN); // a long film, one long-running range request
    assert.deepEqual((await s.m.sweep()).removed, []);
    w.done();
    s.advance(19 * MIN); // paused, connection closed
    assert.deepEqual((await s.m.sweep()).removed, []);
    s.advance(2 * MIN);
    assert.deepEqual((await s.m.sweep()).removed, [A]);
});

test('any request for the torrent (the player polling stats while paused) keeps it open', async () => {
    const s = setup();
    s.engines[A] = {};
    await s.m.sweep();
    for (let i = 0; i < 12; i++) {
        s.advance(10 * MIN);
        s.m.track(`/streaming/${A}/0/stats.json`).done();
        assert.deepEqual((await s.m.sweep()).removed, []);
    }
});

test('the 2026-11-27 pile-up: probe-started and abandoned torrents go, the one being watched stays', async () => {
    const s = setup();
    for (const h of [A, B, C]) s.engines[h] = { swarmConnections: 150 };
    const watching = s.m.track(`/${C}/0`);
    await s.m.sweep();
    s.advance(25 * MIN);
    const r = await s.m.sweep();
    assert.deepEqual(r.removed.sort(), [A, B]);
    assert.equal(r.open, 1);
    assert.equal(r.conns, 150);
    watching.done();
});

test('a failed remove is retried on the next sweep; an unreachable streaming server changes nothing', async () => {
    const s = setup();
    s.engines[A] = {};
    await s.m.sweep();
    s.advance(21 * MIN);
    s.failRemoves(true);
    assert.deepEqual((await s.m.sweep()).removed, []);
    s.unreachable(true);
    assert.equal(await s.m.sweep(), null);
    s.unreachable(false);
    s.failRemoves(false);
    assert.deepEqual((await s.m.sweep()).removed, [A]);
});

test('idleMs 0 never closes anything', async () => {
    const s = setup({ idleMs: 0 });
    s.engines[A] = {};
    await s.m.sweep();
    s.advance(24 * 60 * MIN);
    assert.deepEqual((await s.m.sweep()).removed, []);
});

test('logs the playback start with the wait and the swarm, slow reads, and viewers who gave up', async () => {
    const s = setup();
    s.engines[A] = { name: 'Some.Show.S02E09.1080p', peers: 1, unchoked: 0, downloadSpeed: 0 };

    const first = s.m.track(`/${A}/0`);
    s.advance(58200);
    first.response(206);
    first.firstData();
    await flush();
    assert.deepEqual(s.logs, ['[stream] start aaaaaaaa/0: first data after 58.2 s "Some.Show.S02E09.1080p" (peers 1, unchoked 0, 0.0 MB/s)']);
    first.done();

    const quick = s.m.track(`/${A}/0`); // a seek a minute later, same playback
    s.advance(800);
    quick.response(206);
    quick.firstData();
    quick.done();
    await flush();
    assert.equal(s.logs.length, 1, 'fast reads inside a playback are not logged');

    s.engines[A].peers = 4;
    s.engines[A].unchoked = 3;
    s.engines[A].downloadSpeed = 900000;
    const slow = s.m.track(`/${A}/0`);
    s.advance(12400);
    slow.response(206);
    slow.firstData();
    await flush();
    assert.equal(s.logs[1], '[stream] slow read aaaaaaaa/0: first data after 12.4 s "Some.Show.S02E09.1080p" (peers 4, unchoked 3, 0.9 MB/s)');
    slow.done();

    const stuck = s.m.track(`/${A}/0`);
    s.advance(61000);
    stuck.done(); // the viewer gave up before any byte arrived
    stuck.done(); // close can only count once
    await flush();
    assert.match(s.logs[2], /^\[stream\] no data for aaaaaaaa\/0 after 61\.0 s, the viewer left/);
});

test('HEAD requests, stats polling and error responses are never logged as reads', async () => {
    const s = setup();
    const head = s.m.track(`/${A}/0`, 'HEAD');
    s.advance(30000);
    head.response(200);
    head.done();
    const stats = s.m.track(`/${A}/0/stats.json`);
    s.advance(30000);
    stats.firstData();
    stats.done();
    const missing = s.m.track(`/${B}/0`);
    s.advance(30000);
    missing.response(404);
    missing.done();
    await flush();
    assert.deepEqual(s.logs, []);
});

test('a playback that resumes after a long break is logged as a new start; HLS gets its own label', async () => {
    const s = setup({ statsOf: null });
    const a = s.m.track(`/${A}/0`);
    s.advance(500);
    a.firstData();
    a.done();
    s.advance(6 * MIN);
    const b = s.m.track(`/${A}/0`);
    s.advance(400);
    b.firstData();
    b.done();
    const hls = s.m.track(`/hlsv2/s9/master.m3u8?mediaURL=${encodeURIComponent(`http://127.0.0.1:11470/${B}/1`)}`);
    s.advance(3000);
    hls.firstData();
    hls.done();
    await flush();
    assert.deepEqual(s.logs, [
        '[stream] start aaaaaaaa/0: first data after 0.5 s',
        '[stream] start aaaaaaaa/0: first data after 0.4 s',
        '[stream] start bbbbbbbb (HLS): first data after 3.0 s',
    ]);
});

test('a health line every 30 minutes while torrents are open, none while idle', async () => {
    const s = setup({ idleMs: 0 });
    await s.m.sweep();
    assert.deepEqual(s.logs, [], 'nothing open, nothing to say');
    s.engines[A] = { swarmConnections: 5 };
    await s.m.sweep();
    assert.deepEqual(s.logs, ['[streams] 1 torrent(s) open, 5 peer connections']);
    s.advance(2 * MIN);
    await s.m.sweep();
    assert.equal(s.logs.length, 1);
    s.advance(30 * MIN);
    await s.m.sweep();
    assert.equal(s.logs.length, 2);
});
