'use strict';
// /api/downloads/stream?direct=1: the desktop player (mpv) gets the original file as stored. No MKV->MP4
// sibling swap, no background faststart remux, no live ffmpeg remux. Default behaviour must not change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const DownloadsManager = require('../downloads_manager');

const MKV = Buffer.from('MKV-ORIGINAL-BYTES-0123456789');
const MP4 = Buffer.from('MP4-SIBLING-BYTES');

function setup({ withSibling }) {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dd-')));
    const movies = path.join(base, 'Movies', 'A (2020)');
    fs.mkdirSync(movies, { recursive: true });
    const mkv = path.join(movies, 'A.mkv');
    fs.writeFileSync(mkv, MKV);
    if (withSibling) fs.writeFileSync(path.join(movies, 'A.mp4'), MP4);
    process.env.MEDIA_ROOTS = path.join(base, 'Movies');

    const manager = new DownloadsManager(path.join(base, 'data'));
    const remuxCalls = [];
    manager.remuxToFaststartMp4 = (p) => remuxCalls.push(p); // never spawn ffmpeg in tests

    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const id = u.searchParams.get('id');
        u.searchParams.delete('id');
        req.query = Object.fromEntries(u.searchParams);
        // the handler uses Express's res.status().json()/set(); give a bare http response the same shape
        res.status = (c) => { res.statusCode = c; return res; };
        res.set = (k, v) => { res.setHeader(k, v); return res; };
        res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
        manager.streamMedia(req, res, id);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
        const get = (file, query = '', headers = {}) => new Promise((ok, fail) => {
            const url = `http://127.0.0.1:${server.address().port}/?id=${encodeURIComponent(file)}${query ? '&' + query : ''}`;
            http.get(url, { headers, agent: false }, (r) => {
                const chunks = [];
                r.on('data', (c) => chunks.push(c));
                r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
            }).on('error', fail);
        });
        resolve({ get, mkv, remuxCalls, close: () => { server.closeAllConnections(); server.close(); } });
    }));
}

test('direct=1 serves the original MKV even when an MP4 sibling exists, and starts no remux', async () => {
    const t = await setup({ withSibling: true });
    const r = await t.get(t.mkv, 'direct=1');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'video/x-matroska');
    assert.deepEqual(r.body, MKV);
    assert.match(r.headers['content-disposition'], /^inline/, 'inline, not a download');
    assert.equal(r.headers['accept-ranges'], 'bytes');
    assert.deepEqual(t.remuxCalls, []);
    t.close();
});

test('direct=1 supports Range requests on the original file', async () => {
    const t = await setup({ withSibling: true });
    const r = await t.get(t.mkv, 'direct=1', { Range: 'bytes=4-11' });
    assert.equal(r.status, 206);
    assert.equal(r.headers['content-range'], `bytes 4-11/${MKV.length}`);
    assert.deepEqual(r.body, MKV.subarray(4, 12));
    t.close();
});

test('direct=1 without an MP4 sibling serves the MKV and does not start the background remux', async () => {
    const t = await setup({ withSibling: false });
    const r = await t.get(t.mkv, 'direct=1');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, MKV);
    assert.deepEqual(t.remuxCalls, []);
    t.close();
});

test('existing behaviour is unchanged without direct=1', async () => {
    const withSibling = await setup({ withSibling: true });
    const swapped = await withSibling.get(withSibling.mkv, 'raw=1');
    assert.deepEqual(swapped.body, MP4, 'an MKV request is still answered with the MP4 sibling');
    assert.deepEqual(withSibling.remuxCalls, []);
    withSibling.close();

    const noSibling = await setup({ withSibling: false });
    const r = await noSibling.get(noSibling.mkv, 'raw=1');
    assert.deepEqual(r.body, MKV);
    assert.equal(noSibling.remuxCalls.length, 1, 'the background remux is still started');
    noSibling.close();
});

test('direct=1 does not widen what can be read: paths outside the media roots are refused', async () => {
    const t = await setup({ withSibling: false });
    const outside = path.join(os.tmpdir(), `dd-outside-${process.pid}.mkv`);
    fs.writeFileSync(outside, 'secret');
    const r = await t.get(outside, 'direct=1');
    assert.equal(r.status, 404);
    fs.unlinkSync(outside);
    t.close();
});
