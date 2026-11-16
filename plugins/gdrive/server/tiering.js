'use strict';
// Which local files may move to Google Drive. A file is a candidate only when ALL hold:
//   1. it is on a local root (not already on a cold root), 2. older than minAgeDays,
//   3. watched by at least one profile (watchedBy: 'any') or by every profile ('all'),
//   4. not in the newest local season of a monitored show (Sentinel keeps adding there),
//   5. no torrent still listed in Transmission references it (we never move files out from under a torrent).
// Pure functions: the caller supplies the data, so this is easy to test and cannot touch disk.

const DAY = 86400000;
const isNil = (v) => v === null || v === undefined;
const path = require('path');
const { parseHistory } = require('../../../server/sdk');

/** profile buckets -> Map(imdbId -> { finished, season, episode }) for one profile */
function watchMap(buckets) {
    const m = new Map();
    for (const h of parseHistory(buckets, 100000)) m.set(h.id, h);
    return m;
}

/** Is this file watched by one profile's history? Movies need `finished`; episodes count when the profile is past them. */
function watchedBy(h, f) {
    if (!h) return false;
    if (f.type === 'movie') return !!h.finished;
    if (isNil(f.season) || isNil(f.episode) || isNil(h.season) || isNil(h.episode)) return false;
    if (f.season < h.season) return true;
    if (f.season > h.season) return false;
    return f.episode < h.episode || (f.episode === h.episode && !!h.finished);
}

/**
 * files: [{ path, rel, root, type, imdbId, season, episode, mtime, size }] (local ones only)
 * watched: [Map(imdbId -> history entry)] one per profile; monitored: Set(imdbId)
 * torrentPaths: Set of absolute paths (and directories) still held by Transmission
 */
function selectCandidates({ files, watched, monitored = new Set(), torrentPaths = new Set(), now = Date.now(), minAgeDays = 14, watchedMode = 'any' }) {
    const newest = new Map(); // monitored show -> newest season on disk
    for (const f of files) if (monitored.has(f.imdbId) && !isNil(f.season)) newest.set(f.imdbId, Math.max(newest.get(f.imdbId) ?? 0, f.season));
    const inTorrent = (p) => { for (const t of torrentPaths) if (p === t || p.startsWith(t + path.sep)) return true; return false; };
    const out = []; const skipped = {};
    const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
    for (const f of files) {
        if (!f.imdbId) { skip('unmatched'); continue; }
        if (now - f.mtime < minAgeDays * DAY) { skip('too_new'); continue; }
        if (inTorrent(f.path)) { skip('torrent_active'); continue; }
        if (monitored.has(f.imdbId) && !isNil(f.season) && f.season === newest.get(f.imdbId)) { skip('newest_season_of_monitored'); continue; }
        const flags = watched.map((w) => watchedBy(w.get(f.imdbId), f));
        const ok = watchedMode === 'all' ? flags.length > 0 && flags.every(Boolean) : flags.some(Boolean);
        if (!ok) { skip('not_watched'); continue; }
        out.push(f);
    }
    return { candidates: out, skipped };
}

module.exports = { selectCandidates, watchMap, watchedBy };
