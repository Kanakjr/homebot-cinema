'use strict';
// Swarm health check: "can the streaming server actually pull data for this torrent right now?"
// Listed seeder counts are scraped and often stale (a torrent listing 406 seeders had 0 unchoked peers). So we do what
// pressing Play would do: start the torrent and try to read the first bytes of the file, then look at the peer stats.
//
//   good  - the first 512 KB arrived quickly           -> will start playing
//   slow  - data flows but slowly / only a trickle      -> will buffer
//   dead  - nothing arrived (no unchoked peers)         -> would sit on the loading poster
//   unknown - the streaming server could not be asked

const http = require('http');

const HASH_RE = /^[a-f0-9]{40}$/i;

function createSwarmProbe({
    host, port, warm = async () => {}, bytesWanted = 512 * 1024, goodMs = 6000, maxMs = 10000,
    cacheMs = 5 * 60 * 1000, concurrency = 6, now = () => Date.now(), random = Math.random,
}) {
    const cache = new Map(); // key -> { at, promise }
    let running = 0;
    const waiting = [];
    const slot = async () => {
        if (running >= concurrency) await new Promise((r) => waiting.push(r));
        running++;
    };
    const release = () => {
        running--;
        const next = waiting.shift();
        if (next) next();
    };

    function readStats(hash) {
        return new Promise((resolve) => {
            const req = http.get({ host, port, path: `/${hash}/stats.json`, timeout: 3000 }, (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => {
                    try {
                        const j = JSON.parse(body);
                        resolve({ peers: j.peers ?? 0, unchoked: j.unchoked ?? 0, speed: j.downloadSpeed ?? 0, files: Array.isArray(j.files) ? j.files : [] });
                    } catch (_) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        });
    }

    // Reads up to `bytesWanted` of the file; resolves with how much arrived and how long it took. Never rejects.
    function readHead(hash, idx, start) {
        return new Promise((resolve) => {
            const t0 = now();
            let bytes = 0;
            let errored = false;
            let done = false;
            let req;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { req && req.destroy(); } catch (_) { /* already closed */ }
                resolve({ bytes, ms: now() - t0, errored });
            };
            const timer = setTimeout(finish, maxMs);
            req = http.get({ host, port, path: `/${hash}/${idx}`, headers: { Range: `bytes=${start}-${start + bytesWanted - 1}` } }, (res) => {
                if (res.statusCode >= 400) return finish();
                res.on('data', (c) => { bytes += c.length; if (bytes >= bytesWanted) finish(); });
                res.on('end', finish);
                res.on('error', finish);
            });
            req.on('error', () => { errored = true; finish(); });
        });
    }

    // A random 1 MB-aligned offset in the middle of the file. The start of a file is often already cached from an
    // earlier attempt, which would make a dead swarm look healthy (the exact trap that made a dead torrent stall
    // about a minute into playback). A fresh region needs new pieces from peers, like a seek or continued playback.
    function pickStart(stats, idx) {
        const file = stats && stats.files && stats.files[idx];
        const len = file && Number(file.length);
        if (!len || len < bytesWanted * 8) return 0;
        const lo = Math.floor(len * 0.15);
        const hi = Math.floor(len * 0.85) - bytesWanted;
        const start = lo + Math.floor(random() * (hi - lo));
        return start - (start % (1024 * 1024));
    }

    async function run(hash, idx) {
        await slot();
        try {
            await Promise.race([Promise.resolve(warm(hash)).catch(() => {}), new Promise((r) => setTimeout(r, Math.min(maxMs / 2, 4000)))]);
            const hasIdx = Number.isInteger(idx) && idx >= 0;
            const pre = await readStats(hash);
            let head = { bytes: 0, ms: 0, errored: false, start: 0 };
            let stats;
            if (hasIdx) {
                const start = pickStart(pre, idx);
                head = { ...(await readHead(hash, idx, start)), start };
                stats = (await readStats(hash)) || pre;
            } else {
                await new Promise((r) => setTimeout(r, Math.min(maxMs, 4000)));
                stats = (await readStats(hash)) || pre;
            }
            let verdict;
            // could not talk to the streaming server at all: say so, never "dead" (an outage is not a dead swarm)
            if (!stats && (!hasIdx || head.errored)) verdict = 'unknown';
            else if (head.bytes >= bytesWanted && head.ms <= goodMs) verdict = 'good';
            else if (head.bytes >= bytesWanted || head.bytes >= 64 * 1024) verdict = 'slow';
            else if (stats && stats.unchoked >= 1) verdict = 'slow';
            else if (!hasIdx) verdict = stats && stats.unchoked >= 2 ? 'good' : 'dead';
            else verdict = 'dead';
            return { verdict, bytes: head.bytes, ms: head.ms, start: head.start, peers: stats ? stats.peers : null, unchoked: stats ? stats.unchoked : null };
        } catch (_) {
            return { verdict: 'unknown', bytes: 0, ms: 0, peers: null, unchoked: null };
        } finally {
            release();
        }
    }

    function probe(infoHash, fileIdx) {
        if (!HASH_RE.test(String(infoHash || ''))) return Promise.resolve({ verdict: 'unknown', bytes: 0, ms: 0, peers: null, unchoked: null });
        const hash = infoHash.toLowerCase();
        const idx = Number.isInteger(fileIdx) ? fileIdx : null;
        const key = `${hash}:${idx}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < cacheMs) return hit.promise;
        const promise = run(hash, idx).then((r) => {
            if (r.verdict === 'unknown') cache.delete(key); // do not remember "could not ask"
            return r;
        });
        cache.set(key, { at: now(), promise });
        if (cache.size > 300) {
            for (const [k, v] of cache) if (now() - v.at > cacheMs) cache.delete(k);
        }
        return promise;
    }

    // items: [{ infoHash, fileIdx }] -> { [infoHashLowercase]: result }
    async function probeMany(items) {
        const out = {};
        await Promise.all((items || []).map(async (it) => { out[String(it.infoHash).toLowerCase()] = await probe(it.infoHash, it.fileIdx); }));
        return out;
    }

    return { probe, probeMany };
}

// Among the best-ranked candidates, the first whose swarm is not dead. `result` is quality.pickBest()'s return value.
async function chooseLive(result, probeMany, { top = 3 } = {}) {
    const ranked = result.results.filter((r) => r.accepted).sort((a, b) => b.score - a.score);
    const cands = ranked.slice(0, top);
    const probes = cands.filter((c) => c.stream.infoHash);
    const health = probes.length ? await probeMany(probes.map((c) => ({ infoHash: c.stream.infoHash, fileIdx: c.stream.fileIdx }))) : {};
    const verdictOf = (c) => (c.stream.infoHash && health[c.stream.infoHash.toLowerCase()] ? health[c.stream.infoHash.toLowerCase()].verdict : 'unknown');
    const live = cands.find((c) => verdictOf(c) !== 'dead') || null;
    return { picked: live, health, checked: cands.length, allDead: cands.length > 0 && !live };
}

module.exports = { createSwarmProbe, chooseLive, HASH_RE };
