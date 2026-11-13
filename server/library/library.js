'use strict';
// Server media library: scans /Movies and /TV into SQLite, groups files into one item per movie/show
// (never one card per episode), matches titles to IMDb via Cinemeta, and deletes safely.
// The library is a *logical* view built from parsed names, so it never moves files on disk.

const fs = require('fs');
const path = require('path');
const { parseMediaPath, normTitle, isVideoFile } = require('./parse');
const { isInsideRoots } = require('../media_paths');

const MIN_VIDEO_BYTES = 30 * 1024 * 1024; // ignore samples / trailers
const MATCH_RETRY_MS = 24 * 3600 * 1000;
const CINEMETA = 'https://v3-cinemeta.strem.io';
const art = (kind, imdb) => `https://images.metahub.space/${kind}/medium/${imdb}/img`;

async function defaultFetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

class Library {
    constructor({ db, roots = { movie: '/Movies', series: '/TV' }, fetchJson = defaultFetchJson, minBytes = MIN_VIDEO_BYTES, now = () => Date.now() }) {
        this.raw = db.raw;
        this.db = db;
        this.roots = roots;
        this.fetchJson = fetchJson;
        this.minBytes = minBytes;
        this.now = now;
        this.scanning = false;
        this.status = { running: false, startedAt: null, finishedAt: null, files: 0, items: 0, matched: 0, unmatched: 0, error: null };
    }

    // True when the last scan finished cleanly and the media drives are mounted and non-empty, so "this file is not in
    // the library" can be trusted to mean "it was deleted" (not "the drive is unplugged" / "the scan failed").
    scanTrusted() {
        const s = this.status;
        return !!s.finishedAt && !s.running && !s.error && s.files > 0 && Object.values(this.roots).every((r) => fs.existsSync(r));
    }

    allowedRoots() {
        return Object.values(this.roots);
    }

