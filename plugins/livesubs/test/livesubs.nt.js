'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { PassThrough } = require('stream');
const express = require('express');
const { openDb } = require('../../../server/db');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');
const C = require('../server/cues');
const { createEngine, ffmpegArgs } = require('../server/engine');

const pcm = (sec) => Buffer.alloc(Math.round(sec * C.BYTES_PER_SEC));
const tick = () => new Promise((r) => setTimeout(r, 60)); // generous: the engine hops through setImmediate and fake Whisper promises
const QUIET = { warn: () => undefined };

function fakeSpawn() {
    const procs = [];
    const spawn = (cmd, args) => {
        const p = new EventEmitter();
        Object.assign(p, { cmd, args, stdout: new PassThrough(), stderr: new PassThrough(), killed: false });
        p.kill = () => { p.killed = true; p.emit('close', null); };
        p.end = () => { p.stdout.end(); setImmediate(() => p.emit('close', 0)); };
        procs.push(p);
        return p;
    };
    return { spawn, procs, ss: (p) => Number(p.args[p.args.indexOf('-ss') + 1]) };
}

// Whisper stand-in: one line per chunk, 1 s in, unless told otherwise; records each chunk's length
function fakeWhisper(make = (sec, n) => [{ start: 1, end: 3, text: `line ${n}` }]) {
    const calls = [];
    return {
        calls,
        transcribe: async (wav, opts) => {
            const sec = (wav.length - 44) / C.BYTES_PER_SEC;
            calls.push({ sec, opts });
            return { segments: make(sec, calls.length), language: 'en' };
        },
    };
}

test('wavFromPcm writes a 16 kHz mono 16-bit header', () => {
    const wav = C.wavFromPcm(pcm(1));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(40), 32000);
    assert.equal(wav.length, 44 + 32000);
});

test('segmentsToCues: offsets, drops noise and hallucinations, clamps long holds, wraps lines', () => {
    const cues = C.segmentsToCues([
        { start: 0, end: 1, text: ' you' },
        { start: 1, end: 2, text: '[Music]' },
        { start: 2, end: 3, text: ' ♪ ♪ ' },
        { start: 3, end: 16, text: ' Who do I talk to about adoption?' },
        { start: 20, end: 21, text: ' Thank you.' },
        { start: 30, end: 40, text: 'This is a much longer line of dialogue that will need to be wrapped onto more than two lines of text to fit' },
    ], 100);
    assert.equal(cues[0].text, 'Who do I talk to about adoption?');
    assert.equal(cues[0].start, 103);
    assert.ok(cues[0].end - cues[0].start <= 6 && cues[0].end - cues[0].start >= 1, 'a 13 s hold is cut to reading time');
    assert.ok(cues.every((c) => c.text.split('\n').every((l) => l.length <= 42)));
    assert.ok(cues.every((c) => c.text.split('\n').length <= 2));
    assert.equal(cues.filter((c) => c.start >= 130).length, 2, 'the long segment becomes two cues');
    assert.ok(!cues.some((c) => /Thank you|you$|Music|♪/.test(c.text)));
});

test('segmentsToCues drops confident no-speech with a weak transcript', () => {
    assert.equal(C.segmentsToCues([{ start: 0, end: 2, text: 'What', no_speech_prob: 0.9, avg_logprob: -1.2 }]).length, 0);
    assert.equal(C.segmentsToCues([{ start: 0, end: 2, text: 'What', no_speech_prob: 0.9, avg_logprob: -0.2 }]).length, 1);
});

test('commitChunk holds back a sentence cut by the chunk end, and keeps everything at the end of the file', () => {
    const segs = [{ start: 1, end: 5, text: 'a' }, { start: 22, end: 29.8, text: 'cut off mid' }];
    const r = C.commitChunk(segs, { chunkStart: 100, chunkEnd: 130 });
    assert.deepEqual(r.segments.map((s) => s.text), ['a']);
    assert.equal(r.next, 122);
    const e = C.commitChunk(segs, { chunkStart: 100, chunkEnd: 130, eof: true });
    assert.equal(e.segments.length, 2);
    // nothing cut: overlap 1 s with the next chunk
    const ok = C.commitChunk([{ start: 1, end: 20, text: 'a' }], { chunkStart: 100, chunkEnd: 130 });
    assert.equal(ok.next, 129);
    // a single long segment that starts early is committed rather than retried forever
    const long = C.commitChunk([{ start: 2, end: 29.9, text: 'x' }], { chunkStart: 100, chunkEnd: 130 });
    assert.equal(long.segments.length, 1);
});

