'use strict';
// Plugin "skip": where segments come from.
//   IntroDB (community database, https://introdb.app): one GET per episode or movie, on demand only (its terms forbid crawling),
//     cached in SQLite. Only the IMDb id, season and episode leave the server; no key, no user data, a generic User-Agent.
//   Chapter markers inside a server library file, read with ffprobe (no network).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { fromIntroDb, fromChapters } = require('./segments');

const DAY = 24 * 3600 * 1000;
const FOUND_TTL = 7 * DAY; // community data improves slowly; refresh weekly
const EMPTY_TTL = 1 * DAY; // nothing yet: ask again tomorrow

/**
 * createIntroDb({ baseUrl, raw, fetchImpl, now, timeoutMs }) -> { lookup({ imdbId, season, episode, movie }) }
 * lookup resolves to { segments, cached } and throws on network/HTTP errors (which are never cached).
 */
function createIntroDb({ baseUrl, raw, fetchImpl = fetch, now = Date.now, timeoutMs = 5000 }) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const getRow = raw.prepare('SELECT segments_json, fetched_at FROM skip_segments WHERE key = ?');
    const putRow = raw.prepare(`INSERT INTO skip_segments (key, segments_json, fetched_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET segments_json = excluded.segments_json, fetched_at = excluded.fetched_at`);
    const inflight = new Map();

    async function fetchSegments(id) {
        const q = new URLSearchParams({ imdb_id: id.imdbId });
        if (id.movie) q.set('is_movie', 'true');
        else {
            q.set('season', String(id.season));
            q.set('episode', String(id.episode));
        }
        const res = await fetchImpl(`${base}/segments?${q}`, {
            headers: { Accept: 'application/json', 'User-Agent': 'HomeBotCinema' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`introdb_http_${res.status}`);
        return fromIntroDb(await res.json());
    }

    async function lookup(id) {
        const key = id.movie ? id.imdbId : `${id.imdbId}:${id.season}:${id.episode}`;
        const row = getRow.get(key);
        if (row) {
            let segments = [];
            try { segments = JSON.parse(row.segments_json) || []; } catch (_) { segments = []; }
            const ttl = segments.length ? FOUND_TTL : EMPTY_TTL;
            if (now() - row.fetched_at < ttl) return { segments, cached: true };
        }
        if (inflight.has(key)) return inflight.get(key);
        const p = fetchSegments(id)
            .then((segments) => {
                putRow.run(key, JSON.stringify(segments), now());
                return { segments, cached: false };
            })
            .finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    }

    return { lookup };
}

/**
 * createChapterReader({ execFileImpl, statImpl, timeoutMs, log }) -> { read(path) }
 * read resolves to segments from the file's chapter markers ([] when there are none, ffprobe is missing or the file is slow).
 * Cached in memory by path + size + mtime.
 */
function createChapterReader({ execFileImpl = execFile, statImpl = fs.promises.stat, timeoutMs = 8000, log = console, max = 500 } = {}) {
    const cache = new Map();
    let missing = false;

    const probe = (file) => new Promise((resolve) => {
        // absolute library paths only (read() checks), so the argument can never be read as an option or a URL
        execFileImpl('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', file],
            { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        if (!missing) log.warn('ffprobe not found: chapter markers are not read');
                        missing = true;
                    }
                    return resolve(null); // timeouts and unreadable files: no chapters, not cached
                }
                try {
                    resolve(fromChapters((JSON.parse(String(stdout || '{}')) || {}).chapters));
                } catch (_) {
                    resolve([]);
                }
            });
    });

    async function read(file) {
        if (missing || typeof file !== 'string' || !path.isAbsolute(file)) return [];
        let st;
        try { st = await statImpl(file); } catch (_) { return []; }
        const stamp = `${st.size}:${st.mtimeMs}`;
        const hit = cache.get(file);
        if (hit && hit.stamp === stamp) return hit.segments;
        const segments = await probe(file);
        if (segments === null) return [];
        if (cache.size >= max) cache.delete(cache.keys().next().value);
        cache.set(file, { stamp, segments });
        return segments;
    }

    return { read };
}

module.exports = { createIntroDb, createChapterReader, FOUND_TTL, EMPTY_TTL };
