'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createSwarmProbe, chooseLive } = require('../grabber/swarm_probe');
const { pickBest, BUILTIN, normalizeProfile } = require('../grabber/quality');

const GOOD = 'a'.repeat(40);
const SLOW = 'b'.repeat(40);
const DEAD = 'c'.repeat(40);
const PEERS = 'd'.repeat(40); // peers connected but nobody unchoked, no data

async function fakeStreamingServer() {
    const hits = { create: 0, read: 0, stats: 0, ranges: [] };
    const NOFILES = 'e'.repeat(40); // metadata not known yet: stats without a file list
    const server = http.createServer((req, res) => {
        const m = /^\/([a-f0-9]{40})\/(create|stats\.json|\d+)$/.exec(req.url);
        if (!m) { res.writeHead(404); return res.end(); }
        const [, hash, what] = m;
        if (what === 'create') { hits.create++; res.writeHead(200); return res.end('{}'); }
        if (what === 'stats.json') {
            hits.stats++;
            const st = { [GOOD]: [9, 4, 5e6], [SLOW]: [6, 1, 3e4], [DEAD]: [41, 0, 0], [PEERS]: [12, 0, 0] }[hash] || [0, 0, 0];
            res.writeHead(200, { 'content-type': 'application/json' });
            const files = hash === NOFILES ? [] : [{ length: 300 * 1024 * 1024, offset: 0 }, { length: 300 * 1024 * 1024, offset: 300 * 1024 * 1024 }, { length: 300 * 1024 * 1024, offset: 600 * 1024 * 1024 }];
            return res.end(JSON.stringify({ peers: st[0], unchoked: st[1], downloadSpeed: st[2], files }));
        }
        hits.read++;
        hits.ranges.push(req.headers.range);
        res.writeHead(206, { 'content-type': 'video/x-matroska' });
        if (hash === GOOD) return res.end(Buffer.alloc(600 * 1024, 1)); // everything immediately
        if (hash === SLOW) { // a trickle: 100 KB then stalls
            res.write(Buffer.alloc(100 * 1024, 1));
            return; // never ends
        }
        // DEAD / PEERS: headers only, no data, connection stays open
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { port: server.address().port, hits, close: () => server.closeAllConnections && server.closeAllConnections() || server.close() };
}

const mk = (port, extra = {}) => createSwarmProbe({ host: '127.0.0.1', port, maxMs: 700, goodMs: 400, ...extra });

test('good / slow / dead swarms get the right verdict', async () => {
    const s = await fakeStreamingServer();
    const p = mk(s.port);
    const good = await p.probe(GOOD, 2);
    assert.equal(good.verdict, 'good');
    assert.ok(good.bytes >= 512 * 1024);
    const slow = await p.probe(SLOW, 2);
    assert.equal(slow.verdict, 'slow', 'a trickle that never completes is slow, not good');
    assert.equal(slow.bytes, 100 * 1024);
    const dead = await p.probe(DEAD, 2);
    assert.equal(dead.verdict, 'dead');
    assert.equal(dead.bytes, 0);
    assert.equal(dead.peers, 41, 'peers connected but nobody unchoked = dead');
    assert.equal(dead.unchoked, 0);
    assert.equal((await p.probe(PEERS, 0)).verdict, 'dead');
    s.close();
});

test('results are cached, so repeated checks do not hammer the streaming server', async () => {
    const s = await fakeStreamingServer();
    const p = mk(s.port);
    await Promise.all([p.probe(GOOD, 2), p.probe(GOOD, 2), p.probe(GOOD.toUpperCase(), 2)]);
    await p.probe(GOOD, 2);
    assert.equal(s.hits.read, 1);
    assert.equal(s.hits.create, 0, 'no warm function configured in this test');
    await p.probe(GOOD, 3); // another file in the same torrent is a different check
    assert.equal(s.hits.read, 2);
    s.close();
});

test('warm() is called before reading, and a slow warm does not block the probe forever', async () => {
    const s = await fakeStreamingServer();
    const warmed = [];
    const p = mk(s.port, { warm: async (h) => { warmed.push(h); await new Promise((r) => setTimeout(r, 5000)); } });
    const t0 = Date.now();
    const r = await p.probe(GOOD, 2);
    assert.deepEqual(warmed, [GOOD]);
    assert.ok(Date.now() - t0 < 4000, 'bounded by the probe budget');
    assert.equal(r.verdict, 'good');
    s.close();
});

test('invalid input is "unknown"; an unreachable streaming server is "unknown" and is not cached', async () => {
    const p = mk(1); // nothing listens on port 1
    assert.equal((await p.probe('nope', 1)).verdict, 'unknown');
    const r = await p.probe(GOOD, 2);
    assert.equal(r.verdict, 'unknown');
    const again = await p.probe(GOOD, 2);
    assert.equal(again.verdict, 'unknown');
});

test('probeMany returns results keyed by lower-case hash and respects the concurrency cap', async () => {
    const s = await fakeStreamingServer();
    let live = 0, peak = 0;
    const p = mk(s.port, { concurrency: 2, warm: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 60)); live--; } });
    const out = await p.probeMany([GOOD, SLOW, DEAD, PEERS].map((h, i) => ({ infoHash: h.toUpperCase(), fileIdx: i })));
    assert.deepEqual(Object.keys(out).sort(), [DEAD, GOOD, PEERS, SLOW].sort());
    assert.equal(out[GOOD].verdict, 'good');
    assert.equal(out[DEAD].verdict, 'dead');
    assert.ok(peak <= 2, `at most 2 probes at once, saw ${peak}`);
    s.close();
});

