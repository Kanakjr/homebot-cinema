'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { register, listInstallers } = require('../server');
const { renderPage, formatSize } = require('../server/page');
const { fakeCtx } = require('../../../server/plugins/testing');

function setup(files = {}) {
    const app = express();
    const { ctx } = fakeCtx({ id: 'getapp', app, login: { email: 'friend@example.com', isAdmin: false } });
    const dir = ctx.dataDir();
    for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), body);
    register(ctx);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${srv.address().port}`;
    return { dir, base, close: () => srv.close() };
}

test('lists only installers, newest first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getapp-'));
    fs.writeFileSync(path.join(dir, 'old.dmg'), 'a');
    fs.writeFileSync(path.join(dir, 'phone.APK'), 'b');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'c');
    fs.writeFileSync(path.join(dir, '.hidden.dmg'), 'd');
    fs.utimesSync(path.join(dir, 'old.dmg'), new Date(1000), new Date(1000));
    const list = listInstallers(dir);
    assert.deepEqual(list.map((i) => [i.name, i.platform]), [['phone.APK', 'android'], ['old.dmg', 'mac']]);
    assert.deepEqual(listInstallers(path.join(dir, 'missing')), []);
});

test('page: download cards, signed-in email escaped, no-store', async () => {
    const t = setup({ 'App-1.0-arm64.dmg': 'x'.repeat(2048) });
    try {
        const res = await fetch(`${t.base}/api/getapp/`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'private, no-store');
        const html = await res.text();
        assert.match(html, /href="file\/App-1\.0-arm64\.dmg"/);
        assert.match(html, /Open Anyway/);
        assert.match(html, /Signed in as friend@example\.com/);
        assert.doesNotMatch(html, /id="android"/, 'no Android section without an APK');
        const bare = await fetch(`${t.base}/api/getapp`, { redirect: 'manual' });
        assert.equal(bare.status, 302);
        assert.equal(bare.headers.get('location'), '/api/getapp/');
    } finally { t.close(); }
});

test('file route serves listed installers only, as no-store attachments', async () => {
    const t = setup({ 'App.dmg': 'dmg-bytes', 'secret.txt': 'nope' });
    try {
        const ok = await fetch(`${t.base}/api/getapp/file/App.dmg`);
        assert.equal(ok.status, 200);
        assert.equal(await ok.text(), 'dmg-bytes');
        assert.match(ok.headers.get('content-disposition'), /attachment; filename="App\.dmg"/);
        assert.equal(ok.headers.get('cache-control'), 'private, no-store');
        for (const bad of ['secret.txt', '..%2Fsecret.txt', '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', 'missing.dmg']) {
            assert.equal((await fetch(`${t.base}/api/getapp/file/${bad}`)).status, 404, bad);
        }
    } finally { t.close(); }
});

test('screenshot shown only when present', async () => {
    const t = setup({});
    try {
        assert.doesNotMatch(await (await fetch(`${t.base}/api/getapp/`)).text(), /class="shot"/);
        assert.equal((await fetch(`${t.base}/api/getapp/screenshot`)).status, 404);
        fs.writeFileSync(path.join(t.dir, 'screenshot.png'), 'png');
        assert.match(await (await fetch(`${t.base}/api/getapp/`)).text(), /class="shot" src="screenshot"/);
        assert.equal((await fetch(`${t.base}/api/getapp/screenshot`)).status, 200);
    } finally { t.close(); }
});

test('renderPage escapes and sizes', () => {
    assert.match(renderPage({ email: '<b>@x' }), /&lt;b&gt;@x/);
    assert.equal(formatSize(35 * 1024 * 1024), '35 MB');
    assert.match(renderPage({}), /No apps have been uploaded yet/);
});
