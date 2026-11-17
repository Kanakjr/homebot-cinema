'use strict';
// Plugin "nowplaying": the player sends a heartbeat while it plays (ui/Reporter.js); admins see the live list, and every
// play of 30 s or more is kept as watch history (server/history.js) for the Watch stats page.
//   POST /api/nowplaying             (profile)  heartbeat { session, title, ... }
//   POST /api/nowplaying/stop        (profile)  { session }
//   GET  /api/nowplaying             (admin)    { sessions: [...] }, newest first
//   GET  /api/stats/summary          (profile)  ?days=30&tz=<getTimezoneOffset()>&profile=<id|all> (profile: admins only)
//   GET  /api/stats/history          (profile)  ?q=&limit=&offset=&profile=
//   GET  /api/stats/history.csv      (profile)  ?profile=
// Live sessions are memory only; history lives in nowplaying_plays (data/cinema.db), pruned after NOWPLAYING_KEEP_DAYS.
// Admins see every profile; everyone else only the profile they are using.

const { createSessions, deviceLabel } = require('./sessions');
const { createHistory, MIGRATIONS } = require('./history');

const DAY = 24 * 3600 * 1000;
const PERIODS = [7, 30, 90, 365];

function register(ctx, { now = Date.now } = {}) {
    ctx.db.migrate(MIGRATIONS);
    const sessions = createSessions({ now });
    const history = createHistory({ raw: ctx.db.raw, now, keepDays: ctx.config.int('NOWPLAYING_KEEP_DAYS', 730) });

    const record = (s) => {
        try {
            history.record(s);
        } catch (e) {
            ctx.log.warn(`could not save a play: ${e.message}`);
        }
    };

    ctx.app.post('/api/nowplaying', ctx.auth.requireProfile, (req, res) => {
        const p = req.profile || {};
        const session = sessions.beat(req.body, {
            login: req.login && req.login.email,
            profile: { id: p.id, name: p.name, avatar: p.avatar || null, isKid: !!(p.isKid || p.is_kid) },
            device: deviceLabel(req.get('user-agent')),
        });
        if (!session) return res.status(400).json({ error: 'bad_heartbeat' });
        record(session);
        res.json({ ok: true });
    });

    ctx.app.post('/api/nowplaying/stop', ctx.auth.requireProfile, (req, res) => {
        const final = sessions.stop(req.body && req.body.session, req.login && req.login.email);
        if (final) record(final);
        res.json({ ok: true });
    });

    ctx.app.get('/api/nowplaying', ctx.auth.requireAdmin, (_req, res) => {
        res.json({ sessions: sessions.list() });
    });

    // whose stats: admins pick any profile (or everyone); others always get the profile they are using
    const scope = (req) => {
        const own = req.profile && Number.isInteger(Number(req.profile.id)) ? Number(req.profile.id) : null;
        if (!(req.login && req.login.isAdmin)) return { profileId: own, admin: false };
        const q = String(req.query.profile || 'all');
        return { profileId: /^\d{1,9}$/.test(q) ? Number(q) : null, admin: true };
    };
    const int = (v, def, min, max) => {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };

    ctx.app.get('/api/stats/summary', ctx.auth.requireProfile, (req, res) => {
        const { profileId, admin } = scope(req);
        const days = PERIODS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const tz = int(req.query.tz, 0, -14 * 60, 14 * 60);
        const out = history.summary({ days, profileId, tz });
        if (!admin) out.profiles = []; // a profile's own page has no per-profile ranking
        out.admin = admin;
        out.profileId = profileId;
        res.json(out);
    });

    ctx.app.get('/api/stats/history', ctx.auth.requireProfile, (req, res) => {
        const { profileId } = scope(req);
        res.json(history.history({
            profileId,
            q: String(req.query.q || '').slice(0, 100),
            limit: int(req.query.limit, 50, 1, 200),
            offset: int(req.query.offset, 0, 0, 1e6),
        }));
    });

    ctx.app.get('/api/stats/history.csv', ctx.auth.requireProfile, (req, res) => {
        const { profileId } = scope(req);
        const day = new Date(now()).toISOString().slice(0, 10);
        res.set({
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="watch-history-${day}.csv"`,
        });
        res.send(history.csv({ profileId }));
    });

    // retention: once at boot (after it settles) and then daily
    const prune = () => {
        try {
            const n = history.pruneOld();
            if (n) ctx.log.info(`pruned ${n} old plays`);
        } catch (e) {
            ctx.log.warn(`prune failed: ${e.message}`);
        }
    };
    const first = setTimeout(prune, 60 * 1000);
    const daily = setInterval(prune, DAY);
    if (first.unref) first.unref();
    if (daily.unref) daily.unref();

    return { list: () => sessions.list(), history };
}

module.exports = { register };