test('chooseLive skips dead swarms and falls through to the next best release', async () => {
    const profile = normalizeProfile(BUILTIN.find((b) => b.key === 'hd-balanced').config);
    const mkStream = (hash, seeds) => ({ name: 'StreamAddon\n1080p', title: `Show.S01E01.1080p.WEB-DL.x264\n👤 ${seeds} 💾 1.5 GB`, infoHash: hash, fileIdx: 1 });
    // DEAD ranks first (most listed seeders) but has no live swarm
    const result = pickBest(profile, [mkStream(DEAD, 3000), mkStream(GOOD, 300), mkStream(SLOW, 100)], 'series');
    assert.equal(result.picked.stream.infoHash, DEAD);
    const fake = async (items) => Object.fromEntries(items.map((i) => [i.infoHash, { verdict: i.infoHash === DEAD ? 'dead' : i.infoHash === GOOD ? 'good' : 'slow' }]));
    const live = await chooseLive(result, fake);
    assert.equal(live.picked.stream.infoHash, GOOD);
    assert.equal(live.allDead, false);
    assert.equal(live.checked, 3);
});

test('chooseLive: when every top candidate is dead nothing is picked; streams without a torrent hash count as live', async () => {
    const profile = normalizeProfile(BUILTIN.find((b) => b.key === 'hd-balanced').config);
    const t = (hash) => ({ name: 'T\n1080p', title: 'Show.1080p.WEB-DL.x264\n👤 90 💾 1.5 GB', infoHash: hash });
    const allDead = await chooseLive(pickBest(profile, [t(DEAD), t(PEERS)], 'series'), async (items) => Object.fromEntries(items.map((i) => [i.infoHash, { verdict: 'dead' }])));
    assert.equal(allDead.picked, null);
    assert.equal(allDead.allDead, true);
    const direct = { name: 'HTTP\n1080p', title: 'Show.1080p.WEB-DL.x264\n💾 1.5 GB', url: 'https://example.com/x.mp4' };
    const mixed = await chooseLive(pickBest(profile, [t(DEAD), direct], 'series'), async (items) => Object.fromEntries(items.map((i) => [i.infoHash, { verdict: 'dead' }])));
    assert.equal(mixed.picked.stream, direct);
});

test('the probe reads a fresh region in the middle of the file, never the (possibly cached) start', async () => {
    const s = await fakeStreamingServer();
    const MB = 1024 * 1024;
    const p = mk(s.port, { random: () => 0.5 });
    await p.probe(GOOD, 1);
    const [from, to] = s.hits.ranges[0].replace('bytes=', '').split('-').map(Number);
    assert.ok(from >= 300 * MB * 0.15, 'not near the start');
    assert.ok(to < 300 * MB * 0.85, 'not near the end');
    assert.equal(from % MB, 0, 'aligned to 1 MB');
    assert.equal(to - from + 1, 512 * 1024);
    s.close();
});

test('different probes pick different offsets; with no file list yet it falls back to the start', async () => {
    const s = await fakeStreamingServer();
    let n = 0;
    const p = mk(s.port, { random: () => [0.1, 0.9][n++ % 2] });
    await p.probe(GOOD, 0);
    await p.probe(SLOW, 0);
    const starts = s.hits.ranges.map((r) => Number(r.replace('bytes=', '').split('-')[0]));
    assert.notEqual(starts[0], starts[1]);
    const NOFILES = 'e'.repeat(40);
    await mk(s.port).probe(NOFILES, 0);
    assert.equal(s.hits.ranges[s.hits.ranges.length - 1], 'bytes=0-524287');
    s.close();
});
