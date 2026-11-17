'use strict';
// Plugin "similar": GET /api/similar/:type/:imdbId -> { items: [{ id (IMDb), type, name, year, poster, rating }] }.
// The TMDB client is the core service (ctx.services.tmdb); this plugin only adds the route.

function register(ctx) {
    const tmdb = ctx.services.tmdb;
    if (!tmdb || typeof tmdb.configured !== 'function' || !tmdb.configured()) return ctx.disable('TMDB_API_KEY is not set');

    ctx.app.get('/api/similar/:type/:imdbId', async (req, res) => {
        const type = String(req.params.type || '');
        const id = String(req.params.imdbId || '');
        if (type !== 'movie' && type !== 'series') return res.status(400).json({ error: 'bad_type' });
        if (!/^tt\d{1,10}$/.test(id)) return res.status(400).json({ error: 'bad_imdb_id' });
        try {
            res.json(await tmdb.similarFor(id, type));
        } catch (e) {
            if (e.message === 'tmdb_auth_failed' || e.status === 503) return res.status(503).json({ error: e.message });
            ctx.log.warn(`similar lookup failed for ${id}: ${e.message}`);
            res.status(502).json({ error: 'tmdb_unavailable' });
        }
    });
    return {};
}

module.exports = { register };
