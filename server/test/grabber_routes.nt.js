'use strict';
// Run: NODE_PATH=<dir with express> node --test server/test/grabber_routes.nt.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../db');
const { QualityStore } = require('../grabber/store');
const { registerGrabberRoutes } = require('../grabber/routes');
const { buildMagnet } = require('../grabber/magnet');
const { BUILTIN } = require('../grabber/quality');

const HASH = 'a'.repeat(40);
const good = { name: 'StreamAddon\n1080p', title: 'Movie.2026.1080p.WEB-DL.x264\n👤 300 💾 2.1 GB', infoHash: HASH };
const huge = { name: 'StreamAddon\n4k', title: 'Movie.2026.2160p.REMUX.HDR\n👤 90 💾 70 GB', infoHash: 'b'.repeat(40) };
const cam = { name: 'StreamAddon\n720p', title: 'Movie.2026.HDCAM.720p\n👤 900 💾 1 GB', infoHash: 'c'.repeat(40) };

async function boot({ probeMany } = {}) {
    const db = openDb(':memory:', ':memory:');
    const store = new QualityStore(db);
    const added = [];
    const downloadsManager = { addDownload: async (a) => { added.push(a); return { id: 'dl_x', ...a }; } };
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api', (req, _res, next) => { req.login = { email: 'u@example.com', isAdmin: req.headers['x-admin'] === '1' }; next(); });
    const requireAdmin = (req, res, next) => (req.login.isAdmin ? next() : res.status(403).json({ error: 'admin_only' }));
    registerGrabberRoutes(app, { store, requireAdmin, downloadsManager, db, probeMany });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const call = async (method, url, { body, admin } = {}) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    return { call, store, added, db, close: () => server.close() };
}

test('built-in profiles are seeded once, with HD Balanced as the default', async () => {
    const t = await boot();
    new QualityStore(t.db); // a second start must not duplicate
    const { profiles } = (await t.call('GET', '/api/grabber/profiles')).json;
    assert.equal(profiles.length, BUILTIN.length);
    assert.deepEqual(profiles.map((p) => p.key), BUILTIN.map((b) => b.key));
    assert.equal(profiles.find((p) => p.isDefault).key, 'hd-balanced');
    assert.ok(profiles.every((p) => p.builtin));
    t.close();
});

test('creating, editing, resetting, defaulting and deleting profiles is admin-only and validated', async () => {
    const t = await boot();
    const body = { name: 'Anime', qualities: ['1080p'], minSeeders: 3, sizes: { '1080p': { movie: { minGB: 0.5, maxGB: 4 }, episode: { minGB: 0.1, maxGB: 1.5 } } }, preferredKeywords: 'subsplease, erai-raws' };
    assert.equal((await t.call('POST', '/api/grabber/profiles', { body })).status, 403);
    assert.equal((await t.call('POST', '/api/grabber/profiles', { body: { ...body, qualities: [] }, admin: true })).status, 400);
    const made = (await t.call('POST', '/api/grabber/profiles', { body, admin: true }));
    assert.equal(made.status, 201);
    assert.deepEqual(made.json.config.preferredKeywords, ['subsplease', 'erai-raws']);
    const id = made.json.id;
    assert.equal((await t.call('PUT', `/api/grabber/profiles/${id}`, { body: { ...body, name: 'Anime v2' } })).status, 403);
    assert.equal((await t.call('PUT', `/api/grabber/profiles/${id}`, { body: { ...body, name: 'Anime v2' }, admin: true })).json.name, 'Anime v2');

    // default + deleting the default falls back to HD Balanced
    assert.equal((await t.call('PUT', '/api/grabber/default', { body: { profileId: id }, admin: true })).status, 200);
    assert.equal(t.store.getDefault().id, id);
    assert.equal((await t.call('DELETE', `/api/grabber/profiles/${id}`, { admin: true })).status, 200);
    assert.equal(t.store.getDefault().key, 'hd-balanced');

    // built-ins: cannot be deleted, can be edited and reset
    const ultra = t.store.list().find((p) => p.key === '4k-ultra');
    assert.equal((await t.call('DELETE', `/api/grabber/profiles/${ultra.id}`, { admin: true })).status, 409);
    await t.call('PUT', `/api/grabber/profiles/${ultra.id}`, { body: { ...ultra.config, name: 'Mine', minSeeders: 99 }, admin: true });
    assert.equal(t.store.get(ultra.id).config.minSeeders, 99);
    const reset = (await t.call('POST', `/api/grabber/profiles/${ultra.id}/reset`, { admin: true })).json;
    assert.equal(reset.name, '4K Ultra HD');
    assert.equal(reset.config.minSeeders, 10);
    assert.equal((await t.call('PUT', '/api/grabber/profiles/99999', { body, admin: true })).status, 404);
    t.close();
});

test('preview marks the best release and explains the rest; unknown profile falls back to the default', async () => {
    const t = await boot();
    const r = (await t.call('POST', '/api/grabber/preview', { body: { profileId: 424242, type: 'movie', streams: [huge, cam, good] } })).json;
    assert.equal(r.profile.name, 'HD Balanced (1080p + 720p)');
    assert.equal(r.best, 2);
    assert.equal(r.acceptedCount, 1);
    assert.equal(r.results[0].accepted, false);
    assert.match(r.results[1].reasons.join(' '), /CAM/);
    assert.equal((await t.call('POST', '/api/grabber/preview', { body: { streams: 'nope' } })).status, 400);
    t.close();
});