test('mergeCues drops overlap duplicates; ranges merge; cuesBetween; VTT', () => {
    let list = C.mergeCues([], [{ start: 1, end: 2, text: 'a' }, { start: 28.5, end: 29.5, text: 'b' }]);
    list = C.mergeCues(list, [{ start: 28.6, end: 29.5, text: 'b' }, { start: 31, end: 32, text: 'c' }], 29);
    assert.deepEqual(list.map((c) => c.text), ['a', 'b', 'c']);
    assert.deepEqual(C.addRange([[0, 30]], 29, 60), [[0, 60]]);
    assert.deepEqual(C.addRange([[0, 30]], 100, 130), [[0, 30], [100, 130]]);
    assert.deepEqual(C.cuesBetween(list, 30, 40).map((c) => c.text), ['c']);
    assert.match(C.toVtt(list), /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.000\na/);
});

test('ffmpegArgs: seeks, picks the audio track, pads late audio, 16 kHz mono PCM; reconnects only for HTTP', () => {
    const a = ffmpegArgs('http://ss:11470/abc/0', 299);
    assert.equal(a[a.indexOf('-ss') + 1], '299');
    assert.ok(a.includes('aresample=async=1:first_pts=0'));
    assert.ok(a.includes('-reconnect'));
    assert.deepEqual(a.slice(-7), ['-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1']);
    assert.ok(!ffmpegArgs('/TV/x.mkv', 0).includes('-reconnect'));
});

test('engine: short first chunk from just before the viewer, then 30 s chunks on the media timeline', async () => {
    const sp = fakeSpawn();
    const whisper = fakeWhisper();
    const engine = createEngine({ whisper, spawn: sp.spawn, log: QUIET });
    const t = engine.open({ key: 'k', input: 'http://ss/abc/0', position: 600 });
    assert.equal(sp.procs.length, 1);
    assert.equal(sp.ss(sp.procs[0]), 599);
    sp.procs[0].stdout.write(pcm(8.2));
    await tick();
    assert.equal(whisper.calls.length, 1);
    assert.equal(Math.round(whisper.calls[0].sec), 8);
    assert.equal(t.cues[0].start, 600, 'chunk starts at 599, the line 1 s in');
    sp.procs[0].stdout.write(pcm(40));
    await tick();
    await tick();
    assert.equal(whisper.calls.length, 2);
    assert.equal(Math.round(whisper.calls[1].sec), 30);
    assert.ok(t.cues.length === 2 && t.cues[1].start > 606);
    assert.equal(t.status().state, 'working');
    assert.equal(t.status().firstCueMs !== null, true);
    engine.close();
});

test('engine: reading pauses once far enough ahead of the viewer and resumes as they catch up', async () => {
    const sp = fakeSpawn();
    const engine = createEngine({ whisper: fakeWhisper(() => []), spawn: sp.spawn, maxLeadSec: 60, log: QUIET });
    const t = engine.open({ key: 'k', input: 'http://ss/abc/0', position: 0 });
    sp.procs[0].stdout.write(pcm(70));
    await tick();
    assert.equal(sp.procs[0].stdout.isPaused(), true);
    t.touch(45);
    assert.equal(sp.procs[0].stdout.isPaused(), false);
    engine.close();
});

test('engine: a seek outside what is read restarts ffmpeg there; a seek back into transcribed text does not', async () => {
    const sp = fakeSpawn();
    const engine = createEngine({ whisper: fakeWhisper(), spawn: sp.spawn, log: QUIET });
    const t = engine.open({ key: 'k', input: 'http://ss/abc/0', position: 0 });
    sp.procs[0].stdout.write(pcm(40));
    await tick();
    await tick();
    t.touch(1800);
    assert.equal(sp.procs.length, 2);
    assert.equal(sp.procs[0].killed, true);
    assert.equal(sp.ss(sp.procs[1]), 1799);
    sp.procs[1].stdout.write(pcm(10));
    await tick();
    t.touch(3); // back into the first chunk (transcribed): reading restarts where that text ends, not at 3
    assert.equal(sp.procs.length, 3);
    assert.ok(sp.ss(sp.procs[2]) > 20);
    engine.close();
});

