'use strict';
// Home screen helpers built from the per-profile stremio-core buckets the browser syncs (profile_blobs "library" and
// "library_recent") and Cinemeta's episode lists:
//   continueFor: for each Continue watching title, resume (with time left) or "next up" after the FURTHEST episode watched,
//                not after whichever episode was watched last (a rewatch of S1E2 must not send you back to S1E3).
//   upcoming:    episodes of the profile's shows that air in the next two weeks (or aired in the last day).
// Routes: GET /api/upnext/continue?ids=tt1,tt2 and GET /api/upnext/upcoming (both per profile).

const zlib = require('zlib');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const META_TTL = 6 * HOUR;
const MAX_META = 400;
const ID_RE = /^tt\d{1,10}$/;
const FINISHED = 0.9;

/**
 * stremio-core's watched bitfield ("<anchor video id>:<anchor length>:<base64 zlib bits>") -> Set of watched video ids.
 * Bits follow the meta's video order (LSB first); the anchor realigns them when episodes were added since it was written.
 */
function decodeWatched(serialized, videoIds) {
    const out = new Set();
    if (typeof serialized !== 'string' || !Array.isArray(videoIds) || !videoIds.length) return out;
    const parts = serialized.split(':');
    if (parts.length < 3) return out;
    const b64 = parts.pop();
    const anchorLength = Number(parts.pop());
    const anchor = parts.join(':');
    let bytes;
    try {
        bytes = zlib.inflateSync(Buffer.from(b64, 'base64'));
    } catch (_) {
        return out;
    }
    const anchorIdx = videoIds.indexOf(anchor);
    if (anchorIdx === -1 || !Number.isInteger(anchorLength)) return out;
    const offset = anchorLength - anchorIdx - 1;
    const bit = (i) => i >= 0 && (i >> 3) < bytes.length && (bytes[i >> 3] & (1 << (i & 7))) !== 0;
    videoIds.forEach((id, i) => { if (bit(i + offset)) out.add(id); });
    return out;
}

/** The newest copy of each title across the synced buckets (id -> raw library item). */
function itemsById(buckets) {
    const map = new Map();
    for (const bucket of buckets || []) {
        const items = bucket && bucket.items && typeof bucket.items === 'object' ? bucket.items : {};
        for (const raw of Object.values(items)) {
            if (!raw || !ID_RE.test(String(raw._id))) continue;
            const prev = map.get(raw._id);
            const t = Date.parse(raw._mtime || '') || 0;
            if (!prev || (Date.parse(prev._mtime || '') || 0) < t) map.set(raw._id, raw);
        }
    }
    return map;
}

const episodes = (meta) => (Array.isArray(meta && meta.videos) ? meta.videos : [])
    .filter((v) => v && typeof v.id === 'string' && Number(v.season) > 0 && Number.isFinite(Number(v.episode)))
    .sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

const shapeEpisode = (v) => ({
    id: v.id,
    season: Number(v.season),
    episode: Number(v.episode),
    // "TBA" / "Episode 5" are placeholders, not titles
    title: /^(tba|tbd|tbc|episode \d+)?$/i.test(String(v.name || v.title || '').trim()) ? null : String(v.name || v.title).trim().slice(0, 160),
    released: Number.isFinite(Date.parse(v.released || '')) ? new Date(v.released).toISOString() : null,
    thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : null,
});

/**
 * One Continue watching title -> { id, mode, remainingMs, progress, next }.
 * mode: resume (in progress), next (the episode after the furthest one watched has aired), upcoming (it has not aired yet),
 *       done (nothing after it), none (nothing to say).
 */
function continueState(item, meta, now = Date.now()) {
    const st = (item && item.state) || {};
    const duration = Number(st.duration) || 0;
    const offset = Number(st.timeOffset) || 0;
    const progress = duration > 0 ? Math.min(1, offset / duration) : 0;
    const inProgress = duration > 0 && offset > 1 && progress < FINISHED;
    const base = { id: item._id, mode: 'none', remainingMs: null, progress: Math.round(progress * 1000) / 1000, next: null };
    if (inProgress) return { ...base, mode: 'resume', remainingMs: Math.max(0, Math.round(duration - offset)) };
    if (item.type !== 'series' || !meta) return base;

    const eps = episodes(meta);
    if (!eps.length) return base;
    const watched = decodeWatched(st.watched, meta.videos.map((v) => v.id));
    const current = typeof st.video_id === 'string' ? st.video_id : null;
    const currentDone = current && (progress >= FINISHED || (offset <= 1 && ((Number(st.flaggedWatched) || 0) > 0 || (Number(st.timesWatched) || 0) > 0)));
    if (currentDone) watched.add(current);
    let furthest = -1;
    eps.forEach((v, i) => { if (watched.has(v.id)) furthest = i; });
    if (furthest === -1) return base;
    const next = eps[furthest + 1];
    if (!next) return { ...base, mode: 'done' };
    const ep = shapeEpisode(next);
    const aired = ep.released !== null && Date.parse(ep.released) <= now;
    return { ...base, mode: aired ? 'next' : 'upcoming', next: ep };
}

