'use strict';
// Plugin "nowplaying": watch history and stats (Tautulli-style), from the same heartbeats as Now playing.
// One row per play (a session: one title in one tab), upserted on every heartbeat so a crash or a closed tab loses at most
// 15 s. A play is kept once it has 30 s of real watching; paused time never counts. Everything stays in data/cinema.db.

const MIN_WATCHED = 30 * 1000;
const DAY = 24 * 3600 * 1000;

const MIGRATIONS = [
    `CREATE TABLE nowplaying_plays (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        login        TEXT NOT NULL,
        session      TEXT NOT NULL,
        profile_id   INTEGER,
        profile_name TEXT,
        is_kid       INTEGER NOT NULL DEFAULT 0,
        title        TEXT NOT NULL,
        name         TEXT,
        type         TEXT,
        meta_id      TEXT,
        video_id     TEXT,
        season       INTEGER,
        episode      INTEGER,
        poster       TEXT,
        device       TEXT,
        mode         TEXT NOT NULL DEFAULT 'direct',
        source       TEXT,
        started_at   INTEGER NOT NULL,
        stopped_at   INTEGER NOT NULL,
        watched_ms   INTEGER NOT NULL DEFAULT 0,
        position_ms  INTEGER,
        duration_ms  INTEGER,
        UNIQUE (login, session)
    )`,
    'CREATE INDEX nowplaying_plays_started ON nowplaying_plays (started_at)',
    'CREATE INDEX nowplaying_plays_profile ON nowplaying_plays (profile_id, started_at)',
];

const episodeOf = (videoId) => {
    const m = /:(\d{1,4}):(\d{1,5})$/.exec(String(videoId || ''));
    return m ? { season: Number(m[1]), episode: Number(m[2]) } : { season: null, episode: null };
};

/** Local calendar day / hour / weekday of a timestamp, for a viewer whose Date#getTimezoneOffset() is tzOffsetMin. */
function localParts(t, tzOffsetMin) {
    const d = new Date(t - tzOffsetMin * 60000);
    return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

/** Consecutive days with at least one play: the current streak (ending today or yesterday) and the longest. */
function streaks(daysWithPlays, today) {
    const set = new Set(daysWithPlays);
    const sorted = [...set].sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const d of sorted) {
        run = prev && Date.parse(d) - Date.parse(prev) === DAY ? run + 1 : 1;
        longest = Math.max(longest, run);
        prev = d;
    }
    let current = 0;
    let cursor = set.has(today) ? today : new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
    while (set.has(cursor)) {
        current++;
        cursor = new Date(Date.parse(cursor) - DAY).toISOString().slice(0, 10);
    }
    return { current, longest };
}