test('engine: end of file flushes the last short chunk', async () => {
    const sp = fakeSpawn();
    const whisper = fakeWhisper((sec) => [{ start: 0.5, end: sec - 0.1, text: 'the end' }]);
    const engine = createEngine({ whisper, spawn: sp.spawn, log: QUIET });
    const t = engine.open({ key: 'k', input: '/TV/x.mkv', position: 0 });
    sp.procs[0].stdout.write(pcm(5));
    sp.procs[0].end();
    await tick();
    await tick();
    assert.equal(whisper.calls.length, 1);
    assert.deepEqual(t.cues.map((c) => c.text), ['the end']);
    engine.close();
});

test('engine: a Whisper error is reported in the status and retried', async () => {
    const sp = fakeSpawn();
    let fail = true;
    const whisper = { transcribe: async () => { if (fail) throw new Error('offline'); return { segments: [] }; } };
    const engine = createEngine({ whisper, spawn: sp.spawn, log: QUIET });
    const t = engine.open({ key: 'k', input: 'http://ss/abc/0', position: 0 });
    sp.procs[0].stdout.write(pcm(9));
    await tick();
    assert.equal(t.status().state, 'error');
    assert.match(t.status().error, /offline/);
    fail = false;
    engine.close();
});

async function withServer(app, fn) {
    const srv = app.listen(0);
    try {
        return await fn(`http://127.0.0.1:${srv.address().port}`);
    } finally {
        srv.close();
    }
}

function setup({ env = { LIVESUBS_WHISPER_URL: 'http://whisper.test' }, library = {} } = {}) {
    const app = express();
    app.use(express.json());
    const opened = [];
    const fakeT = { cues: [{ start: 10, end: 12, text: 'hello' }, { start: 900, end: 901, text: 'far' }], touch: () => undefined, status: () => ({ state: 'working', lead: 30 }) };
    const engine = {
        open: (o) => { opened.push(o); return fakeT; },
        get: (k) => (k ? fakeT : null),
    };
    const { ctx, disabled } = fakeCtx({ id: 'livesubs', app, db: openDb(':memory:', ':memory:'), env: { STREMIO_SERVER_HOST: 'ss', ...env }, services: { library } });
    register(ctx, { engine: env.LIVESUBS_WHISPER_URL ? engine : undefined });
    return { app, opened, disabled };
}

test('stays off without LIVESUBS_WHISPER_URL', () => {
    const { disabled } = setup({ env: {} });
    assert.match(disabled(), /LIVESUBS_WHISPER_URL/);
});

test('POST /api/livesubs/open: torrents read through the streaming server; bad input and URL streams refused', async () => {
    const { app, opened } = setup();
    await withServer(app, async (base) => {
        const post = (body) => fetch(`${base}/api/livesubs/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const ok = await post({ infoHash: 'A'.repeat(40), fileIdx: 3, position: 61.5 });
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('cache-control'), 'private, no-store');
        const j = await ok.json();
        assert.match(j.id, /^[a-f0-9]{16}$/);
        assert.equal(opened[0].input, `http://ss:11470/${'a'.repeat(40)}/3`);
        assert.equal(opened[0].position, 61.5);
        assert.equal((await post({ infoHash: 'nope', fileIdx: 0 })).status, 400);
        assert.equal((await post({ url: 'http://169.254.169.254/latest' })).status, 400);
        assert.equal((await post({ infoHash: 'a'.repeat(40), fileIdx: 0, language: 'en; rm -rf' })).status, 400);
        // translate is part of the cache key
        await post({ infoHash: 'a'.repeat(40), fileIdx: 3, translate: true });
        assert.equal(opened.length, 2);
        assert.notEqual(opened[0].key, opened[1].key);
    });
});

test('library files must resolve inside the media roots', async () => {
    const { app, opened } = setup({ library: { filePath: (id) => (id === 7 ? '/etc/passwd' : null) } });
    await withServer(app, async (base) => {
        const r = await fetch(`${base}/api/livesubs/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: 'lf_7' }) });
        assert.equal(r.status, 400);
        assert.equal(opened.length, 0);
    });
});

test('GET /api/livesubs/:id returns the cue window around the playhead', async () => {
    const { app } = setup();
    await withServer(app, async (base) => {
        const { id } = await (await fetch(`${base}/api/livesubs/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ infoHash: 'b'.repeat(40), fileIdx: 0 }) })).json();
        const r = await fetch(`${base}/api/livesubs/${id}?pos=11`);
        assert.equal(r.headers.get('cache-control'), 'private, no-store');
        const j = await r.json();
        assert.deepEqual(j.cues.map((c) => c.text), ['hello']);
        assert.equal(j.status.state, 'working');
        assert.equal((await fetch(`${base}/api/livesubs/ffffffffffffffff?pos=1`)).status, 404);
        const vtt = await fetch(`${base}/api/livesubs/${id}/vtt`);
        assert.match(await vtt.text(), /^WEBVTT/);
    });
});

