'use strict';
// Plugin "gdrive": Google Drive (or any rclone/NFS mount) as extra "cold" library roots, plus a tiering plan that lists which
// local files may move to the drive. Core does the safe part (marker check, offline roots never pruned, 503 on delete while
// offline); this plugin only supplies the roots and the plan. Nothing here moves files: scripts/move-to-drive.sh does, by hand.

const fs = require('fs');
const path = require('path');
const { selectCandidates, watchMap } = require('./tiering');
const { profileHistory } = require('../../../server/sdk');

/** Builds the plan and writes <dataDir>/tiering/{Movies,TV}.txt (paths relative to each local root). */
async function buildTieringPlan({ raw, library, downloads, sentinel, outDir, minAgeDays = 14, watchedMode = 'any', now = Date.now() }) {
    const cold = library.coldRootList();
    const files = raw.prepare('SELECT f.path, f.mtime, f.season, f.episode, i.type, i.imdb_id imdbId FROM media_files f JOIN media_items i ON i.id = f.media_item_id').all()
        .filter((f) => !cold.some((r) => f.path === r || f.path.startsWith(r + path.sep)));
    const local = { movie: library.roots.movie, series: library.roots.series };
    const rows = files
        .filter((f) => local[f.type] && f.path.startsWith(String(local[f.type]) + path.sep))
        .map((f) => ({ ...f, root: local[f.type], rel: f.path.slice(String(local[f.type]).length + 1) }));
    const watched = raw.prepare('SELECT id FROM profiles').all().map((p) => watchMap(profileHistory(raw, p.id, 100000)));
    // fail closed: if Transmission cannot be asked, this throws and nothing is a candidate
    const torrents = await downloads.transmission.getTorrents(['downloadDir', 'name', 'files']);
    const torrentPaths = new Set();
    for (const t of torrents) {
        const base = t.downloadDir || '';
        torrentPaths.add(path.join(base, t.name || ''));
        for (const tf of t.files || []) torrentPaths.add(path.join(base, tf.name));
    }
    const out = selectCandidates({ files: rows, watched, torrentPaths, monitored: new Set(Object.keys((sentinel && sentinel.monitored) || {})), minAgeDays, watchedMode, now });
    fs.mkdirSync(outDir, { recursive: true });
    for (const [type, name] of [['movie', 'Movies'], ['series', 'TV']]) {
        const body = out.candidates.filter((c) => c.type === type).map((c) => c.rel).join('\n');
        fs.writeFileSync(path.join(outDir, name + '.txt'), body ? body + '\n' : '');
    }
    return { count: out.candidates.length, skipped: out.skipped, planDir: outDir };
}

function register(ctx) {
    const movie = ctx.config.list('LIBRARY_EXTRA_MOVIES_DIRS');
    const series = ctx.config.list('LIBRARY_EXTRA_TV_DIRS');
    if (!movie.length && !series.length) return ctx.disable('LIBRARY_EXTRA_MOVIES_DIRS / LIBRARY_EXTRA_TV_DIRS are not set');
    ctx.hooks.provide('library.roots', () => ({ movie, series }));

    const { library, downloads, sentinel } = ctx.services;
    ctx.app.get('/api/gdrive/status', ctx.auth.requireAdmin, (_req, res) => {
        res.json({ roots: library.coldRootList().map((r) => ({ path: r, online: library.coldRootOnline(r) })) });
    });
    // Tiering plan: which local files may move to the drive (written for scripts/move-to-drive.sh; nothing is moved here).
    ctx.app.post(['/api/gdrive/tiering/plan', '/api/library/tiering/plan'], ctx.auth.requireAdmin, async (req, res) => {
        try {
            const r = await buildTieringPlan({
                raw: ctx.db.raw, library, downloads, sentinel, outDir: path.join(ctx.dataDir(), 'tiering'),
                minAgeDays: ctx.config.int('TIERING_MIN_AGE_DAYS', 14), watchedMode: ctx.config.get('TIERING_WATCHED') === 'all' ? 'all' : 'any',
            });
            ctx.db.audit(req.login.email, null, 'gdrive.tiering_plan', { count: r.count });
            res.json(r);
        } catch (e) {
            res.status(503).json({ error: 'plan_failed', detail: e.message });
        }
    });
    ctx.log.info(`cold roots: ${[...movie, ...series].join(', ')}`);
    return { buildTieringPlan };
}

module.exports = { register, buildTieringPlan };
