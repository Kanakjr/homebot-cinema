'use strict';
// Function-calling tools for the copilot. Read-only tools look things up (TMDB, the server library, downloads, the
// profile's watch history). The two stage_* tools only PREPARE an action; the user confirms it in the UI (staging.js).

const { kidSafe } = require('../smart/tmdb');
const { chooseRelease } = require('../grabber/grab');
const { cleanStream } = require('../grabber/routes');
const { normalizeScope, scopeLabel } = require('../sentinel_state');

const ID_RE = /^tt\d+$/;
const SORTS = ['rating', 'popularity', 'votes', 'newest'];
const MAX_STREAMS = 400;
const pad = (n) => String(n).padStart(2, '0');
const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const clampInt = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : undefined);

const obj = (properties, required = []) => ({ type: 'OBJECT', properties, required });
const DECLARATIONS = [
    {
        name: 'find_titles',
        description: 'Discover movies or series by rating, genre, streaming service, language, runtime and year (TMDB). Use for recommendations and "something like..." requests.',
        parameters: obj({
            type: { type: 'STRING', enum: ['movie', 'series'] },
            genres: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Genre names such as Comedy, Documentary, Science Fiction (series: Sci-Fi & Fantasy, Action & Adventure). A title must match all of them.' },
            services: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Streaming services such as Netflix, Amazon Prime Video, JioHotstar, Apple TV. Matches any of them.' },
            min_rating: { type: 'NUMBER', description: 'TMDB rating 0-10, e.g. 7.5' },
            min_votes: { type: 'INTEGER', description: 'Minimum number of votes; defaults to 200 to avoid obscure junk' },
            year_from: { type: 'INTEGER' }, year_to: { type: 'INTEGER' },
            language: { type: 'STRING', description: 'Original language code: en, hi, ta, te, ml, ja, ko, es, fr, de, it, zh' },
            max_runtime_min: { type: 'INTEGER' }, min_runtime_min: { type: 'INTEGER' },
            sort: { type: 'STRING', enum: SORTS },
        }, ['type']),
    },
    {
        name: 'search_titles',
        description: 'Search movies and series by name.',
        parameters: obj({ query: { type: 'STRING' }, type: { type: 'STRING', enum: ['movie', 'series'] } }, ['query']),
    },
    {
        name: 'get_title',
        description: 'Facts about one title by IMDb id: overview, runtime, genres, rating, seasons, next episode, where it streams, and whether it is on the server, downloading or monitored.',
        parameters: obj({ imdb_id: { type: 'STRING', description: 'e.g. tt0111161' }, type: { type: 'STRING', enum: ['movie', 'series'] } }, ['imdb_id']),
    },
    {
        name: 'get_server_library',
        description: 'Titles that are on the home server (downloaded), newest first. Optionally filter by name or type.',
        parameters: obj({ query: { type: 'STRING' }, type: { type: 'STRING', enum: ['movie', 'series'] } }),
    },
    {
        name: 'get_downloads',
        description: 'Active and recent downloads and the free disk space.',
        parameters: obj({}),
    },
    {
        name: 'get_watch_history',
        description: 'What this profile watched recently (titles, when, how far). Use for "what did I leave unfinished" or "something similar to what I watched".',
        parameters: obj({ limit: { type: 'INTEGER', description: 'default 20, max 40' } }),
    },
    {
        name: 'present_titles',
        description: 'Show title cards (poster, rating, open / play buttons) to the user. Call this whenever you recommend or mention specific titles. Only IMDb ids returned by your tools this turn or listed in the brief are accepted.',
        parameters: obj({ imdb_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: 'up to 8 IMDb ids' } }, ['imdb_ids']),
    },
    {
        name: 'stage_download',
        description: 'Prepare a download of one movie or one episode for the user to confirm. Does NOT download anything. Picks the best live release for a quality profile.',
        parameters: obj({
            imdb_id: { type: 'STRING' }, type: { type: 'STRING', enum: ['movie', 'series'] },
            season: { type: 'INTEGER' }, episode: { type: 'INTEGER' },
            quality_profile: { type: 'STRING', description: 'Name of a quality profile from the brief; omit for the default' },
        }, ['imdb_id', 'type']),
    },
    {
        name: 'stage_monitor',
        description: 'Prepare automatic downloading of new episodes of a series (admin only) for the user to confirm. Does NOT start anything.',
        parameters: obj({
            imdb_id: { type: 'STRING' },
            scope: { type: 'STRING', enum: ['new', 'seasons', 'all'], description: 'new = only episodes airing from now on; seasons = the listed seasons; all = everything that has aired' },
            seasons: { type: 'ARRAY', items: { type: 'INTEGER' } },
            quality_profile: { type: 'STRING' },
        }, ['imdb_id', 'scope']),
    },
];

