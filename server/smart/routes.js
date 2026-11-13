'use strict';
// GET /api/find/options and GET /api/find: smart browse filters. Behind the Cloudflare login like the rest of /api.

const { MAX_PAGE } = require('./tmdb');

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const SORTS = ['rating', 'popularity', 'votes', 'newest'];

function parseFilters(q, defaultRegion = 'IN') {
    const one = (v) => (Array.isArray(v) ? v[0] : v);
    const num = (name, min, max, { int = false } = {}) => {
        const raw = one(q[name]);
        if (raw === undefined || raw === '') return undefined;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw bad(`invalid_${name}`);
        return n;
    };
    const list = (name, max, each) => {
        const raw = one(q[name]);
        if (raw === undefined || raw === '') return [];
        const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length > max || !parts.every(each)) throw bad(`invalid_${name}`);
        return parts;
    };
    const type = one(q.type) === undefined ? 'movie' : one(q.type);
    if (type !== 'movie' && type !== 'series') throw bad('invalid_type');
    const sort = one(q.sort) === undefined ? 'rating' : one(q.sort);
    if (!SORTS.includes(sort)) throw bad('invalid_sort');
    const lang = one(q.lang);
    if (lang !== undefined && lang !== '' && !/^[a-z]{2,3}$/.test(lang)) throw bad('invalid_lang');
    const region = one(q.region) === undefined ? defaultRegion : one(q.region);
    if (!/^[A-Z]{2}$/.test(region)) throw bad('invalid_region');
    const f = {
        type, sort, region,
        lang: lang || undefined,
        genres: list('genre', 6, (s) => s.length <= 40 && /^[\w &'-]+$/.test(s)),
        providers: list('provider', 8, (s) => /^\d{1,6}$/.test(s)).map(Number),
        minRating: num('minRating', 0, 10),
        minVotes: num('minVotes', 0, 1000000, { int: true }),
        yearFrom: num('yearFrom', 1900, 2100, { int: true }),
        yearTo: num('yearTo', 1900, 2100, { int: true }),
        minRuntime: num('minRuntime', 1, 1000, { int: true }),
        maxRuntime: num('maxRuntime', 1, 1000, { int: true }),
        page: num('page', 1, MAX_PAGE, { int: true }) || 1,
    };
    if (f.yearFrom && f.yearTo && f.yearFrom > f.yearTo) throw bad('invalid_year_range');
    return f;
}

function registerFindRoutes(app, { tmdb, library }) {
    const fail = (res, e) => {
        const status = e.status || 500;
        if (status === 500) console.error('[Find]', e.message);
        res.status(status).json({ error: e.message || 'error' });
    };

    app.get('/api/find/options', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!tmdb.configured()) return res.json({ configured: false });
        try {
            const region = req.query.region === undefined ? tmdb.region : String(req.query.region);
            if (!/^[A-Z]{2}$/.test(region)) throw bad('invalid_region');
            res.json({ configured: true, ...(await tmdb.options(region)) });
        } catch (e) { fail(res, e); }
    });

    app.get('/api/find', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const f = parseFilters(req.query, tmdb.region);
            const r = await tmdb.discover(f);
            const on = library.imdbIdsOnServer();
            res.json({ ...r, items: r.items.map((i) => ({ ...i, onServer: on.has(i.id) })) });
        } catch (e) { fail(res, e); }
    });
}

module.exports = { registerFindRoutes, parseFilters };