function createHistory({ raw, now = Date.now, keepDays = 730 }) {
    const upsert = raw.prepare(`INSERT INTO nowplaying_plays
        (login, session, profile_id, profile_name, is_kid, title, name, type, meta_id, video_id, season, episode, poster, device,
         mode, source, started_at, stopped_at, watched_ms, position_ms, duration_ms)
        VALUES (@login, @session, @profile_id, @profile_name, @is_kid, @title, @name, @type, @meta_id, @video_id, @season, @episode,
         @poster, @device, @mode, @source, @started_at, @stopped_at, @watched_ms, @position_ms, @duration_ms)
        ON CONFLICT (login, session) DO UPDATE SET
            stopped_at = excluded.stopped_at, watched_ms = MAX(watched_ms, excluded.watched_ms), position_ms = excluded.position_ms,
            duration_ms = excluded.duration_ms, mode = excluded.mode, source = COALESCE(excluded.source, source),
            poster = COALESCE(excluded.poster, poster)`);
    const prune = raw.prepare('DELETE FROM nowplaying_plays WHERE stopped_at < ?');

    /** Stores a session from sessions.js once it has 30 s of watching (called after every heartbeat). */
    function record(s) {
        if (!s || s.watchedMs < MIN_WATCHED) return false;
        const ep = episodeOf(s.videoId);
        upsert.run({
            login: s.login, session: s.session,
            profile_id: s.profile && Number.isInteger(s.profile.id) ? s.profile.id : null,
            profile_name: (s.profile && s.profile.name) || null,
            is_kid: s.profile && s.profile.isKid ? 1 : 0,
            title: s.title, name: s.name || null, type: s.type || null, meta_id: s.metaId || null, video_id: s.videoId || null,
            season: ep.season, episode: ep.episode, poster: s.poster || null, device: s.device || null,
            mode: s.transcoded ? 'transcode' : 'direct', source: s.source || null,
            started_at: s.startedAt, stopped_at: s.updatedAt, watched_ms: Math.round(s.watchedMs),
            position_ms: Number.isFinite(s.timeMs) ? s.timeMs : null, duration_ms: Number.isFinite(s.durationMs) ? s.durationMs : null,
        });
        return true;
    }

    /** Rows in [from, to) for one profile (or everyone), newest first. */
    function rows({ from = 0, to = now() + DAY, profileId = null } = {}) {
        const where = ['started_at >= ?', 'started_at < ?'];
        const args = [from, to];
        if (profileId !== null) {
            where.push('profile_id = ?');
            args.push(profileId);
        }
        return raw.prepare(`SELECT * FROM nowplaying_plays WHERE ${where.join(' AND ')} ORDER BY started_at DESC`).all(...args);
    }

    /** One page of history, with an optional text filter on the title. */
    function history({ profileId = null, q = '', limit = 50, offset = 0 } = {}) {
        const where = [];
        const args = [];
        if (profileId !== null) {
            where.push('profile_id = ?');
            args.push(profileId);
        }
        if (q) {
            where.push('(title LIKE ? OR name LIKE ?)');
            args.push(`%${q}%`, `%${q}%`);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = raw.prepare(`SELECT COUNT(*) n FROM nowplaying_plays ${clause}`).get(...args).n;
        const items = raw.prepare(`SELECT * FROM nowplaying_plays ${clause} ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
        return { total, items: items.map(shapeRow) };
    }

    /** Totals, a per-day series, the hour x weekday grid, breakdowns and top lists for the last `days` days. */
    function summary({ days = 30, profileId = null, tz = 0 } = {}) {
        const t = now();
        const today = localParts(t, tz).day;
        const firstDay = new Date(Date.parse(today) - (days - 1) * DAY).toISOString().slice(0, 10);
        // local midnight of the first day, as a UTC timestamp
        const from = Date.parse(firstDay) + tz * 60000;
        const list = rows({ from, to: t + DAY, profileId });

        const perDay = new Map();
        for (let i = 0; i < days; i++) {
            const d = new Date(Date.parse(firstDay) + i * DAY).toISOString().slice(0, 10);
            perDay.set(d, { day: d, plays: 0, watchedMs: 0 });
        }
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0)); // [weekday][hour] watched ms
        const group = (key) => {
            const m = new Map();
            return {
                add(k, label, row) {
                    if (k === null || k === undefined || k === '') return;
                    const e = m.get(k) || { key: k, label, plays: 0, watchedMs: 0, poster: null, type: null };
                    e.plays++;
                    e.watchedMs += row.watched_ms;
                    e.poster = e.poster || row.poster;
                    e.type = e.type || row.type;
                    m.set(k, e);
                },
                top(n) {
                    return [...m.values()].sort((a, b) => b.watchedMs - a.watchedMs).slice(0, n);
                },
                name: key,
            };
        };
        const byTitle = group('title');
        const byProfile = group('profile');
        const byDevice = group('device');
        const byMode = group('mode');
        const bySource = group('source');
        const byType = group('type');
        let watchedMs = 0;
        for (const r of list) {
            const p = localParts(r.started_at, tz);
            const bucket = perDay.get(p.day);
            if (bucket) {
                bucket.plays++;
                bucket.watchedMs += r.watched_ms;
            }
            grid[p.weekday][p.hour] += r.watched_ms;
            watchedMs += r.watched_ms;
            byTitle.add(r.meta_id || r.title, r.name || r.title, r);
            byProfile.add(r.profile_id, r.profile_name || 'Unknown profile', r);
            byDevice.add(r.device, r.device, r);
            byMode.add(r.mode, r.mode === 'transcode' ? 'Transcoding' : 'Direct play', r);
            bySource.add(r.source, { server: 'Files on this server', torrent: 'Torrents', link: 'Web links' }[r.source] || r.source, r);
            byType.add(r.type, r.type === 'series' ? 'Episodes' : r.type === 'movie' ? 'Movies' : r.type, r);
        }
        // streaks look at the whole history of this profile (or household), not only the window
        const allDays = rows({ from: t - 3 * 365 * DAY, to: t + DAY, profileId }).map((r) => localParts(r.started_at, tz).day);
        return {
            days, from: firstDay, to: today,
            totals: {
                plays: list.length,
                watchedMs,
                titles: new Set(list.map((r) => r.meta_id || r.title)).size,
                profiles: new Set(list.map((r) => r.profile_id)).size,
                streak: streaks(allDays, today),
            },
            perDay: [...perDay.values()],
            grid,
            topTitles: byTitle.top(10),
            profiles: byProfile.top(8),
            devices: byDevice.top(6),
            modes: byMode.top(2),
            sources: bySource.top(3),
            types: byType.top(2),
        };
    }

    /** Every row as CSV (newest first). */
    function csv({ profileId = null } = {}) {
        const cols = ['started', 'stopped', 'profile', 'login', 'title', 'type', 'season', 'episode', 'watched_minutes', 'percent', 'device', 'playback', 'source', 'meta_id', 'video_id'];
        const esc = (v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = rows({ from: 0, profileId }).map((r) => {
            const pct = r.duration_ms ? Math.min(100, Math.round((r.position_ms || 0) / r.duration_ms * 100)) : '';
            return [new Date(r.started_at).toISOString(), new Date(r.stopped_at).toISOString(), r.profile_name, r.login, r.title, r.type,
                r.season, r.episode, Math.round(r.watched_ms / 60000), pct, r.device, r.mode, r.source, r.meta_id, r.video_id].map(esc).join(',');
        });
        return [cols.join(','), ...lines].join('\n') + '\n';
    }

    /** Drops plays older than keepDays (0 = keep forever). */
    function pruneOld() {
        if (!(keepDays > 0)) return 0;
        return prune.run(now() - keepDays * DAY).changes;
    }

    return { record, history, summary, csv, pruneOld };
}

function shapeRow(r) {
    return {
        id: r.id, profileId: r.profile_id, profile: r.profile_name, isKid: !!r.is_kid, login: r.login,
        title: r.title, name: r.name, type: r.type, metaId: r.meta_id, videoId: r.video_id, season: r.season, episode: r.episode,
        poster: r.poster, device: r.device, mode: r.mode, source: r.source,
        startedAt: new Date(r.started_at).toISOString(), stoppedAt: new Date(r.stopped_at).toISOString(),
        watchedMs: r.watched_ms, positionMs: r.position_ms, durationMs: r.duration_ms,
    };
}

module.exports = { createHistory, MIGRATIONS, MIN_WATCHED, streaks, localParts };