test('grab queues the best release with a magnet, a show title and the chosen profile; refuses when nothing fits', async () => {
    const t = await boot();
    const ok = await t.call('POST', '/api/grabber/grab', { body: { streams: [huge, cam, good], meta: { type: 'series', title: 'Silo - S03E01', showTitle: 'Silo', imdbId: 'tt14688458', mediaId: 'tt14688458:3:1', season: 3, episode: 1 } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.picked.resolution, '1080p');
    assert.equal(ok.json.picked.sizeGB, 2.1);
    assert.equal(ok.json.acceptedCount, 1);
    assert.equal(t.added.length, 1);
    assert.match(t.added[0].magnet, new RegExp(`^magnet:\\?xt=urn:btih:${HASH}`));
    assert.equal(t.added[0].showTitle, 'Silo');
    assert.equal(t.added[0].season, 3);

    const none = await t.call('POST', '/api/grabber/grab', { body: { streams: [huge, cam], meta: { type: 'movie', title: 'M' } } });
    assert.equal(none.status, 422);
    assert.equal(none.json.error, 'no_match');
    assert.equal(none.json.considered, 2);
    assert.ok(Object.keys(none.json.rejectedSummary).length > 0);
    assert.equal(t.added.length, 1, 'nothing was queued');

    assert.equal((await t.call('POST', '/api/grabber/grab', { body: { streams: [good], meta: { type: 'tv' } } })).status, 400);
    assert.equal((await t.call('POST', '/api/grabber/grab', { body: { streams: new Array(801).fill(good), meta: { type: 'movie' } } })).status, 400);
    const noMagnet = await t.call('POST', '/api/grabber/grab', { body: { streams: [{ ...good, infoHash: 'zzz' }], meta: { type: 'movie' } } });
    assert.equal(noMagnet.status, 422);
    assert.equal(noMagnet.json.error, 'no_magnet');
    t.close();
});

test('a stream cannot smuggle a non-magnet URL into a download', async () => {
    const t = await boot();
    const evil = { ...good, infoHash: undefined, url: 'http://169.254.169.254/latest/meta-data/' };
    assert.equal((await t.call('POST', '/api/grabber/grab', { body: { streams: [evil], meta: { type: 'movie' } } })).status, 422);
    assert.equal(t.added.length, 0);
    assert.equal(buildMagnet({ url: 'file:///etc/passwd' }), null);
    assert.equal(buildMagnet({ infoHash: '../../x' }), null);
    t.close();
});

test('test endpoint (admin) explains a pasted release for movies and episodes', async () => {
    const t = await boot();
    const body = { release: 'Show.S01E01.1080p.WEB-DL.x264', sizeGB: 4, seeders: 50 };
    assert.equal((await t.call('POST', '/api/grabber/test', { body })).status, 403);
    const r = (await t.call('POST', '/api/grabber/test', { body, admin: true })).json;
    assert.equal(r.parsed.resolution, '1080p');
    assert.equal(r.movie.accepted, true);
    assert.equal(r.episode.accepted, false);
    assert.match(r.episode.reasons[0], /over the 3 GB limit/);
    t.close();
});

test('magnet builder keeps tracker sources from the addon and normalises the hash', () => {
    const m = buildMagnet({ infoHash: HASH.toUpperCase(), sources: ['tracker:udp://t.example:80/announce', 'dht:abc'] }, 'My Show');
    assert.match(m, new RegExp(`btih:${HASH}&dn=My%20Show`));
    assert.match(m, /t\.example/);
    assert.ok(!m.includes('dht'));
    assert.equal(buildMagnet({ magnet: 'magnet:?xt=urn:btih:abc' }), 'magnet:?xt=urn:btih:abc');
});

const mkS = (hash, seeds) => ({ name: 'StreamAddon\n1080p', title: `Movie.2026.1080p.WEB-DL.x264\n👤 ${seeds} 💾 2 GB`, infoHash: hash, fileIdx: 0 });
const verdicts = (map) => async (items) => Object.fromEntries(items.map((i) => [i.infoHash.toLowerCase(), { verdict: map[i.infoHash.toLowerCase()] || 'good' }]));

test('grab skips a dead swarm and queues the next best release that is alive', async () => {
    const DEADH = 'e'.repeat(40), LIVEH = 'f'.repeat(40);
    const t1 = await boot({ probeMany: verdicts({ [DEADH]: 'dead', [LIVEH]: 'good' }) });
    const r = await t1.call('POST', '/api/grabber/grab', { body: { streams: [mkS(DEADH, 5000), mkS(LIVEH, 200)], meta: { type: 'movie', title: 'M' } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.swarm, 'good');
    assert.match(t1.added[0].magnet, new RegExp(LIVEH));
    t1.close();
});

test('grab refuses when every top release is dead (nothing queued), unless forced', async () => {
    const A = 'e'.repeat(40), B2 = 'f'.repeat(40);
    const t2 = await boot({ probeMany: verdicts({ [A]: 'dead', [B2]: 'dead' }) });
    const body = { streams: [mkS(A, 900), mkS(B2, 400)], meta: { type: 'movie', title: 'M' } };
    const no = await t2.call('POST', '/api/grabber/grab', { body });
    assert.equal(no.status, 422);
    assert.equal(no.json.error, 'no_live_swarm');
    assert.equal(no.json.checked, 2);
    assert.equal(t2.added.length, 0);
    const yes = await t2.call('POST', '/api/grabber/grab', { body: { ...body, force: true } });
    assert.equal(yes.status, 200);
    assert.equal(yes.json.swarm, 'dead');
    assert.equal(t2.added.length, 1);
    t2.close();
});
