'use strict';
// Smart browse on TMDB's discover API: real queries (rating, votes, genre, language, runtime, year and
// "streaming on Netflix in <region>") that Stremio addon catalogs cannot do. The key stays on the server.
// TMDB ids are mapped to IMDb ids (what Stremio and Cinemeta use) once per title and kept in SQLite.

// api.tmdb.org is TMDB's documented alternate domain for the same API. Some ISPs (India) reset TLS to api.themoviedb.org.
const DEFAULT_API = 'https://api.tmdb.org/3';
const POSTER = 'https://image.tmdb.org/t/p/w342';
const LOGO = 'https://image.tmdb.org/t/p/w92';
const DAY = 24 * 3600 * 1000;
const MAX_PAGE = 500; // TMDB serves at most 500 pages

const LANGUAGES = [
    ['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['ml', 'Malayalam'], ['ja', 'Japanese'],
    ['ko', 'Korean'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['zh', 'Chinese'],
].map(([code, name]) => ({ code, name }));

// v4 read tokens are JWTs (sent as a Bearer header); v3 keys go in the query string.
// Errors never contain the URL, so the key cannot leak into logs or responses.
function httpFetchJson(apiKey, apiBase = DEFAULT_API) {
    if (!/^https:\/\//.test(apiBase)) throw new Error('TMDB_API_BASE must be an https:// URL');
    const bearer = /^eyJ/.test(apiKey);
    return async (pathname, query = {}) => {
        const url = new URL(apiBase.replace(/\/+$/, '') + pathname);
        for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        if (!bearer) url.searchParams.set('api_key', apiKey);
        // one retry for a network hiccup (a reset or a slow connect), never for an answer from TMDB
        let res;
        for (let attempt = 1; !res; attempt++) {
            try {
                res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(15000) });
            } catch (_) {
                if (attempt >= 2) throw Object.assign(new Error('tmdb_unreachable'), { status: 502 });
                await new Promise((r) => setTimeout(r, 300));
            }
        }
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error('tmdb_auth_failed'), { status: 502 });
        if (!res.ok) throw Object.assign(new Error(`tmdb_http_${res.status}`), { status: 502, tmdbStatus: res.status });
        return res.json();
    };
}

// Kids profiles: titles must carry a child-friendly genre and none of the genres that rarely suit children.
// (Movies are additionally limited to a US rating of PG or lower in discover queries.) Best effort, never a guarantee.
const KID_OK = { movie: [16, 10751], series: [16, 10751, 10762] };       // Animation, Family, Kids
const KID_BLOCK = [27, 53, 80, 10752, 10768];                              // Horror, Thriller, Crime, War, War & Politics
const kidSafe = (type, genreIds) => {
    const ids = Array.isArray(genreIds) ? genreIds : [];
    return ids.some((id) => KID_OK[type === 'series' ? 'series' : 'movie'].includes(id)) && !ids.some((id) => KID_BLOCK.includes(id));
};

const sortBy = (kind, sort) => ({
    rating: 'vote_average.desc',
    popularity: 'popularity.desc',
    votes: 'vote_count.desc',
    newest: kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
}[sort] || 'vote_average.desc');

function buildQuery(kind, f, genreIds) {
    const q = { language: 'en-US', include_adult: 'false', page: f.page || 1, sort_by: sortBy(kind, f.sort) };
    if (f.minRating) q['vote_average.gte'] = f.minRating;
    if (f.minVotes) q['vote_count.gte'] = f.minVotes;
    if (genreIds.length) q.with_genres = genreIds.join(','); // comma = all of them
    if (f.providers && f.providers.length) {
        q.with_watch_providers = f.providers.join('|'); // pipe = any of them
        q.watch_region = f.region;
        q.with_watch_monetization_types = 'flatrate|free|ads'; // included with the subscription or free, not rent/buy
    }
    if (f.lang) q.with_original_language = f.lang;
    if (f.kids && kind === 'movie') { q.certification_country = 'US'; q['certification.lte'] = 'PG'; }
    if (f.minRuntime) q['with_runtime.gte'] = f.minRuntime;
    if (f.maxRuntime) q['with_runtime.lte'] = f.maxRuntime;
    const dateKey = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (f.yearFrom) q[`${dateKey}.gte`] = `${f.yearFrom}-01-01`;
    if (f.yearTo) q[`${dateKey}.lte`] = `${f.yearTo}-12-31`;
    return q;
}

