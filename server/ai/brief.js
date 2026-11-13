'use strict';
// The brief injected into the copilot's system prompt every turn (GrowwTrader's "portfolio brief", for a cinema).
// Titles only: no emails, profile names, PINs or file paths ever go to the model.

const ID_RE = /^tt\d+$/;
const DAY = 24 * 3600 * 1000;

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

const ago = (ts, now) => {
    const d = Math.floor((now - ts) / DAY);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return `${d} days ago`;
    if (d < 60) return `${Math.round(d / 7)} weeks ago`;
    return `${Math.round(d / 30)} months ago`;
};
const epTag = (h) => (h.season !== null ? ` S${String(h.season).padStart(2, '0')}E${String(h.episode).padStart(2, '0')}` : '');
const describe = (h, now) => {
    const state = h.finished ? 'finished' : (h.progress !== null && h.progress > 0.02 ? `${Math.round(h.progress * 100)}% through` : 'just started');
    return `${h.name}${epTag(h)} (${h.type}), ${ago(h.lastWatched, now)}, ${state}`;
};

function createBrief({ raw, library, downloadsManager, sentinel, qualityStore, staging, region = 'IN', now = () => Date.now(), ttlMs = 20000 }) {
    const getBlob = raw.prepare('SELECT json FROM profile_blobs WHERE profile_id = ? AND key = ?');
    const cache = new Map(); // profileId -> { ts, text, catalog }

    const readBucket = (profileId, key) => {
        const row = getBlob.get(profileId, key);
        if (!row) return null;
        try { return JSON.parse(row.json); } catch (_) { return null; }
    };
    const history = (profileId, limit) => parseHistory([readBucket(profileId, 'library'), readBucket(profileId, 'library_recent')], limit);
    const savedCount = (profileId) => {
        const b = readBucket(profileId, 'library');
        return b && b.items ? Object.values(b.items).filter((i) => i && !i.removed && ID_RE.test(String(i._id))).length : 0;
    };

    /** Returns { text, catalog }: the brief text, and the titles it mentions (id -> card data) so they can be shown as cards. */
    async function build({ profile, login }) {
        const t = now();
        const hit = cache.get(profile.id);
        let base = hit && t - hit.ts < ttlMs ? hit : null;
        if (!base) {
            const lines = [];
            const catalog = new Map();
            const kids = !!profile.is_kid;
            const today = new Date(t);
            lines.push(`TODAY: ${today.toISOString().slice(0, 10)} (${today.toLocaleDateString('en-US', { weekday: 'long' })}). Streaming region: ${region}.`);
            lines.push(kids
                ? 'PROFILE: KIDS profile. Suggest only child-friendly titles. This profile cannot stage downloads or monitors.'
                : `PROFILE: regular profile. ${login.isAdmin ? 'Admin: may also stage a monitor (auto-download new episodes of a series).' : 'Not an admin: cannot stage monitors.'}`);
            try {
                const profiles = qualityStore.list();
                const def = profiles.find((p) => p.isDefault);
                lines.push(`QUALITY PROFILES for downloads: ${profiles.map((p) => p.name + (p.isDefault ? ' (default)' : '')).join('; ')}.`);
                if (def) lines.push(`Default profile: ${def.name}.`);
            } catch (_) { /* optional */ }

            const hist = history(profile.id, 40);
            for (const h of hist) catalog.set(h.id, { id: h.id, type: h.type, title: h.name, poster: h.poster });
            const recent = hist.slice(0, 10);
            lines.push(recent.length ? 'RECENTLY WATCHED (newest first):\n' + recent.map((h) => `- ${describe(h, t)} [${h.id}]`).join('\n') : 'RECENTLY WATCHED: nothing yet.');
            const unfinished = hist.filter((h) => !h.finished && h.progress !== null && h.progress > 0.02).slice(0, 5);
            if (unfinished.length) lines.push('UNFINISHED (could continue):\n' + unfinished.map((h) => `- ${describe(h, t)} [${h.id}]`).join('\n'));
            lines.push(`Saved library: ${savedCount(profile.id)} titles.`);

            // titles on the server and in the downloader cannot be age-checked, so kids profiles only get counts
            if (kids) {
                try {
                    const c = library.list({ limit: 1 }).counts;
                    lines.push(`SERVER LIBRARY: ${c.movie} movies and ${c.series} series on the server (titles are not listed for kids profiles).`);
                } catch (_) { /* optional */ }
            } else try {
                const lib = library.list({ sort: 'recent', limit: 8 });
                const c = lib.counts;
                lines.push(`SERVER LIBRARY: ${c.movie} movies and ${c.series} series on the server. Newest:\n` + (lib.items.length
                    ? lib.items.map((i) => `- ${i.title}${i.year ? ` (${i.year})` : ''} (${i.type}${i.type === 'series' ? `, ${i.episodeCount} episodes` : ''})${i.imdbId ? ` [${i.imdbId}]` : ''}`).join('\n') : '- none'));
                for (const i of lib.items) if (i.imdbId) catalog.set(i.imdbId, { id: i.imdbId, type: i.type, title: i.title, year: i.year, poster: i.poster, onServer: true, libraryId: i.id });
            } catch (_) { /* library unavailable */ }

            if (!kids) try {
                const dl = await downloadsManager.listDownloads();
                const active = (dl.active || []).slice(0, 6);
                lines.push(`DOWNLOADS: ${(dl.active || []).length} active.` + (active.length ? '\n' + active.map((d) => `- ${String(d.title || '').slice(0, 80)}: ${d.status}, ${Math.round((Number(d.progress) || 0) * 100)}%`).join('\n') : ''));
                if (dl.disk) lines.push(`Disk: ${dl.disk.freeGB} GB free of ${dl.disk.totalGB} GB.`);
            } catch (_) { /* downloader unavailable */ }

            if (!kids) try {
                const mon = sentinel.getMonitored();
                if (mon.length) lines.push('MONITORED SERIES (new episodes are fetched automatically): ' + mon.slice(0, 12).map((m) => `${m.title} (${m.scopeLabel})`).join('; ') + '.');
            } catch (_) { /* optional */ }

            base = { ts: t, text: lines.join('\n'), catalog };
            cache.set(profile.id, base);
            if (cache.size > 50) cache.delete(cache.keys().next().value);
        }
        // pending actions change within a conversation, so they are never cached
        const pending = staging.list({ email: login.email, profileId: profile.id });
        const tail = pending.length ? '\nPENDING FOR CONFIRMATION: ' + pending.map((p) => p.card.summary).join('; ') + '.' : '';
        return { text: 'CINEMA BRIEF (live data)\n' + base.text + tail, catalog: new Map(base.catalog) };
    }

    return { build, history };
}

module.exports = { createBrief, parseHistory };