test('a real "Thank you." survives when Whisper is sure someone spoke; speaker dashes are stripped', () => {
    const cues = C.segmentsToCues([
        { start: 0, end: 1, text: ' Thank you.', no_speech_prob: 0.01, avg_logprob: -0.2 },
        { start: 2, end: 3, text: ' Thank you.', no_speech_prob: 0.7, avg_logprob: -0.3 },
        { start: 4, end: 5, text: ' - Uh-huh.', no_speech_prob: 0.01 },
    ]);
    assert.deepEqual(cues.map((c) => c.text), ['Thank you.', 'Uh-huh.']);
});

test('engine: release stops reading at once and keeps the text; the next poll restarts it', async () => {
    const sp = fakeSpawn();
    const saved = [];
    const engine = createEngine({ whisper: fakeWhisper(), spawn: sp.spawn, log: QUIET, store: { load: () => null, save: (k, v) => saved.push([k, v.cues.length]) } });
    const t = engine.open({ key: 'k', input: 'http://ss/abc/0', position: 0 });
    sp.procs[0].stdout.write(pcm(9));
    await tick();
    assert.equal(engine.release('k'), true);
    assert.equal(sp.procs[0].killed, true);
    assert.deepEqual(saved, [['k', 1]]);
    t.touch(12);
    assert.equal(sp.procs.length, 2, 'another viewer still watching restarts reading');
    assert.equal(engine.release('nope'), false);
    engine.close();
});

test('POST /api/livesubs/:id/close releases the source; unknown ids are 404', async () => {
    const app = express();
    app.use(express.json());
    const released = [];
    const fakeT = { cues: [], touch: () => undefined, status: () => ({ state: 'working' }) };
    const engine = { open: () => fakeT, get: () => fakeT, release: (k) => { released.push(k); return true; } };
    const { ctx } = fakeCtx({ id: 'livesubs', app, db: openDb(':memory:', ':memory:'), env: { LIVESUBS_WHISPER_URL: 'http://w', STREMIO_SERVER_HOST: 'ss' } });
    register(ctx, { engine });
    await withServer(app, async (base) => {
        const { id } = await (await fetch(`${base}/api/livesubs/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ infoHash: 'c'.repeat(40), fileIdx: 1 }) })).json();
        assert.equal((await fetch(`${base}/api/livesubs/${id}/close`, { method: 'POST' })).status, 200);
        assert.equal(released.length, 1);
        assert.equal((await fetch(`${base}/api/livesubs/0000000000000000/close`, { method: 'POST' })).status, 404);
    });
});

test('livesubs isolates sessions across logins', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.login = { email: req.headers['x-test-user'] || 'alice@example.com', isAdmin: false };
        next();
    });
    const fakeT = { cues: [{ start: 0, end: 1, text: 'hi' }], touch: () => undefined, status: () => ({ state: 'working' }) };
    const engine = { open: () => fakeT, get: () => fakeT, release: () => true };
    const ctx = {
        app,
        auth: { requireLogin: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(), requireProfile: (_req, _res, next) => next() },
        db: { migrate: () => 0, raw: openDb(':memory:', ':memory:').raw },
        config: { get: (k, d) => (k === 'LIVESUBS_WHISPER_URL' ? 'http://w' : d), int: (_k, d) => d },
        services: {},
        sdk: { isInsideRoots: () => true },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    };
    register(ctx, { engine });
    await withServer(app, async (base) => {
        const opened = await (await fetch(`${base}/api/livesubs/open`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'alice@example.com' },
            body: JSON.stringify({ infoHash: 'd'.repeat(40), fileIdx: 0 }),
        })).json();
        assert.equal((await fetch(`${base}/api/livesubs/${opened.id}?pos=10`, { headers: { 'x-test-user': 'bob@example.com' } })).status, 403);
        assert.equal((await fetch(`${base}/api/livesubs/${opened.id}/vtt`, { headers: { 'x-test-user': 'bob@example.com' } })).status, 403);
        assert.equal((await fetch(`${base}/api/livesubs/${opened.id}/close`, { method: 'POST', headers: { 'x-test-user': 'bob@example.com' } })).status, 403);
    });
});
