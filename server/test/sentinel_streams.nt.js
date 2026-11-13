'use strict';
// Where Sentinel (and the copilot) ask for release candidates: only the addon the operator configured, never a built-in one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SentinelDaemon = require('../sentinel');

function daemon() {
    const d = new SentinelDaemon({ downloads: {} }, fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-')));
    d.asked = [];
    d.fetchJson = async (url) => { d.asked.push(url); return { streams: [{ name: 'x' }] }; };
    return d;
}
const withEnv = async (value, fn) => {
    const before = process.env.STREAM_ADDON_URL;
    if (value === undefined) delete process.env.STREAM_ADDON_URL; else process.env.STREAM_ADDON_URL = value;
    try { return await fn(); } finally { if (before === undefined) delete process.env.STREAM_ADDON_URL; else process.env.STREAM_ADDON_URL = before; }
};

test('without STREAM_ADDON_URL nothing is requested and no release is returned', async () => {
    await withEnv(undefined, async () => {
        const d = daemon();
        const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
        try {
            assert.deepEqual(await d.fetchStreams('movie', 'tt1'), []);
            assert.deepEqual(await d.fetchStreams('series', 'tt1:1:1'), []);
        } finally { console.warn = warn; }
        assert.deepEqual(d.asked, [], 'no request leaves the server');
        assert.equal(warned, 1, 'the operator is told once, not on every call');
    });
});

test('the configured addon is asked, whether given as a base URL or as the install link', async () => {
    for (const value of ['https://addon.example.com', 'https://addon.example.com/', 'https://addon.example.com/manifest.json', ' https://addon.example.com/ ']) {
        await withEnv(value, async () => {
            const d = daemon();
            assert.equal((await d.fetchStreams('series', 'tt9:2:5')).length, 1);
            assert.deepEqual(d.asked, ['https://addon.example.com/stream/series/tt9:2:5.json'], value);
        });
    }
    await withEnv('https://addon.example.com/sort=seeders|limit=3/manifest.json', async () => {
        const d = daemon();
        await d.fetchStreams('movie', 'tt1');
        assert.deepEqual(d.asked, ['https://addon.example.com/sort=seeders|limit=3/stream/movie/tt1.json'], 'a config path in the install link is kept');
    });
});

test('anything that is not an http(s) URL is ignored', async () => {
    for (const value of ['', 'streamaddon', 'ftp://x/y', 'javascript:alert(1)', 'https://']) {
        await withEnv(value, async () => {
            const d = daemon();
            const warn = console.warn; console.warn = () => {};
            try { assert.deepEqual(await d.fetchStreams('movie', 'tt1'), [], value); } finally { console.warn = warn; }
            assert.deepEqual(d.asked, []);
        });
    }
});
