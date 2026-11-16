'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb } = require('../../../server/db');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');
const { createSessions } = require('../server/sessions');
const { createHistory, MIGRATIONS, streaks, localParts } = require('../server/history');

const DAY = 24 * 3600 * 1000;
const T0 = Date.parse('2026-11-17T18:00:00Z');
const who = (id = 1, name = 'Owner', login = 'a@example.com') => ({ login, profile: { id, name, isKid: false }, device: 'Chrome on macOS' });
const beat = (extra = {}) => ({ session: 'abcdef123456', title: 'The Office - Pilot (1x1)', name: 'The Office', type: 'series', metaId: 'tt0386676', videoId: 'tt0386676:1:1', timeMs: 60000, durationMs: 1320000, paused: false, mode: 'direct', source: 'server', ...extra });

function freshDb() {
    const db = openDb(':memory:', ':memory:');
    db.migratePlugin('nowplaying', MIGRATIONS);
    return db;
}

test('sessions count watched time between playing heartbeats only, capped, and remember transcoding', () => {
    let t = T0;
    const s = createSessions({ now: () => t });
    s.beat(beat(), who());
    t += 15000;
    assert.equal(s.beat(beat(), who()).watchedMs, 15000);
    t += 15000;
    s.beat(beat({ paused: true, mode: 'transcode' }), who()); // the 15 s before this beat were playing
    for (let i = 0; i < 4; i++) { t += 15000; s.beat(beat({ paused: true }), who()); } // paused for a minute: not counted
    t += 15000;
    let cur = s.beat(beat({ paused: false }), who());
    assert.equal(cur.watchedMs, 30000);
    assert.equal(cur.transcoded, true, 'once transcoded, the play counts as transcoded');
    t += 70000; // a background tab slowed down: one gap counts at most 65 s
    cur = s.beat(beat(), who());
    assert.equal(cur.watchedMs, 95000);
    t += 5000;
    const final = s.stop('abcdef123456', 'a@example.com');
    assert.equal(final.watchedMs, 100000, 'the time up to the stop counts too');
    assert.equal(s.list().length, 0);
});

test('history keeps plays of 30 s or more, one row per session, updated in place', () => {
    const db = freshDb();
    let t = T0;
    const h = createHistory({ raw: db.raw, now: () => t });
    const s = createSessions({ now: () => t });
    const go = (ms, extra) => { t += ms; h.record(s.beat(beat(extra), who())); };
    go(0);
    go(15000);
    assert.equal(h.history().total, 0, 'under 30 s is zapping, not a play');
    go(15000);
    go(15000, { timeMs: 105000 });
    const { total, items } = h.history();
    assert.equal(total, 1);
    assert.equal(items[0].watchedMs, 45000);
    assert.equal(items[0].positionMs, 105000);
    assert.deepEqual([items[0].season, items[0].episode, items[0].name, items[0].profile], [1, 1, 'The Office', 'Owner']);
});

test('summary: per-day series in the viewer time zone, hour x weekday grid, breakdowns, top titles, streaks', () => {
    const db = freshDb();
    const t = T0; // 2026-11-17 18:00 UTC = 23:30 in India (UTC+5:30)
    const h = createHistory({ raw: db.raw, now: () => t });
    const add = (startedAt, watchedMs, extra = {}) => h.record({
        login: 'a@example.com', session: `s${startedAt}${extra.title || ''}`, profile: { id: extra.pid || 1, name: extra.pname || 'Owner' },
        title: extra.title || 'The Office - Pilot (1x1)', name: extra.name || 'The Office', type: extra.type || 'series', metaId: extra.metaId || 'tt0386676',
        videoId: 'tt0386676:1:1', poster: null, device: extra.device || 'Chrome on macOS', transcoded: !!extra.transcoded, source: 'server',
        startedAt, updatedAt: startedAt + watchedMs, watchedMs, timeMs: 1, durationMs: 2,
    });
    add(t - 30 * 60000, 20 * 60000); // today 23:00 IST
    add(t - DAY, 40 * 60000, { transcoded: true, device: 'Safari on iPhone' }); // yesterday
    add(t - 2 * DAY, 60 * 60000, { title: 'Film', name: 'Film', type: 'movie', metaId: 'tt1', pid: 2, pname: 'Kid' });
    add(t - 40 * DAY, 10 * 60000); // outside a 30-day window

    const tz = -330; // Date#getTimezoneOffset() in India
    const sum = h.summary({ days: 7, tz });
    assert.equal(sum.perDay.length, 7);
    assert.equal(sum.to, '2026-11-17');
    assert.equal(sum.perDay.at(-1).day, '2026-11-17');
    assert.equal(sum.perDay.at(-1).watchedMs, 20 * 60000);
    assert.equal(sum.totals.plays, 3);
    assert.equal(sum.totals.watchedMs, 120 * 60000);
    assert.equal(sum.totals.titles, 2);
    assert.deepEqual(sum.totals.streak, { current: 3, longest: 3 });
    const local = localParts(t - 30 * 60000, tz);
    assert.equal(sum.grid[local.weekday][local.hour], 20 * 60000);
    assert.deepEqual(sum.topTitles.map((x) => [x.label, x.plays]), [['The Office', 2], ['Film', 1]]);
    assert.deepEqual(sum.modes.map((x) => [x.label, x.watchedMs]), [['Direct play', 80 * 60000], ['Transcoding', 40 * 60000]]);
    assert.deepEqual(sum.types.map((x) => x.label), ['Episodes', 'Movies']);
    assert.deepEqual(sum.profiles.map((x) => x.label), ['Owner', 'Kid']);

    const kid = h.summary({ days: 7, tz, profileId: 2 });
    assert.equal(kid.totals.plays, 1);
    assert.equal(kid.totals.streak.current, 0, 'the kid last watched two days ago');
});