function createTools({ tmdb, library, downloadsManager, sentinel, qualityStore, staging, probeMany, fetchStreams, fetchMeta, history, region = 'IN' }) {
    const notKids = (ctx) => (ctx.kids ? { error: 'not_available_for_kids_profile' } : null);

    // remember a title so present_titles can show it (and so ids the model invents are refused)
    const remember = (ctx, card) => {
        if (!card || !ID_RE.test(card.id)) return;
        ctx.catalog.set(card.id, { ...(ctx.catalog.get(card.id) || {}), ...card });
        ctx.known.add(card.id);
    };
    const asCard = (it, onServer) => ({ id: it.id, type: it.type, title: it.name, year: it.year, poster: it.poster, rating: it.rating, overview: short(it.overview, 220), onServer: onServer.has(it.id) });
    const compact = (it, onServer) => ({ imdb_id: it.id, type: it.type, title: it.name, year: it.year, rating: it.rating, votes: it.votes, language: it.language, on_server: onServer.has(it.id), overview: short(it.overview, 140) });

    async function serviceIds(names) {
        if (!Array.isArray(names) || !names.length) return { ids: [] };
        const opts = await tmdb.options(region);
        const ids = [];
        for (const n of names.slice(0, 4)) {
            const want = String(n).toLowerCase().replace(/\s+/g, '');
            const p = opts.providers.find((x) => x.name.toLowerCase().replace(/\s+/g, '') === want)
                || opts.providers.find((x) => x.name.toLowerCase().replace(/\s+/g, '').includes(want) || want.includes(x.name.toLowerCase().replace(/\s+/g, '')));
            if (!p) return { error: 'service_not_available', service: String(n), available_services: opts.providers.map((x) => x.name) };
            ids.push(p.id);
        }
        return { ids };
    }

    async function findTitles(a, ctx) {
        const type = a.type === 'series' ? 'series' : 'movie';
        const svc = await serviceIds(a.services);
        if (svc.error) return svc;
        const f = {
            type, kids: ctx.kids, region, page: 1,
            genres: Array.isArray(a.genres) ? a.genres.slice(0, 4).map(String) : [],
            providers: svc.ids,
            minRating: Number.isFinite(Number(a.min_rating)) ? Math.min(10, Math.max(0, Number(a.min_rating))) : undefined,
            minVotes: clampInt(a.min_votes, 0, 1000000) ?? 200,
            yearFrom: clampInt(a.year_from, 1900, 2100), yearTo: clampInt(a.year_to, 1900, 2100),
            lang: /^[a-z]{2,3}$/.test(a.language || '') ? a.language : undefined,
            maxRuntime: clampInt(a.max_runtime_min, 1, 1000), minRuntime: clampInt(a.min_runtime_min, 1, 1000),
            sort: SORTS.includes(a.sort) ? a.sort : 'rating',
        };
        let r;
        try {
            r = await tmdb.discover(f);
        } catch (e) {
            if (/^unknown_genre/.test(e.message)) {
                const opts = await tmdb.options(region);
                return { error: e.message, valid_genres: opts.genres[type].map((g) => g.name) };
            }
            throw e;
        }
        const onServer = library.imdbIdsOnServer();
        const items = r.items.slice(0, 10);
        items.forEach((it) => remember(ctx, asCard(it, onServer)));
        return { total_matches: r.total, shown: items.length, titles: items.map((it) => compact(it, onServer)) };
    }

    async function searchTitles(a, ctx) {
        const r = await tmdb.search(String(a.query || ''), { type: a.type === 'series' ? 'series' : a.type === 'movie' ? 'movie' : undefined, kids: ctx.kids });
        const onServer = library.imdbIdsOnServer();
        const items = r.items.slice(0, 8);
        items.forEach((it) => remember(ctx, asCard(it, onServer)));
        return { shown: items.length, titles: items.map((it) => compact(it, onServer)) };
    }

    async function getTitle(a, ctx) {
        const id = String(a.imdb_id || '').trim();
        if (!ID_RE.test(id)) return { error: 'imdb_id must look like tt0111161' };
        const ref = await tmdb.byImdb(id, a.type);
        if (!ref) return { error: 'title_not_found' };
        const d = await tmdb.details(ref.kind, ref.tmdbId, region);
        if (ctx.kids && !kidSafe(d.type, d.genreIds)) return { error: 'not_available_for_kids_profile' };
        const lib = library.getByImdb(id);
        const onServer = !!(lib && lib.fileCount > 0);
        remember(ctx, { id, type: d.type, title: d.name, year: d.year, poster: d.poster, rating: d.rating, overview: short(d.overview, 220), onServer, libraryId: onServer ? lib.id : undefined });
        const out = {
            imdb_id: id, type: d.type, title: d.name, year: d.year, tagline: d.tagline, overview: d.overview, rating: d.rating, votes: d.votes,
            genres: d.genres, runtime_min: d.runtimeMin, language: d.language, status: d.status, seasons: d.seasons, episodes: d.episodes,
            next_episode: d.nextEpisode, streaming_in: d.streamingIn, free_in: d.freeIn, rent_or_buy_in: d.rentOrBuyIn, region: d.region,
            on_server: onServer,
        };
        if (onServer && lib.seasons) out.on_server_episodes = lib.seasons.map((s) => ({ season: s.season, episodes: s.episodes.length }));
        if (onServer && lib.type === 'movie') out.on_server_files = (lib.files || []).map((f) => ({ resolution: f.resolution, size_gb: Math.round((f.size || 0) / 1e7) / 100 }));
        if (d.type === 'movie') {
            try { const st = await downloadsManager.checkMedia(id); if (st && st.status) out.download = { status: st.status, progress_pct: Math.round((Number(st.progress) || 0) * 100) }; } catch (_) { /* downloader unavailable */ }
        }
        const mon = sentinel.getMonitored().find((m) => m.imdbId === id);
        if (mon) out.monitored = { scope: mon.scopeLabel };
        return out;
    }

    function getServerLibrary(a, ctx) {
        const kids = notKids(ctx); if (kids) return kids;
        const r = library.list({ q: short(a.query, 60) || undefined, type: a.type === 'series' || a.type === 'movie' ? a.type : undefined, sort: 'recent', limit: 20 });
        r.items.forEach((i) => { if (i.imdbId) remember(ctx, { id: i.imdbId, type: i.type, title: i.title, year: i.year, poster: i.poster, onServer: true, libraryId: i.id }); });
        return {
            counts: r.counts,
            titles: r.items.map((i) => ({ imdb_id: i.imdbId || null, type: i.type, title: i.title, year: i.year, episodes: i.type === 'series' ? i.episodeCount : undefined, seasons: i.type === 'series' ? i.seasons : undefined, size_gb: Math.round((i.totalSize || 0) / 1e7) / 100, added: i.lastAdded })),
        };
    }

    async function getDownloads(_a, ctx) {
        const kids = notKids(ctx); if (kids) return kids;
        const dl = await downloadsManager.listDownloads();
        const row = (d) => ({ title: short(d.title, 90), status: d.status, progress_pct: Math.round((Number(d.progress) || 0) * 100), eta_seconds: d.eta > 0 ? d.eta : undefined });
        return { active: (dl.active || []).slice(0, 10).map(row), recently_completed: (dl.completed || []).slice(0, 5).map(row), disk: dl.disk ? { free_gb: dl.disk.freeGB, total_gb: dl.disk.totalGB } : undefined };
    }

    function getWatchHistory(a, ctx) {
        const items = history(ctx.profile.id, clampInt(a.limit, 1, 40) ?? 20);
        items.forEach((h) => remember(ctx, { id: h.id, type: h.type, title: h.name, poster: h.poster }));
        const days = (ts) => Math.floor((Date.now() - ts) / 86400000);
        return { titles: items.map((h) => ({ imdb_id: h.id, type: h.type, title: h.name, days_ago: days(h.lastWatched), season: h.season ?? undefined, episode: h.episode ?? undefined, progress_pct: h.progress === null ? undefined : Math.round(h.progress * 100), finished: h.finished })) };
    }

    function presentTitles(a, ctx) {
        const ids = [...new Set((Array.isArray(a.imdb_ids) ? a.imdb_ids : []).map(String))].slice(0, 8);
        const onServer = library.imdbIdsOnServer();
        const shown = []; const refused = [];
        for (const id of ids) {
            if (!ctx.known.has(id) || !ctx.catalog.get(id)) { refused.push(id); continue; }
            const c = { ...ctx.catalog.get(id) };
            c.onServer = onServer.has(id) || !!c.onServer;
            if (c.onServer && !c.libraryId) { const lib = library.getByImdb(id); if (lib) c.libraryId = lib.id; }
            if (!ctx.titles.some((t) => t.id === id)) ctx.titles.push(c);
            shown.push(id);
        }
        return refused.length ? { shown, refused_unknown_ids: refused, note: 'Only ids from your tool results or the brief can be shown.' } : { shown };
    }

    const profileByName = (name) => {
        if (!name) return null;
        const want = String(name).toLowerCase().trim();
        return qualityStore.list().find((p) => p.name.toLowerCase() === want || (p.key || '').toLowerCase() === want || p.name.toLowerCase().includes(want)) || null;
    };

    async function titleFacts(id, type) {
        try {
            const m = await fetchMeta(type, id);
            if (m && m.name) return { name: m.name, poster: m.poster || null, year: Number(String(m.year || m.releaseInfo || '').slice(0, 4)) || null, videos: Array.isArray(m.videos) ? m.videos : [] };
        } catch (_) { /* fall back to TMDB */ }
        const ref = await tmdb.byImdb(id, type);
        if (!ref) return null;
        const d = await tmdb.details(ref.kind, ref.tmdbId, region);
        return { name: d.name, poster: d.poster, year: d.year, videos: [] };
    }

    async function stageDownload(a, ctx) {
        const kids = notKids(ctx); if (kids) return kids;
        const id = String(a.imdb_id || '').trim();
        const type = a.type === 'series' ? 'series' : a.type === 'movie' ? 'movie' : null;
        if (!ID_RE.test(id) || !type) return { error: 'imdb_id (tt…) and type (movie or series) are required' };
        let season = null; let episode = null; let videoId = id;
        if (type === 'series') {
            season = clampInt(a.season, 0, 200); episode = clampInt(a.episode, 1, 1000);
            if (season === undefined || episode === undefined) return { error: 'single_episode_required', message: 'Downloads of a series are staged one episode at a time (season and episode). To fetch a whole season or new episodes automatically, use stage_monitor (admin only).' };
            videoId = `${id}:${season}:${episode}`;
            if (library.episodeIds().includes(videoId)) return { error: 'already_on_server' };
        } else {
            const lib = library.getByImdb(id);
            if (lib && lib.fileCount > 0) return { error: 'already_on_server' };
        }
        try {
            const st = await downloadsManager.checkMedia(videoId);
            if (st && st.status) return { error: st.downloaded ? 'already_downloaded' : 'already_downloading', status: st.status };
        } catch (_) { /* downloader unavailable: Confirm will say so */ }

        const facts = await titleFacts(id, type);
        if (!facts) return { error: 'title_not_found' };
        if (type === 'series') {
            const v = facts.videos.find((x) => Number(x.season) === season && Number(x.episode ?? x.number) === episode);
            if (facts.videos.length && !v) return { error: 'episode_not_found' };
            if (v && v.released && Date.parse(v.released) > Date.now()) return { error: 'not_released_yet', air_date: String(v.released).slice(0, 10) };
        }
        const profile = (a.quality_profile && profileByName(a.quality_profile)) || qualityStore.getDefault();
        const streams = (await fetchStreams(type, videoId)).slice(0, MAX_STREAMS).map(cleanStream);
        if (!streams.length) return { error: 'no_releases_found', message: 'No release candidates are available yet.' };
        let chosen;
        try {
            chosen = await chooseRelease({ profile, streams, type, probeMany });
        } catch (e) {
            if (e.body) return { error: e.body.error, quality_profile: profile.name, considered: e.body.considered, rejected_summary: e.body.rejectedSummary, message: e.body.message };
            throw e;
        }
        const p = chosen.r.picked;
        const title = type === 'series' ? `${facts.name} - S${pad(season)}E${pad(episode)}` : facts.name;
        const card = {
            kind: 'download', summary: `Download ${title} (${p.info.resolution || '?'}${p.info.sizeGB ? `, ${p.info.sizeGB} GB` : ''})`,
            title, imdbId: id, type, season, episode, poster: facts.poster, year: facts.year,
            release: short(p.info.label, 140), resolution: p.info.resolution, sizeGB: p.info.sizeGB, seeders: p.info.seeders, swarm: chosen.swarm, qualityProfile: profile.name,
        };
        const staged = staging.stage({
            kind: 'download', email: ctx.login.email, profileId: ctx.profile.id, card,
            payload: { picked: p, profile: { id: profile.id, name: profile.name }, meta: { type, title, showTitle: type === 'series' ? facts.name : undefined, imdbId: id, mediaId: videoId, season, episode, poster: facts.poster, year: facts.year } },
        });
        ctx.staged.push(staged);
        return { status: 'STAGED_PENDING_USER_CONFIRMATION', staged_id: staged.id, title, release: card.release, resolution: card.resolution, size_gb: card.sizeGB, peers: card.swarm, quality_profile: profile.name, expires_in_minutes: Math.round(staging.TTL_MS / 60000) };
    }

    async function stageMonitor(a, ctx) {
        const kids = notKids(ctx); if (kids) return kids;
        if (!ctx.login.isAdmin) return { error: 'admin_only', message: 'Only an admin can set up automatic downloads.' };
        const id = String(a.imdb_id || '').trim();
        if (!ID_RE.test(id)) return { error: 'imdb_id must look like tt0111161' };
        let scope;
        try {
            scope = normalizeScope({ mode: a.scope, seasons: a.seasons });
        } catch (e) { return { error: e.message }; }
        const facts = await titleFacts(id, 'series');
        if (!facts) return { error: 'title_not_found' };
        const profile = a.quality_profile ? profileByName(a.quality_profile) : null;
        const card = { kind: 'monitor', summary: `Monitor ${facts.name} (${scopeLabel(scope)})`, title: facts.name, imdbId: id, type: 'series', poster: facts.poster, year: facts.year, scopeLabel: scopeLabel(scope), qualityProfile: (profile || qualityStore.getDefault()).name };
        const staged = staging.stage({
            kind: 'monitor', email: ctx.login.email, profileId: ctx.profile.id, card,
            payload: { imdbId: id, title: facts.name, poster: facts.poster, scope, profileId: profile ? profile.id : undefined },
        });
        ctx.staged.push(staged);
        return { status: 'STAGED_PENDING_USER_CONFIRMATION', staged_id: staged.id, title: facts.name, scope: scopeLabel(scope), expires_in_minutes: Math.round(staging.TTL_MS / 60000) };
    }

    const handlers = {
        find_titles: findTitles, search_titles: searchTitles, get_title: getTitle, get_server_library: getServerLibrary,
        get_downloads: getDownloads, get_watch_history: getWatchHistory, present_titles: presentTitles,
        stage_download: stageDownload, stage_monitor: stageMonitor,
    };

    /** Runs one tool. Always returns a JSON-able object (errors become { error }). */
    async function run(name, args, ctx) {
        const fn = handlers[name];
        if (!fn) return { error: `unknown_tool:${name}` };
        return fn(args && typeof args === 'object' ? args : {}, ctx);
    }

    return { declarations: DECLARATIONS, run };
}

module.exports = { createTools, DECLARATIONS };
