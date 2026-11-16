'use strict';
// Plugin "collections": GET /api/collections/movie/:imdbId -> { collection: { id, name, items } | null }.
// The TMDB client is the core service (ctx.services.tmdb, cached in memory and SQLite); this plugin only adds the route.

function register(ctx) {
    const tmdb = ctx.services.tmdb;
    if (!tmdb || typeof tmdb.configured !== 'function' || !tmdb.configured()) return ctx.disable('TMDB_API_KEY is not set');

    ctx.app.get('/api/collections/movie/:imdbId', async (req, res) => {
        const id = String(req.params.imdbId || '');
        if (!/^tt\d{1,10}$/.test(id)) return res.status(400).json({ error: 'bad_imdb_id' });
        try {
            res.json({ collection: await tmdb.collectionFor(id) });
        } catch (e) {
            if (e.message === 'tmdb_auth_failed' || e.status === 503) return res.status(503).json({ error: e.message });
            ctx.log.warn(`collection lookup failed for ${id}: ${e.message}`);
            res.status(502).json({ error: 'tmdb_unavailable' });
        }
    });
    return {};
}

module.exports = { register };
