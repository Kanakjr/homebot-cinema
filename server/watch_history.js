'use strict';
// Watch history from the per-profile stremio-core buckets the browser syncs ("library" = saved titles,
// "library_recent" = recently watched). Shared by the AI brief and the Google Drive tiering plan.

const ID_RE = /^tt\d+$/;

/**
 * Watch history from the two stremio-core buckets the browser syncs ("library" = saved titles, "library_recent" = recently watched).
 * Newest first. `finished` / `progress` describe the last movie or episode watched.
 */
function parseHistory(buckets, limit = 40) {
    const byId = new Map();
    for (const bucket of buckets || []) {
        const items = bucket && bucket.items && typeof bucket.items === 'object' ? bucket.items : {};
        for (const raw of Object.values(items)) {
            if (!raw || raw.removed || !ID_RE.test(String(raw._id)) || (raw.type !== 'movie' && raw.type !== 'series')) continue;
            const st = raw.state || {};
            const last = Date.parse(st.lastWatched || '');
            if (!Number.isFinite(last)) continue;
            const m = typeof st.video_id === 'string' ? /^tt\d+:(\d+):(\d+)$/.exec(st.video_id) : null;
            const duration = Number(st.duration) || 0;
            const offset = Number(st.timeOffset) || 0;
            const progress = duration > 0 ? Math.min(1, offset / duration) : null;
            const entry = {
                id: raw._id, type: raw.type, name: String(raw.name || '').slice(0, 120), poster: typeof raw.poster === 'string' ? raw.poster : null,
                lastWatched: last, season: m ? Number(m[1]) : null, episode: m ? Number(m[2]) : null, progress,
                finished: (Number(st.timesWatched) || 0) > 0 || (Number(st.flaggedWatched) || 0) > 0 || (progress !== null && progress >= 0.9),
            };
            const prev = byId.get(entry.id);
            if (!prev || prev.lastWatched < entry.lastWatched) byId.set(entry.id, entry);
        }
    }
    return [...byId.values()].sort((a, b) => b.lastWatched - a.lastWatched).slice(0, limit);
}

/** History of one profile read from the profile_blobs table. */
function profileHistory(raw, profileId, limit) {
    const getBlob = raw.prepare('SELECT json FROM profile_blobs WHERE profile_id = ? AND key = ?');
    const read = (key) => {
        const row = getBlob.get(profileId, key);
        if (!row) return null;
        try { return JSON.parse(row.json); } catch (_) { return null; }
    };
    return parseHistory([read('library'), read('library_recent')], limit);
}

module.exports = { parseHistory, profileHistory };
