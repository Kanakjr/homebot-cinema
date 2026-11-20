'use strict';
// Plugin "mdblist": aggregated ratings (Rotten Tomatoes, Popcornmeter, Metacritic, IMDb, Letterboxd) via MDBList.

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseRatings(item) {
    if (!item || !Array.isArray(item.ratings)) return null;
    const find = (src) => item.ratings.find((r) => r.source === src);
    const rt = find('tomatoes');
    const pop = find('popcorn');
    const imdb = find('imdb');
    const meta = find('metacritic');
    const lb = find('letterboxd');

    return {
        id: item.ids?.imdb || (typeof item.imdbid === 'string' ? item.imdbid : null),
        type: item.type === 'show' ? 'series' : (item.type || 'movie'),
        score: Number.isFinite(item.score) ? item.score : null,
        tomatoes: rt && Number.isFinite(rt.value) ? {
            score: rt.value,
            fresh: rt.fresh === 1 || rt.fresh === true || rt.value >= 60,
            votes: rt.votes || null,
        } : null,
        popcorn: pop && Number.isFinite(pop.value) ? {
            score: pop.value,
            fresh: pop.value >= 60,
            votes: pop.votes || null,
        } : null,
        imdb: imdb && Number.isFinite(imdb.value) ? {
            score: imdb.value,
            votes: imdb.votes || null,
        } : null,
        metacritic: meta && Number.isFinite(meta.value) ? {
            score: meta.value,
            votes: meta.votes || null,
        } : null,
        letterboxd: lb && Number.isFinite(lb.value) ? {
            score: lb.value,
            votes: lb.votes || null,
        } : null,
    };
}

function register(ctx) {
    const apiKey = ctx.config.get('MDBLIST_API_KEY');
    if (!apiKey) return ctx.disable('MDBLIST_API_KEY is not set');

    ctx.db.migrate([
        `CREATE TABLE IF NOT EXISTS mdblist_ratings (
            imdb_id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            score INTEGER,
            tomatoes INTEGER,
            tomatoes_fresh INTEGER,
            popcorn INTEGER,
            imdb REAL,
            metacritic INTEGER,
            letterboxd REAL,
            updated_at INTEGER NOT NULL
        );`,
    ]);

    function getCached(imdbId) {
        try {
            const row = ctx.db.raw.prepare('SELECT * FROM mdblist_ratings WHERE imdb_id = ?').get(imdbId);
            if (!row) return null;
            if (Date.now() - row.updated_at > CACHE_TTL_MS) return null;
            return {
                id: row.imdb_id,
                type: row.type,
                score: row.score,
                tomatoes: row.tomatoes !== null ? { score: row.tomatoes, fresh: row.tomatoes_fresh === 1 } : null,
                popcorn: row.popcorn !== null ? { score: row.popcorn, fresh: row.popcorn >= 60 } : null,
                imdb: row.imdb !== null ? { score: row.imdb } : null,
                metacritic: row.metacritic !== null ? { score: row.metacritic } : null,
                letterboxd: row.letterboxd !== null ? { score: row.letterboxd } : null,
            };
        } catch (_) {
            return null;
        }
    }

    function saveCached(parsed) {
        if (!parsed || !parsed.id) return;
        try {
            ctx.db.raw.prepare(`
                INSERT OR REPLACE INTO mdblist_ratings
                (imdb_id, type, score, tomatoes, tomatoes_fresh, popcorn, imdb, metacritic, letterboxd, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                parsed.id,
                parsed.type || 'movie',
                parsed.score,
                parsed.tomatoes ? parsed.tomatoes.score : null,
                parsed.tomatoes ? (parsed.tomatoes.fresh ? 1 : 0) : null,
                parsed.popcorn ? parsed.popcorn.score : null,
                parsed.imdb ? parsed.imdb.score : null,
                parsed.metacritic ? parsed.metacritic.score : null,
                parsed.letterboxd ? parsed.letterboxd.score : null,
                Date.now()
            );
        } catch (e) {
            ctx.log.warn(`failed to cache ratings for ${parsed.id}: ${e.message}`);
        }
    }

    async function fetchSingle(type, imdbId) {
        const mdblistType = type === 'series' ? 'show' : 'movie';
        const url = `https://api.mdblist.com/imdb/${mdblistType}/${encodeURIComponent(imdbId)}/?apikey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`mdblist_error_${res.status}`);
        const data = await res.json();
        return parseRatings(data);
    }

    async function fetchBatch(imdbIds) {
        if (!imdbIds.length) return [];
        const url = `https://api.mdblist.com/imdb/any/?apikey=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ ids: imdbIds }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`mdblist_batch_error_${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list)) return [];
        return list.map(parseRatings).filter(Boolean);
    }

    ctx.app.get('/api/mdblist/:type/:imdbId', async (req, res) => {
        const type = String(req.params.type || '');
        const id = String(req.params.imdbId || '');
        if (type !== 'movie' && type !== 'series') return res.status(400).json({ error: 'bad_type' });
        if (!/^tt\d{1,10}$/.test(id)) return res.status(400).json({ error: 'bad_imdb_id' });

        const cached = getCached(id);
        if (cached) return res.json({ rating: cached });

        try {
            const fresh = await fetchSingle(type, id);
            if (fresh) {
                saveCached(fresh);
                return res.json({ rating: fresh });
            }
            saveCached({ id, type, score: null });
            res.json({ rating: null });
        } catch (e) {
            ctx.log.warn(`mdblist lookup failed for ${id}: ${e.message}`);
            res.status(502).json({ error: 'mdblist_unavailable' });
        }
    });

    ctx.app.post('/api/mdblist/batch', async (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string' && /^tt\d{1,10}$/.test(x)) : [];
        if (!ids.length) return res.json({ ratings: {} });

        const out = {};
        const missing = [];

        for (const id of ids.slice(0, 50)) {
            const c = getCached(id);
            if (c) {
                out[id] = c;
            } else {
                missing.push(id);
            }
        }

        if (missing.length > 0) {
            try {
                const freshList = await fetchBatch(missing);
                const found = new Set();
                for (const item of freshList) {
                    if (item && item.id) {
                        saveCached(item);
                        out[item.id] = item;
                        found.add(item.id);
                    }
                }
                for (const id of missing) {
                    if (!found.has(id)) {
                        saveCached({ id, type: 'movie', score: null });
                    }
                }
            } catch (e) {
                ctx.log.warn(`mdblist batch lookup failed: ${e.message}`);
            }
        }

        res.json({ ratings: out });
    });

    return {
        parseRatings,
        getCached,
        fetchSingle,
        fetchBatch,
    };
}

module.exports = { register, parseRatings };
