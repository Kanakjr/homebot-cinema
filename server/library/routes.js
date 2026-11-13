'use strict';
// Server library API. All routes sit behind the Cloudflare login gate; mutations are admin-only.

function registerLibraryRoutes(app, { library, requireAdmin, db, onFileDeleted = async () => {}, onEpisodeRemoved = () => {} }) {
    const fail = (res, e) => {
        const status = e.status || 500;
        if (status >= 500) console.error('[Library API]', e);
        res.status(status).json({ error: e.message || 'error' });
    };
    const num = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

    app.get('/api/library', (req, res) => {
        res.json(library.list({
            type: req.query.type, q: req.query.q, sort: req.query.sort, limit: Number.parseInt(req.query.limit, 10) || undefined,
            unmatched: req.query.unmatched === '1' || req.query.unmatched === 'true',
        }));
    });

    app.get('/api/library/scan/status', (_req, res) => res.json(library.status));
    app.get('/api/library/episodes', (_req, res) => res.json({ episodes: library.episodeIds() }));
    app.post('/api/library/scan', requireAdmin, (req, res) => {
        db.audit(req.login.email, null, 'library.scan', null);
        library.scan(); // background; poll /scan/status
        res.status(202).json({ ...library.status, running: true });
    });

    app.get('/api/library/by-imdb/:imdbId', (req, res) => {
        const item = library.getByImdb(req.params.imdbId);
        if (item) return res.json(item);
        return req.query.soft ? res.json(null) : res.status(404).json({ error: 'not_found' });
    });

    app.get('/api/library/:id(\\d+)', (req, res) => {
        const item = library.get(num(req.params.id));
        return item ? res.json(item) : res.status(404).json({ error: 'not_found' });
    });

    app.post('/api/library/:id(\\d+)/identify', requireAdmin, async (req, res) => {
        try {
            const item = await library.identify(num(req.params.id), String((req.body && req.body.imdbId) || '').trim());
            if (!item) return res.status(404).json({ error: 'not_found' });
            db.audit(req.login.email, null, 'library.identify', { id: item.id, imdbId: item.imdbId });
            res.json(item);
        } catch (e) { fail(res, e); }
    });

    // `removed`: what library.deleteFile / deleteItem returned ({ path, type, imdbId, season, episode })
    async function afterDelete(req, removed, what) {
        const paths = removed.map((d) => d.path);
        db.audit(req.login.email, null, what, { count: paths.length, paths: paths.slice(0, 20) });
        for (const d of removed) {
            try {
                await onFileDeleted(d.path);
                onEpisodeRemoved(d);
            } catch (e) {
                console.warn('[Library API] cleanup after delete failed:', e.message);
            }
        }
    }

    app.delete('/api/library/files/:id(\\d+)', requireAdmin, async (req, res) => {
        try {
            const done = library.deleteFile(num(req.params.id));
            if (!done) return res.status(404).json({ error: 'not_found' });
            await afterDelete(req, [done], 'library.delete_file');
            res.json({ success: true });
        } catch (e) { fail(res, e); }
    });

    app.delete('/api/library/:id(\\d+)/season/:season(\\d+)', requireAdmin, async (req, res) => {
        try {
            const paths = library.deleteItem(num(req.params.id), num(req.params.season));
            await afterDelete(req, paths, 'library.delete_season');
            res.json({ success: true, deleted: paths.length });
        } catch (e) { fail(res, e); }
    });

    app.delete('/api/library/:id(\\d+)', requireAdmin, async (req, res) => {
        try {
            if (!library.get(num(req.params.id))) return res.status(404).json({ error: 'not_found' });
            const paths = library.deleteItem(num(req.params.id));
            await afterDelete(req, paths, 'library.delete_item');
            res.json({ success: true, deleted: paths.length });
        } catch (e) { fail(res, e); }
    });
}

module.exports = { registerLibraryRoutes };