    // ---------- scanning ----------
    walk(root, type) {
        const found = [];
        const stack = [''];
        while (stack.length) {
            const rel = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
            } catch (_) {
                continue;
            }
            const names = new Set(entries.map((e) => e.name.toLowerCase()));
            for (const e of entries) {
                if (e.name.startsWith('.')) continue;
                const childRel = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) { stack.push(childRel); continue; }
                if (!e.isFile() || !isVideoFile(e.name)) continue;
                // the background remux writes foo.mp4 next to foo.mkv: that is the same episode
                if (/\.mp4$/i.test(e.name) && (names.has(e.name.replace(/\.mp4$/i, '.mkv').toLowerCase()) || names.has(e.name.replace(/\.mp4$/i, '.avi').toLowerCase()))) continue;
                if (/(^|[\s._/-])sample([\s._-]|$)/i.test(childRel)) continue;
                let st;
                try {
                    st = fs.statSync(path.join(root, childRel));
                } catch (_) {
                    continue;
                }
                if (st.size < this.minBytes) continue;
                found.push({ type, rel: childRel, full: path.join(root, childRel), size: st.size, mtime: Math.floor(st.mtimeMs) });
            }
        }
        return found;
    }

    async scan() {
        if (this.scanning) return this.status;
        this.scanning = true;
        this.status = { running: true, startedAt: new Date(this.now()).toISOString(), finishedAt: null, files: 0, items: 0, matched: 0, unmatched: 0, error: null };
        try {
            const files = [];
            for (const [type, root] of Object.entries(this.roots)) files.push(...this.walk(root, type));
            this.status.files = files.length;
            this.persist(files);
            await this.matchPending();
            const c = this.raw.prepare('SELECT COUNT(*) n, SUM(matched > 0) m FROM media_items').get();
            this.status.items = c.n;
            this.status.matched = Number(c.m || 0);
            this.status.unmatched = c.n - Number(c.m || 0);
        } catch (e) {
            this.status.error = e.message;
            console.error('[Library] scan failed:', e.message);
        } finally {
            this.status.running = false;
            this.status.finishedAt = new Date(this.now()).toISOString();
            this.scanning = false;
        }
        return this.status;
    }

    persist(files) {
        const raw = this.raw;
        const nowIso = new Date(this.now()).toISOString();
        const findItem = raw.prepare('SELECT id, year, matched FROM media_items WHERE type = ? AND norm = ?');
        const addItem = raw.prepare('INSERT INTO media_items (type, title, year, norm, folder_path, matched, added_at) VALUES (?, ?, ?, ?, ?, 0, ?) RETURNING id');
        const setYear = raw.prepare('UPDATE media_items SET year = ? WHERE id = ? AND year IS NULL');
        const upsertFile = raw.prepare(`INSERT INTO media_files (media_item_id, season, episode, path, size, resolution, video_codec, mtime, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET media_item_id = excluded.media_item_id, season = excluded.season, episode = excluded.episode,
                size = excluded.size, resolution = excluded.resolution, video_codec = excluded.video_codec, mtime = excluded.mtime`);
        const seen = new Set();
        raw.exec('BEGIN');
        try {
            for (const f of files) {
                const p = parseMediaPath(f.rel, f.type);
                const title = p.title || path.basename(f.rel).replace(/\.[^.]+$/, '');
                const norm = normTitle(title);
                if (!norm) continue;
                let item = findItem.get(f.type, norm);
                if (!item) item = addItem.get(f.type, title, p.year || null, norm, f.rel.split('/')[0], new Date(f.mtime || this.now()).toISOString());
                else if (p.year) setYear.run(p.year, item.id);
                upsertFile.run(item.id, p.season, p.episode, f.full, f.size, p.resolution, p.codec, f.mtime, new Date(f.mtime || this.now()).toISOString());
                seen.add(f.full);
            }
            // drop rows for files that disappeared, then items left without files
            const all = raw.prepare('SELECT id, path FROM media_files').all();
            const del = raw.prepare('DELETE FROM media_files WHERE id = ?');
            for (const r of all) if (!seen.has(r.path)) del.run(r.id);
            raw.exec('DELETE FROM media_items WHERE id NOT IN (SELECT DISTINCT media_item_id FROM media_files)');
            raw.exec('COMMIT');
        } catch (e) {
            raw.exec('ROLLBACK');
            throw e;
        }
        void nowIso;
    }

    // ---------- IMDb matching (Cinemeta) ----------
    async matchPending() {
        const cutoff = new Date(this.now() - MATCH_RETRY_MS).toISOString();
        const pending = this.raw.prepare('SELECT * FROM media_items WHERE matched = 0 AND (match_tried_at IS NULL OR match_tried_at < ?)').all(cutoff);
        for (const item of pending) {
            let meta = null;
            try {
                meta = await this.searchCinemeta(item);
            } catch (e) {
                console.warn(`[Library] match failed for "${item.title}": ${e.message}`);
            }
            if (meta) this.applyMeta(item.id, meta, 1);
            else this.raw.prepare('UPDATE media_items SET match_tried_at = ? WHERE id = ?').run(new Date(this.now()).toISOString(), item.id);
        }
    }

    async searchCinemeta(item) {
        const url = `${CINEMETA}/catalog/${item.type}/top/search=${encodeURIComponent(item.title)}.json`;
        const metas = ((await this.fetchJson(url)) || {}).metas || [];
        const want = normTitle(item.title);
        const yearOf = (m) => Number(String(m.year || m.releaseInfo || '').slice(0, 4)) || null;
        const exact = metas.filter((m) => normTitle(m.name) === want && /^tt\d+/.test(m.imdb_id || m.id || ''));
        if (!exact.length) return null;
        exact.sort((a, b) => {
            const da = item.year && yearOf(a) ? Math.abs(yearOf(a) - item.year) : 50;
            const db = item.year && yearOf(b) ? Math.abs(yearOf(b) - item.year) : 50;
            return da - db;
        });
        const best = exact[0];
        // For movies a far-off year means a different film with the same name. For shows the year in a release
        // name is often the season's year, not the first-air year ("Mirzapur (2024) Season 03"), so it only ranks.
        if (item.type === 'movie' && item.year && yearOf(best) && Math.abs(yearOf(best) - item.year) > 1) return null;
        return { imdb: best.imdb_id || best.id, name: best.name, year: yearOf(best) };
    }

    applyMeta(id, meta, matched) {
        this.raw.prepare(`UPDATE media_items SET imdb_id = ?, title = ?, year = COALESCE(?, year), poster = ?, backdrop = ?, logo = ?, matched = ?, match_tried_at = ? WHERE id = ?`)
            .run(meta.imdb, meta.name, meta.year, art('poster', meta.imdb).replace('/medium/', '/small/'), art('background', meta.imdb), art('logo', meta.imdb), matched, new Date(this.now()).toISOString(), id);
    }

    // Admin fix for a wrong/missing match. matched = 2 means "manual": the scanner never overrides it.
    async identify(id, imdbId) {
        const item = this.raw.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
        if (!item) return null;
        if (!/^tt\d{5,10}$/.test(imdbId || '')) throw Object.assign(new Error('invalid_imdb_id'), { status: 400 });
        const res = await this.fetchJson(`${CINEMETA}/meta/${item.type}/${imdbId}.json`);
        const m = res && res.meta;
        if (!m || !m.name) throw Object.assign(new Error('imdb_not_found'), { status: 404 });
        this.applyMeta(id, { imdb: imdbId, name: m.name, year: Number(String(m.year || m.releaseInfo || '').slice(0, 4)) || null }, 2);
        return this.get(id);
    }

    // ---------- queries ----------
    list({ type, q, sort = 'recent', unmatched, limit, newDays = 3 } = {}) {
        const where = [];
        // files added in the last newDays count as "new" (Home rail badge)
        const args = [new Date(this.now() - newDays * 24 * 3600 * 1000).toISOString()];
        if (type === 'movie' || type === 'series') { where.push('i.type = ?'); args.push(type); }
        if (q) { where.push('i.title LIKE ?'); args.push(`%${String(q).replace(/[%_]/g, '')}%`); }
        if (unmatched) where.push('i.matched = 0');
        const order = { az: 'i.title COLLATE NOCASE ASC', size: 'totalSize DESC', recent: 'lastAdded DESC' }[sort] || 'lastAdded DESC';
        const rows = this.raw.prepare(`
            SELECT i.*, COUNT(f.id) fileCount, COALESCE(SUM(f.size), 0) totalSize, MAX(f.added_at) lastAdded, SUM(f.added_at >= ?) newCount,
                   COUNT(DISTINCT CASE WHEN f.season IS NOT NULL AND f.episode IS NOT NULL THEN f.season * 1000 + f.episode END) episodeCount,
                   GROUP_CONCAT(DISTINCT f.season) seasons
            FROM media_items i JOIN media_files f ON f.media_item_id = i.id
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            GROUP BY i.id ORDER BY ${order}${Number.isInteger(limit) && limit > 0 ? ` LIMIT ${Math.min(limit, 200)}` : ''}`).all(...args);
        const counts = this.raw.prepare(`SELECT COUNT(*) n, SUM(type = 'movie') movies, SUM(type = 'series') series, SUM(matched = 0) unmatched FROM media_items`).get();
        return {
            items: rows.map((r) => this.shape(r)),
            counts: { all: counts.n, movie: Number(counts.movies || 0), series: Number(counts.series || 0), unmatched: Number(counts.unmatched || 0) },
        };
    }

    /** IMDb ids of every matched title on disk ("On server" badge in smart browse). */
    imdbIdsOnServer() {
        return new Set(this.raw.prepare('SELECT DISTINCT imdb_id FROM media_items WHERE matched > 0 AND imdb_id IS NOT NULL').all().map((r) => r.imdb_id));
    }

    /** Video ids ("tt…:season:episode") of every matched episode on disk (Calendar "on server" markers). */
    episodeIds() {
        return this.raw.prepare(`SELECT DISTINCT i.imdb_id || ':' || f.season || ':' || f.episode AS vid
            FROM media_files f JOIN media_items i ON i.id = f.media_item_id
            WHERE i.type = 'series' AND i.matched > 0 AND i.imdb_id IS NOT NULL AND f.season IS NOT NULL AND f.episode IS NOT NULL
            ORDER BY vid`).all().map((r) => r.vid);
    }

    shape(r) {
        return {
            id: r.id, type: r.type, title: r.title, year: r.year, imdbId: r.imdb_id, matched: r.matched > 0,
            poster: r.poster, backdrop: r.backdrop, logo: r.logo,
            fileCount: r.fileCount, episodeCount: r.episodeCount, totalSize: r.totalSize, lastAdded: r.lastAdded, newCount: Number(r.newCount || 0),
            seasons: r.seasons ? String(r.seasons).split(',').map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b) : [],
        };
    }

    get(id) {
        const item = this.raw.prepare('SELECT * FROM media_items WHERE id = ?').get(id);
        return item ? this.detail(item) : null;
    }

    getByImdb(imdbId) {
        const item = this.raw.prepare('SELECT * FROM media_items WHERE imdb_id = ? ORDER BY matched DESC LIMIT 1').get(imdbId);
        return item ? this.detail(item) : null;
    }

    detail(item) {
        const files = this.raw.prepare('SELECT * FROM media_files WHERE media_item_id = ? ORDER BY season, episode, path').all(item.id).map((f) => ({
            id: f.id, streamId: `lf_${f.id}`, season: f.season, episode: f.episode, size: f.size, resolution: f.resolution,
            codec: f.video_codec, name: path.basename(f.path), addedAt: f.added_at,
        }));
        const out = {
            id: item.id, type: item.type, title: item.title, year: item.year, imdbId: item.imdb_id, matched: item.matched > 0,
            poster: item.poster, backdrop: item.backdrop, logo: item.logo,
            totalSize: files.reduce((a, f) => a + (f.size || 0), 0), fileCount: files.length,
        };
        if (item.type === 'movie') return { ...out, files };
        const seasons = new Map();
        const extras = [];
        for (const f of files) {
            if (f.season == null) { extras.push(f); continue; }
            if (!seasons.has(f.season)) seasons.set(f.season, new Map());
            const eps = seasons.get(f.season);
            const key = f.episode == null ? `x${f.id}` : f.episode;
            if (!eps.has(key)) eps.set(key, { episode: f.episode, files: [] });
            eps.get(key).files.push(f);
        }
        return {
            ...out,
            seasons: [...seasons.entries()].sort((a, b) => a[0] - b[0]).map(([season, eps]) => ({
                season,
                episodes: [...eps.values()].sort((a, b) => (a.episode ?? 1e9) - (b.episode ?? 1e9)),
                totalSize: [...eps.values()].flatMap((e) => e.files).reduce((a, f) => a + (f.size || 0), 0),
            })),
            extras,
        };
    }

    filePath(fileId) {
        const row = this.raw.prepare('SELECT path FROM media_files WHERE id = ?').get(fileId);
        return row ? row.path : null;
    }

    // ---------- deleting ----------
    hasVideo(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_) {
            return false;
        }
        return entries.some((e) => (e.isDirectory() ? this.hasVideo(path.join(dir, e.name)) : e.isFile() && isVideoFile(e.name)));
    }

    // Removes folders left without any video (sample/nfo/subs leftovers), never a root itself.
    prune(startDir) {
        const roots = this.allowedRoots().map((r) => { try { return fs.realpathSync(r); } catch (_) { return r; } });
        let dir = startDir;
        for (let i = 0; i < 12; i++) {
            let real;
            try {
                real = fs.realpathSync(dir);
            } catch (_) {
                dir = path.dirname(dir);
                continue;
            }
            if (roots.includes(real) || !isInsideRoots(real, roots)) return;
            if (this.hasVideo(real)) return;
            fs.rmSync(real, { recursive: true, force: true });
            dir = path.dirname(real);
        }
    }

    /** Deletes one file from disk and the library. Returns { path } or null. Refuses paths outside the media roots. */
    deleteFile(fileId) {
        const row = this.raw.prepare('SELECT * FROM media_files WHERE id = ?').get(fileId);
        if (!row) return null;
        const owner = this.raw.prepare('SELECT type, imdb_id FROM media_items WHERE id = ?').get(row.media_item_id) || {};
        const roots = this.allowedRoots();
        if (fs.existsSync(row.path)) {
            if (!isInsideRoots(row.path, roots)) throw Object.assign(new Error('path_outside_media_roots'), { status: 403 });
            fs.unlinkSync(row.path);
            if (/\.(mkv|avi)$/i.test(row.path)) {
                const remuxed = row.path.replace(/\.(mkv|avi)$/i, '.mp4');
                if (fs.existsSync(remuxed) && isInsideRoots(remuxed, roots)) fs.unlinkSync(remuxed);
            }
            this.prune(path.dirname(row.path));
        }
        this.raw.prepare('DELETE FROM media_files WHERE id = ?').run(fileId);
        this.raw.exec('DELETE FROM media_items WHERE id NOT IN (SELECT DISTINCT media_item_id FROM media_files)');
        this.db.audit(null, null, 'library.file_delete', { path: row.path });
        return { path: row.path, type: owner.type || null, imdbId: owner.imdb_id || null, season: row.season, episode: row.episode };
    }

    deleteItem(id, season) {
        const rows = season == null
            ? this.raw.prepare('SELECT id FROM media_files WHERE media_item_id = ?').all(id)
            : this.raw.prepare('SELECT id FROM media_files WHERE media_item_id = ? AND season = ?').all(id, season);
        const deleted = [];
        for (const r of rows) {
            const d = this.deleteFile(r.id);
            if (d) deleted.push(d);
        }
        return deleted;
    }
}

module.exports = { Library, MIN_VIDEO_BYTES };