test('streaks', () => {
    assert.deepEqual(streaks(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-15', '2026-11-16'], '2026-11-17'), { current: 2, longest: 3 });
    assert.deepEqual(streaks([], '2026-11-17'), { current: 0, longest: 0 });
});

test('CSV export escapes and retention prunes', () => {
    const db = freshDb();
    let t = T0;
    const h = createHistory({ raw: db.raw, now: () => t, keepDays: 30 });
    const base = { login: 'a@example.com', profile: { id: 1, name: 'Owner' }, type: 'movie', metaId: 'tt1', videoId: 'tt1', device: 'Chrome', source: 'link', watchedMs: 3600000, timeMs: 3600000, durationMs: 7200000 };
    h.record({ ...base, session: 'old', title: 'Old', startedAt: t - 60 * DAY, updatedAt: t - 60 * DAY });
    h.record({ ...base, session: 'new', title: 'Say "Hi", Bob', startedAt: t, updatedAt: t + 3600000 });
    const csv = h.csv().split('\n');
    assert.match(csv[0], /^started,stopped,profile,login,title/);
    assert.match(csv[1], /"Say ""Hi"", Bob"/);
    assert.match(csv[1], /,60,50,/);
    assert.equal(h.pruneOld(), 1);
    assert.equal(h.history().total, 1);
});

async function withServer(app, fn) {
    const srv = app.listen(0);
    try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

function app({ admin, profileId }) {
    const db = freshDb();
    const a = express();
    a.use(express.json());
    const { ctx } = fakeCtx({ id: 'nowplaying', app: a, db, login: { email: 'x@example.com', isAdmin: admin }, profile: { id: profileId, name: `P${profileId}` } });
    const api = register(ctx);
    const rec = (pid, title) => api.history.record({
        login: 'x@example.com', session: `s-${pid}-${title}`, profile: { id: pid, name: `P${pid}` }, title, name: title, type: 'movie', metaId: `tt${pid}`,
        videoId: `tt${pid}`, device: 'Chrome', source: 'server', startedAt: Date.now() - 3600000, updatedAt: Date.now(), watchedMs: 600000, timeMs: 1, durationMs: 2,
    });
    rec(1, 'Owner film');
    rec(2, 'Kid film');
    return a;
}

test('routes: a profile sees only its own stats; admins pick a profile or everyone', async () => {
    await withServer(app({ admin: false, profileId: 2 }), async (base) => {
        const sum = await (await fetch(`${base}/api/stats/summary?days=30&profile=all`)).json();
        assert.equal(sum.totals.plays, 1, 'profile=all is ignored for non-admins');
        assert.equal(sum.admin, false);
        assert.deepEqual(sum.profiles, []);
        const hist = await (await fetch(`${base}/api/stats/history?profile=1`)).json();
        assert.deepEqual(hist.items.map((i) => i.title), ['Kid film']);
        const csv = await fetch(`${base}/api/stats/history.csv`);
        assert.match(csv.headers.get('content-disposition'), /attachment; filename="watch-history-/);
        assert.doesNotMatch(await csv.text(), /Owner film/);
    });
    await withServer(app({ admin: true, profileId: 1 }), async (base) => {
        assert.equal((await (await fetch(`${base}/api/stats/summary?days=7`)).json()).totals.plays, 2);
        assert.equal((await (await fetch(`${base}/api/stats/summary?days=7&profile=2`)).json()).totals.plays, 1);
        const bad = await (await fetch(`${base}/api/stats/summary?days=13`)).json();
        assert.equal(bad.days, 30, 'unknown periods fall back to 30 days');
        assert.equal((await (await fetch(`${base}/api/stats/history?q=kid`)).json()).total, 1);
    });
});
