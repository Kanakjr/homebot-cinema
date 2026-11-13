'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createEventHub, emitAfter, createTorrentWatcher } = require('../events');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(hubOpts) {
    const hub = createEventHub(hubOpts);
    const app = express();
    // stands in for requireLogin
    app.use('/api', (req, res, next) => (req.headers['x-login'] ? next() : res.status(401).json({ error: 'unauthenticated' })));
    app.get('/api/events', hub.handler);
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const url = `http://127.0.0.1:${server.address().port}/api/events`;
    return { hub, url, close: () => { hub.close(); server.closeAllConnections(); server.close(); } };
}

// reads the stream for a while and returns the raw text
async function collect(url, ms, onOpen = () => {}) {
    const ctrl = new AbortController();
    const res = await fetch(url, { headers: { 'x-login': '1' }, signal: ctrl.signal });
    const reader = res.body.getReader();
    let text = '';
    const pump = (async () => {
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                text += Buffer.from(value).toString();
            }
        } catch (_) { /* aborted */ }
    })();
    await wait(30);
    onOpen();
    await wait(ms);
    ctrl.abort();
    await pump;
    return { res, text };
}

test('needs a login; streams with no-store SSE headers', async () => {
    const t = await boot();
    assert.equal((await fetch(t.url)).status, 401);
    const { res } = await collect(t.url, 20);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    assert.match(res.headers.get('cache-control'), /no-store/);
    t.close();
});

test('events reach every connected client; heartbeats keep the connection alive; closed clients are dropped', async () => {
    const t = await boot({ heartbeatMs: 40, throttleMs: 0 });
    const [a, b] = await Promise.all([
        collect(t.url, 120, () => t.hub.emit('downloads', { n: 1 })),
        collect(t.url, 120),
    ]);
    for (const { text } of [a, b]) {
        assert.match(text, /event: downloads\ndata: \{"n":1\}\n\n/);
        assert.match(text, /: hb\n\n/);
    }
    await wait(30);
    assert.equal(t.hub.size(), 0, 'aborted clients are removed');
    t.close();
});

test('bursts are throttled: the first event goes out at once, the rest collapse into one trailing event with the latest data', async () => {
    const t = await boot({ throttleMs: 80 });
    const { text } = await collect(t.url, 200, () => {
        for (let i = 1; i <= 5; i++) t.hub.emit('library', { i });
        t.hub.emit('sentinel');
    });
    const lib = text.match(/event: library\ndata: .*\n/g);
    assert.deepEqual(lib, ['event: library\ndata: {"i":1}\n', 'event: library\ndata: {"i":5}\n']);
    assert.equal((text.match(/event: sentinel/g) || []).length, 1, 'types are throttled separately');
    t.close();
});

test('emitAfter keeps return values and errors, and emits after sync and async methods settle', async () => {
    const seen = [];
    const obj = {
        n: 1,
        syncOk() { return this.n; },
        async asyncOk() { await wait(10); return 'done'; },
        async asyncFail() { throw new Error('nope'); },
        syncFail() { throw new Error('bad'); },
    };
    emitAfter(obj, ['syncOk', 'asyncOk', 'asyncFail', 'syncFail'], (type) => seen.push(type), 'library');
    assert.equal(obj.syncOk(), 1, 'this is preserved');
    const p = obj.asyncOk();
    assert.equal(seen.length, 1, 'async emits only once settled');
    assert.equal(await p, 'done');
    await assert.rejects(obj.asyncFail(), /nope/);
    assert.throws(() => obj.syncFail(), /bad/);
    await wait(5);
    assert.equal(seen.length, 4);
    assert.throws(() => emitAfter(obj, ['missing'], () => {}, 'x'), /not a method/);
});

test('torrent watcher pushes changes, calls onComplete once per finished torrent, and polls faster while downloading', async () => {
    let torrents = [{ hashString: 'h1', status: 4, percentDone: 0.2, rateDownload: 100 }];
    const emitted = [];
    const completed = [];
    const w = createTorrentWatcher({ getTorrents: async () => torrents, emit: (t) => emitted.push(t), onComplete: (h) => completed.push(h), activeMs: 1e6, idleMs: 1e6 });
    assert.equal(await w.tick(), true, 'active while a torrent is incomplete');
    assert.equal(emitted.length, 0, 'the first look is the baseline');
    await w.tick();
    assert.equal(emitted.length, 0, 'no change, no event');
    torrents = [{ hashString: 'h1', status: 4, percentDone: 0.5, rateDownload: 100 }];
    await w.tick();
    assert.deepEqual(emitted, ['downloads']);
    torrents = [{ hashString: 'h1', status: 6, percentDone: 1, rateDownload: 0 }];
    assert.equal(await w.tick(), false, 'idle once everything is done');
    await w.tick();
    assert.deepEqual(completed, ['h1'], 'completion fires once');
    w.stop();
});

test('a torrent that is already complete at start is not reported as newly completed; Transmission outages are ignored', async () => {
    const completed = [];
    let fail = false;
    const w = createTorrentWatcher({ getTorrents: async () => { if (fail) throw new Error('down'); return [{ hashString: 'old', percentDone: 1 }]; }, emit: () => {}, onComplete: (h) => completed.push(h), activeMs: 1e6, idleMs: 1e6 });
    await w.tick();
    fail = true;
    await w.tick();
    fail = false;
    await w.tick();
    assert.deepEqual(completed, []);
    w.stop();
});