/** Episodes of `shows` ([{ id, name, poster }] with their metas) airing in [now - 1 day, now + days], soonest first. */
function upcomingEpisodes(shows, metas, now = Date.now(), { days = 14, limit = 30 } = {}) {
    const out = [];
    for (const show of shows) {
        const meta = metas.get(show.id);
        if (!meta) continue;
        for (const v of episodes(meta)) {
            const t = Date.parse(v.released || '');
            if (!Number.isFinite(t) || t < now - DAY || t > now + days * DAY) continue;
            out.push({
                metaId: show.id,
                name: String(meta.name || show.name || '').slice(0, 160),
                poster: meta.poster || show.poster || null,
                background: meta.background || null,
                ...shapeEpisode(v),
                videoId: v.id,
            });
        }
    }
    return out.sort((a, b) => Date.parse(a.released) - Date.parse(b.released)).slice(0, limit);
}

function createUpNext({ raw, fetchImpl = fetch, now = Date.now, concurrency = 6 }) {
    const getBlob = raw.prepare('SELECT json FROM profile_blobs WHERE profile_id = ? AND key = ?');
    const cache = new Map(); // id -> { t, meta | null }
    const inflight = new Map();

    const buckets = (profileId) => ['library', 'library_recent'].map((key) => {
        const row = getBlob.get(profileId, key);
        if (!row) return null;
        try { return JSON.parse(row.json); } catch (_) { return null; }
    });

    /** Cinemeta meta for a series, cached 6 h; a failed fetch keeps the last good copy. */
    async function meta(id) {
        const hit = cache.get(id);
        if (hit && now() - hit.t < META_TTL) return hit.meta;
        if (inflight.has(id)) return inflight.get(id);
        const p = (async () => {
            try {
                const res = await fetchImpl(`${CINEMETA}/meta/series/${id}.json`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error(`cinemeta_http_${res.status}`);
                const m = ((await res.json()) || {}).meta || null;
                if (cache.size >= MAX_META) cache.delete(cache.keys().next().value);
                cache.set(id, { t: now(), meta: m });
                return m;
            } catch (_) {
                return hit ? hit.meta : null;
            } finally {
                inflight.delete(id);
            }
        })();
        inflight.set(id, p);
        return p;
    }

    async function metasFor(ids) {
        const out = new Map();
        let i = 0;
        await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
            while (i < ids.length) {
                const id = ids[i++];
                out.set(id, await meta(id));
            }
        }));
        return out;
    }

    async function continueFor(profileId, ids) {
        const items = itemsById(buckets(profileId));
        const wanted = [...new Set(ids)].filter((id) => ID_RE.test(id) && items.has(id)).slice(0, 40);
        const series = wanted.filter((id) => items.get(id).type === 'series');
        const metas = await metasFor(series);
        return wanted.map((id) => continueState(items.get(id), metas.get(id) || null, now()));
    }

    async function upcoming(profileId, opts) {
        const items = [...itemsById(buckets(profileId)).values()];
        const recent = now() - 45 * DAY;
        const shows = items
            .filter((it) => it.type === 'series' && (!it.removed || (Date.parse((it.state || {}).lastWatched || '') || 0) > recent))
            .sort((a, b) => (Date.parse(b._mtime || '') || 0) - (Date.parse(a._mtime || '') || 0))
            .slice(0, 40)
            .map((it) => ({ id: it._id, name: it.name, poster: it.poster }));
        const metas = await metasFor(shows.map((s) => s.id));
        return upcomingEpisodes(shows, metas, now(), opts);
    }

    return { continueFor, upcoming, meta };
}

function registerUpNextRoutes(app, { upnext, requireProfile }) {
    app.get('/api/upnext/continue', requireProfile, async (req, res) => {
        const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
        try {
            res.json({ items: await upnext.continueFor(req.profile.id, ids) });
        } catch (e) {
            console.error('[UpNext]', e);
            res.status(500).json({ error: 'upnext_failed' });
        }
    });
    app.get('/api/upnext/upcoming', requireProfile, async (req, res) => {
        try {
            res.json({ items: await upnext.upcoming(req.profile.id) });
        } catch (e) {
            console.error('[UpNext]', e);
            res.status(500).json({ error: 'upnext_failed' });
        }
    });
}

module.exports = { createUpNext, registerUpNextRoutes, decodeWatched, continueState, upcomingEpisodes, itemsById };
