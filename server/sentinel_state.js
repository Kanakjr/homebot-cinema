'use strict';
// Sentinel bookkeeping that must stay true to what is actually on disk.
// An episode Sentinel once queued can later vanish (the user deleted the file or the whole season). Such an episode
// is moved to `skippedEpisodes`: it is no longer "downloaded", and Sentinel will NOT silently fetch it again (the user
// removed it on purpose). "Re-download" in the UI clears the skip.

const GRACE_MS = 24 * 3600 * 1000; // a freshly queued episode may not be on disk / in the library yet

const pad = (n) => String(n).padStart(2, '0');
const tagOf = (season, episode) => `S${pad(season)}E${pad(episode)}`;
const parseTag = (tag) => {
    const m = /^S(\d+)E(\d+)$/.exec(tag);
    return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
};

/**
 * item: { downloadedEpisodes: string[], skippedEpisodes?: string[], downloadedAt?: {tag: iso} }
 * onDisk: Set<tag>   episodes present in the library
 * active: (tag) => boolean   a download for it is running / finished with its file still there
 * Mutates `item`; returns the tags that were found missing.
 */
function reconcile(item, { onDisk, active, now = Date.now(), graceMs = GRACE_MS }) {
    const removed = [];
    const keep = [];
    const at = item.downloadedAt || {};
    for (const tag of item.downloadedEpisodes || []) {
        const t = at[tag] ? new Date(at[tag]).getTime() : 0;
        const fresh = t && now - t < graceMs;
        if (onDisk.has(tag) || fresh || active(tag)) keep.push(tag);
        else removed.push(tag);
    }
    if (removed.length) {
        item.downloadedEpisodes = keep;
        item.skippedEpisodes = [...new Set([...(item.skippedEpisodes || []), ...removed])].sort();
        for (const tag of removed) delete at[tag];
        item.downloadedAt = at;
    }
    return removed;
}

/** Marks one episode as removed on purpose (admin deleted it in the library). */
function markSkipped(item, tag) {
    item.downloadedEpisodes = (item.downloadedEpisodes || []).filter((t) => t !== tag);
    item.skippedEpisodes = [...new Set([...(item.skippedEpisodes || []), tag])].sort();
    if (item.downloadedAt) delete item.downloadedAt[tag];
}

/** Clears skips (all, or one season) so Sentinel fetches those episodes again. Returns the cleared tags. */
function clearSkipped(item, season) {
    const all = item.skippedEpisodes || [];
    const cleared = all.filter((t) => season === undefined || season === null || (parseTag(t) || {}).season === Number(season));
    item.skippedEpisodes = all.filter((t) => !cleared.includes(t));
    return cleared;
}

// ---------- what a monitor is allowed to download ----------
// scope = { mode: 'new', since: 'YYYY-MM-DD' }  only episodes that air from that day on (nothing from the back catalog)
//       | { mode: 'seasons', seasons: [2] }      every aired episode of those seasons, plus the rest of them as they air
//       | { mode: 'all' }                        everything that has aired
// Monitors saved before scopes existed have none and keep behaving as 'all'.
function normalizeScope(scope, now = Date.now()) {
    const s = scope && typeof scope === 'object' ? scope : {};
    if (s.mode === 'all') return { mode: 'all' };
    if (s.mode === 'seasons') {
        const seasons = [...new Set((Array.isArray(s.seasons) ? s.seasons : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 200))].sort((a, b) => a - b);
        if (!seasons.length) throw Object.assign(new Error('scope.seasons must list at least one season'), { status: 400 });
        return { mode: 'seasons', seasons };
    }
    if (s.mode !== undefined && s.mode !== 'new') throw Object.assign(new Error('scope.mode must be new, seasons or all'), { status: 400 });
    return { mode: 'new', since: /^\d{4}-\d{2}-\d{2}$/.test(s.since || '') ? s.since : new Date(now).toISOString().slice(0, 10) };
}

function inScope(scope, season, released) {
    const sc = scope || { mode: 'all' };
    if (sc.mode === 'all') return true;
    if (sc.mode === 'seasons') return sc.seasons.includes(season);
    const t = Date.parse(released || '');
    return Number.isFinite(t) && t >= Date.parse(`${sc.since}T00:00:00Z`); // unknown air date: cannot tell it is new
}

function scopeLabel(scope) {
    const sc = scope || { mode: 'all' };
    if (sc.mode === 'all') return 'All seasons';
    if (sc.mode === 'seasons') return `Season${sc.seasons.length === 1 ? '' : 's'} ${sc.seasons.join(', ')}`;
    return 'New episodes only';
}

module.exports = { reconcile, markSkipped, clearSkipped, tagOf, parseTag, GRACE_MS, normalizeScope, inScope, scopeLabel };
