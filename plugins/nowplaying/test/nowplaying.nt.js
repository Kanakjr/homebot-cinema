'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');
const { createSessions, deviceLabel, TTL } = require('../server/sessions');

const who = { login: 'a@example.com', profile: { id: 1, name: 'Owner', avatar: null, isKid: false }, device: 'Chrome on macOS' };
const beat = (extra = {}) => ({ session: 'abcdef123456', title: 'The Office - Pilot (1x1)', type: 'series', metaId: 'tt0386676', videoId: 'tt0386676:1:1', timeMs: 60000, durationMs: 1320000, paused: false, mode: 'direct', source: 'server', ...extra });

test('sessions: heartbeats are validated, kept per login, and expire', () => {
    let t = 1_000_000;
    const s = createSessions({ now: () => t });
    assert.equal(s.beat({ ...beat(), session: 'x' }, who), false, 'bad session id');
    assert.equal(s.beat({ ...beat(), title: '' }, who), false, 'no title');
    assert.equal(s.beat(beat(), { ...who, login: null }), false, 'no login');
    assert.equal(s.beat(beat({ mode: 'weird', source: 'ftp', poster: 'javascript:alert(1)', timeMs: -5 }), who), true);
    const [one] = s.list();
    assert.equal(one.mode, 'direct');
    assert.equal(one.source, null);
    assert.equal(one.poster, null);
    assert.equal(one.timeMs, null);
    assert.equal(one.login, 'a@example.com');

    t += 10_000;
    s.beat(beat({ timeMs: 70000, paused: true }), who);
    assert.equal(s.list().length, 1, 'same session updates in place');
    assert.equal(s.list()[0].paused, true);
    assert.equal(s.list()[0].startedAt, new Date(1_000_000).toISOString(), 'start time kept');

    s.stop('abcdef123456', 'someone-else@example.com');
    assert.equal(s.list().length, 1, 'only the same login can stop it');
    t += TTL + 1;
    assert.equal(s.list().length, 0, 'expired');
});

test('device labels', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'), 'Chrome on macOS');
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1'), 'Safari on iPhone');
    assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 12; BRAVIA) AppleWebKit Chrome/120 Safari/537.36'), 'Chrome on Android TV/tablet');
    assert.equal(deviceLabel(''), 'Unknown device');
});

async function withServer(app, fn) {
    const srv = app.listen(0);
    try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('routes: profiles report, only admins list, login comes from the request', async () => {
    const app = express();
    app.use(express.json());
    const { ctx } = fakeCtx({ id: 'nowplaying', app, login: { email: 'kid-parent@example.com', isAdmin: false }, profile: { id: 3, name: 'Kid', is_kid: 1 } });
    register(ctx);
    await withServer(app, async (base) => {
        const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await post('/api/nowplaying', { ...beat(), login: 'spoof@example.com' })).status, 200);
        assert.equal((await post('/api/nowplaying', { session: 'bad' })).status, 400);
        assert.equal((await fetch(`${base}/api/nowplaying`)).status, 403, 'not an admin');
    });

    const adminApp = express();
    adminApp.use(express.json());
    const admin = fakeCtx({ id: 'nowplaying', app: adminApp });
    const api = register(admin.ctx);
    await withServer(adminApp, async (base) => {
        await fetch(`${base}/api/nowplaying`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Firefox/130.0' }, body: JSON.stringify(beat()) });
        const body = await (await fetch(`${base}/api/nowplaying`)).json();
        assert.equal(body.sessions.length, 1);
        assert.equal(body.sessions[0].login, 'admin@example.com');
        assert.equal(body.sessions[0].profile.name, 'Owner');
        assert.equal(body.sessions[0].device, 'Firefox on Windows');
        await fetch(`${base}/api/nowplaying/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: 'abcdef123456' }) });
        assert.equal(api.list().length, 0);
    });
});