function createTmdb({ apiKey, apiBase, raw, fetchJson, region = 'IN', now = () => Date.now(), concurrency = 8 }) {
    const key = String(apiKey || '').trim();
    const get = fetchJson || (key ? httpFetchJson(key, apiBase || DEFAULT_API) : null);
    const configured = () => !!get;

    const memoStore = new Map();
    const memo = async (k, ttl, fn) => {
        const hit = memoStore.get(k);
        if (hit && now() - hit.t < ttl) return hit.v;
        const v = await fn();
        memoStore.set(k, { t: now(), v });
        if (memoStore.size > 300) memoStore.delete(memoStore.keys().next().value);
        return v;
    };

    const selId = raw.prepare('SELECT imdb_id, checked_at FROM tmdb_ids WHERE kind = ? AND tmdb_id = ?');
    const putId = raw.prepare(`INSERT INTO tmdb_ids (kind, tmdb_id, imdb_id, checked_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(kind, tmdb_id) DO UPDATE SET imdb_id = excluded.imdb_id, checked_at = excluded.checked_at`);

    function options(rg = region) {
        return memo(`opts:${rg}`, DAY, async () => {
            const [gm, gt, pm] = await Promise.all([
                get('/genre/movie/list', { language: 'en-US' }),
                get('/genre/tv/list', { language: 'en-US' }),
                get('/watch/providers/movie', { watch_region: rg, language: 'en-US' }),
            ]);
            const rank = (p) => (p.display_priorities && p.display_priorities[rg] != null ? p.display_priorities[rg] : (p.display_priority ?? 999));
            const providers = [...(pm.results || [])].sort((a, b) => rank(a) - rank(b)).slice(0, 24)
                .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ? LOGO + p.logo_path : null }));
            return { region: rg, genres: { movie: gm.genres || [], series: gt.genres || [] }, providers, languages: LANGUAGES };
        });
    }

    // tmdb id -> imdb id (null = TMDB has none). Known ids come from SQLite; titles without one are re-checked after 30 days.
    async function externalIds(kind, ids) {
        const out = new Map();
        const missing = [];
        for (const id of ids) {
            const row = selId.get(kind, id);
            if (row && (row.imdb_id || now() - Date.parse(row.checked_at) < 30 * DAY)) out.set(id, row.imdb_id);
            else missing.push(id);
        }
        let next = 0;
        let authFailure = null;
        await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
            while (next < missing.length && !authFailure) {
                const id = missing[next++];
                try {
                    const j = await get(`/${kind}/${id}/external_ids`);
                    const imdb = /^tt\d+$/.test((j && j.imdb_id) || '') ? j.imdb_id : null;
                    putId.run(kind, id, imdb, new Date(now()).toISOString());
                    out.set(id, imdb);
                } catch (e) {
                    if (e.message === 'tmdb_auth_failed') authFailure = e;
                    else if (e.tmdbStatus === 404) { putId.run(kind, id, null, new Date(now()).toISOString()); out.set(id, null); }
                    // anything else is transient: the title is skipped this time and retried on the next request
                }
            }
        }));
        if (authFailure) throw authFailure;
        return out;
    }

    // TMDB rows -> our items, only those that have an IMDb id (Stremio opens titles by it); kids profiles get the safe subset
    async function shapeResults(kind, results, kids) {
        const type = kind === 'tv' ? 'series' : 'movie';
        const list = kids ? results.filter((r) => kidSafe(type, r.genre_ids)) : results;
        const imdb = await externalIds(kind, list.map((r) => r.id));
        const items = [];
        let hidden = 0;
        for (const r of list) {
            const id = imdb.get(r.id);
            if (!id) { hidden++; continue; }
            items.push({
                id, tmdbId: r.id, type,
                name: r.title || r.name || '',
                year: Number(String(r.release_date || r.first_air_date || '').slice(0, 4)) || null,
                poster: r.poster_path ? POSTER + r.poster_path : null,
                rating: Math.round((Number(r.vote_average) || 0) * 10) / 10,
                votes: Number(r.vote_count) || 0,
                overview: String(r.overview || '').slice(0, 400),
                language: r.original_language || null,
                genreIds: Array.isArray(r.genre_ids) ? r.genre_ids.filter(Number.isInteger).slice(0, 6) : [],
            });
        }
        return { items, hidden };
    }

    async function discover(f) {
        if (!configured()) throw Object.assign(new Error('tmdb_not_configured'), { status: 503 });
        const type = f.type === 'series' ? 'series' : 'movie';
        const kind = type === 'series' ? 'tv' : 'movie';
        const opts = await options(f.region || region);
        const known = opts.genres[type];
        const genreIds = [];
        for (const name of f.genres || []) {
            const g = known.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
            // an unknown genre must never silently widen the search
            if (!g) throw Object.assign(new Error(`unknown_genre:${name}`), { status: 400 });
            genreIds.push(g.id);
        }
        const query = buildQuery(kind, { ...f, region: f.region || region }, genreIds);
        const data = await memo(`d:${kind}:${JSON.stringify(query)}`, 10 * 60 * 1000, () => get(`/discover/${kind}`, query));
        const { items, hidden } = await shapeResults(kind, (data && data.results) || [], !!f.kids);
        return { page: (data && data.page) || 1, totalPages: Math.min((data && data.total_pages) || 1, MAX_PAGE), total: (data && data.total_results) || 0, items, hidden };
    }

    /** Title search by name (movies, series or both). Returns the same items as discover. */
    async function search(query, { type, kids = false } = {}) {
        if (!configured()) throw Object.assign(new Error('tmdb_not_configured'), { status: 503 });
        const q = String(query || '').trim().slice(0, 100);
        if (q.length < 2) return { items: [], hidden: 0 };
        const kinds = type === 'movie' ? ['movie'] : type === 'series' ? ['tv'] : ['movie', 'tv'];
        const parts = await Promise.all(kinds.map(async (kind) => {
            const data = await memo(`s:${kind}:${q.toLowerCase()}`, 10 * 60 * 1000, () => get(`/search/${kind}`, { query: q, language: 'en-US', include_adult: 'false', page: 1 }));
            return shapeResults(kind, ((data && data.results) || []).slice(0, 8), kids);
        }));
        const items = parts.flatMap((p) => p.items).sort((a, b) => b.votes - a.votes);
        return { items, hidden: parts.reduce((n, p) => n + p.hidden, 0) };
    }

    /** IMDb id -> TMDB kind and id (null when TMDB does not know it). */
    async function byImdb(imdbId, type) {
        if (!configured()) throw Object.assign(new Error('tmdb_not_configured'), { status: 503 });
        if (!/^tt\d+$/.test(String(imdbId))) throw Object.assign(new Error('invalid_imdb_id'), { status: 400 });
        const j = await memo(`f:${imdbId}`, DAY, () => get(`/find/${imdbId}`, { external_source: 'imdb_id', language: 'en-US' }));
        const movie = ((j && j.movie_results) || [])[0];
        const tv = ((j && j.tv_results) || [])[0];
        const pick = type === 'series' ? (tv || movie) : type === 'movie' ? (movie || tv) : (movie || tv);
        if (!pick) return null;
        const kind = pick === tv ? 'tv' : 'movie';
        putId.run(kind, pick.id, imdbId, new Date(now()).toISOString());
        return { kind, tmdbId: pick.id, type: kind === 'tv' ? 'series' : 'movie' };
    }

    /** Facts about one title: runtime, genres, rating, seasons, next episode and where it streams in the region. */
    async function details(kind, tmdbId, rg = region) {
        if (!configured()) throw Object.assign(new Error('tmdb_not_configured'), { status: 503 });
        const j = await memo(`det:${kind}:${tmdbId}`, 60 * 60 * 1000, () => get(`/${kind}/${tmdbId}`, { language: 'en-US', append_to_response: 'watch/providers' }));
        const prov = (((j && j['watch/providers']) || {}).results || {})[rg] || {};
        const names = (list) => (Array.isArray(list) ? list : []).map((p) => p.provider_name).filter(Boolean).slice(0, 8);
        const type = kind === 'tv' ? 'series' : 'movie';
        const next = j && j.next_episode_to_air;
        return {
            tmdbId, type,
            name: (j && (j.title || j.name)) || '',
            tagline: (j && j.tagline) || '',
            overview: String((j && j.overview) || '').slice(0, 600),
            year: Number(String((j && (j.release_date || j.first_air_date)) || '').slice(0, 4)) || null,
            rating: Math.round((Number(j && j.vote_average) || 0) * 10) / 10,
            votes: Number(j && j.vote_count) || 0,
            genres: ((j && j.genres) || []).map((g) => g.name),
            genreIds: ((j && j.genres) || []).map((g) => g.id),
            runtimeMin: (j && (j.runtime || (j.episode_run_time || [])[0])) || null,
            language: (j && j.original_language) || null,
            status: (j && j.status) || null,
            seasons: j && j.number_of_seasons != null ? j.number_of_seasons : null,
            episodes: j && j.number_of_episodes != null ? j.number_of_episodes : null,
            nextEpisode: next ? { season: next.season_number, episode: next.episode_number, airDate: next.air_date } : null,
            poster: j && j.poster_path ? POSTER + j.poster_path : null,
            region: rg,
            streamingIn: names(prov.flatrate),
            freeIn: names([...(prov.free || []), ...(prov.ads || [])]),
            rentOrBuyIn: names([...(prov.rent || []), ...(prov.buy || [])]),
        };
    }

    return { configured, options, discover, search, byImdb, details, externalIds, region };
}

module.exports = { createTmdb, httpFetchJson, buildQuery, kidSafe, MAX_PAGE, LANGUAGES, DEFAULT_API };
