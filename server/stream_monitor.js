'use strict';
// Stream monitor: sees every request the proxy forwards to the Stremio streaming server.
//
// 1. Logging. One line per playback start (time until the first data arrived, plus the torrent's peers), one per slow
//    read and one when a viewer gave up before any data came. Without it "why did that take a minute?" could only be
//    answered by rebuilding timings from the streaming server's bare request log.
//
// 2. Closing torrents nobody watches. The streaming server is meant to drop a torrent ~2 min after its last stream
//    ends, but a read abandoned halfway (a seek, the swarm probe, a closed tab) is sometimes never counted as ended,
//    and that torrent then stays connected to hundreds of peers for good. Seen 2026-11-27 after 14 h: 10 such torrents,
//    ~1,300 peer connections, ~850 new connection attempts a second, and the server's memory at ~2.8 GB in a 4 GB VM.
//    Every viewer request comes through our proxy, so a torrent with no open viewer connection and no request for
//    `idleMs` is removed (GET /<hash>/remove). A torrent we never saw a request for (started by the swarm probe) is
//    timed from when the sweep first sees it. Playing a removed torrent again simply starts it again.

const PATH_HASH_RE = /^\/([0-9a-f]{40})(?:\/(.*))?$/i;
const ANY_HASH_RE = /(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i;
const HLS_RE = /^\/hlsv2\/([^/?]+)\//;

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

function createStreamMonitor({
    listEngines,                 // async () => { <hash>: <stats.json of that torrent> } | null
    removeEngine,                // async (hash) => true when the streaming server removed it
    statsOf = null,              // async (hash) => stats.json of one torrent | null (adds peers to log lines)
    onRemoved = () => {},        // (hash) => void
    log = console.log,
    now = Date.now,
    idleMs = 20 * 60 * 1000,     // 0 = never remove anything
    sweepMs = 2 * 60 * 1000,
    slowMs = 5000,               // a read whose first data takes longer is logged
    sessionGapMs = 5 * 60 * 1000, // media reads further apart than this start a new "playback"
    healthEveryMs = 30 * 60 * 1000,
} = {}) {
    const state = new Map();  // hash -> { open, last, lastMedia }
    const hlsIds = new Map(); // HLS session id -> { hash, last }
    let lastHealthLog = -Infinity; // the first sweep with torrents open reports them
    let timer = null;

    function stateOf(hash) {
        let s = state.get(hash);
        if (!s) { s = { open: 0, last: now(), lastMedia: 0 }; state.set(hash, s); }
        return s;
    }

    // -> { hash, idx, kind } with kind 'media' | 'hls' | 'stats' | 'other', or null when no torrent is involved
    function classify(url) {
        const raw = String(url || '').replace(/^\/streaming(?=\/)/, '');
        const qAt = raw.indexOf('?');
        const path = qAt === -1 ? raw : raw.slice(0, qAt);
        let query = qAt === -1 ? '' : raw.slice(qAt + 1);
        try { query = decodeURIComponent(query); } catch (_) { /* keep it encoded */ }

        const m = PATH_HASH_RE.exec(path);
        if (m) {
            const hash = m[1].toLowerCase();
            const rest = m[2] || '';
            if (/^(\d+\/)?stats\.json$/.test(rest)) return { hash, idx: null, kind: 'stats' };
            const media = /^(\d+)(?:\/|$)/.exec(rest);
            if (media) return { hash, idx: Number(media[1]), kind: 'media' };
            return { hash, idx: null, kind: 'other' };
        }
        const hls = HLS_RE.exec(path);
        if (hls) {
            const id = hls[1];
            const inQuery = ANY_HASH_RE.exec(query);
            if (inQuery) {
                const hash = inQuery[1].toLowerCase();
                hlsIds.set(id, { hash, last: now() });
                return { hash, idx: null, kind: 'hls' };
            }
            const known = hlsIds.get(id);
            if (known) { known.last = now(); return { hash: known.hash, idx: null, kind: 'hls' }; }
            return null;
        }
        const any = ANY_HASH_RE.exec(query); // e.g. /opensubHash?videoUrl=.../<hash>/0
        return any ? { hash: any[1].toLowerCase(), idx: null, kind: 'other' } : null;
    }

    async function describe(hash) {
        if (!statsOf) return '';
        let st = null;
        try { st = await statsOf(hash); } catch (_) { st = null; }
        if (!st) return '';
        const name = st.name ? ` "${String(st.name).slice(0, 60)}"` : '';
        const speed = ((Number(st.downloadSpeed) || 0) / 1e6).toFixed(1);
        return `${name} (peers ${st.peers ?? '?'}, unchoked ${st.unchoked ?? '?'}, ${speed} MB/s)`;
    }

    // Call for each proxied request. Returns { response(status), firstData(), done() } or null.
    function track(url, method = 'GET') {
        const c = classify(url);
        if (!c) return null;
        const s = stateOf(c.hash);
        const t0 = now();
        s.open++;
        s.last = t0;
        const isRead = method === 'GET' && (c.kind === 'media' || c.kind === 'hls');
        let isStart = false;
        if (isRead) {
            isStart = !s.lastMedia || t0 - s.lastMedia > sessionGapMs;
            s.lastMedia = t0;
        }
        const label = `${c.hash.slice(0, 8)}${c.idx === null ? '' : `/${c.idx}`}${c.kind === 'hls' ? ' (HLS)' : ''}`;
        let status = 0;
        let gotData = false;
        let closed = false;
        const report = (text) => {
            describe(c.hash).then((d) => log(`[stream] ${text}${d}`), () => log(`[stream] ${text}`));
        };
        return {
            response(code) { status = Number(code) || 0; },
            firstData() {
                if (gotData) return;
                gotData = true;
                if (!isRead) return;
                const ms = now() - t0;
                if (isStart) report(`start ${label}: first data after ${secs(ms)}`);
                else if (ms >= slowMs) report(`slow read ${label}: first data after ${secs(ms)}`);
            },
            done() {
                if (closed) return;
                closed = true;
                s.open = Math.max(0, s.open - 1);
                s.last = now();
                const ms = s.last - t0;
                const ok = status === 0 || (status >= 200 && status < 300);
                if (isRead && !gotData && ok && ms >= slowMs) report(`no data for ${label} after ${secs(ms)}, the viewer left`);
            },
        };
    }

    // Removes torrents nobody watched for idleMs. -> { open, conns, removed: [hash] } or null (server not reachable)
    async function sweep() {
        let engines = null;
        try { engines = await listEngines(); } catch (_) { engines = null; }
        if (!engines || typeof engines !== 'object') return null;
        const t = now();
        const present = new Set();
        const removed = [];
        const removedHashes = [];
        let conns = 0;
        for (const [h, e] of Object.entries(engines)) {
            const hash = h.toLowerCase();
            present.add(hash);
            const c = Number(e && e.swarmConnections) || 0;
            const s = stateOf(hash); // first sighting starts the clock for torrents we never saw a request for
            if (idleMs <= 0 || s.open > 0 || t - s.last < idleMs) { conns += c; continue; }
            let ok = false;
            try { ok = await removeEngine(hash); } catch (_) { ok = false; }
            if (ok) {
                removed.push(`${hash.slice(0, 8)}${e && e.name ? ` "${String(e.name).slice(0, 40)}"` : ''}`);
                removedHashes.push(hash);
                state.delete(hash);
                try { onRemoved(hash); } catch (_) { /* best effort */ }
            } else {
                conns += c;
            }
        }
        for (const [hash, s] of state) {
            if (!present.has(hash) && s.open === 0 && t - s.last >= Math.max(idleMs, sessionGapMs)) state.delete(hash);
        }
        for (const [id, v] of hlsIds) {
            if (!state.has(v.hash) && t - v.last >= Math.max(idleMs, sessionGapMs)) hlsIds.delete(id);
        }
        const open = present.size - removed.length;
        if (removed.length) {
            log(`[streams] closed ${removed.length} torrent(s) nobody watched for ${Math.round(idleMs / 60000)} min: ${removed.join(', ')}; ${open} open, ${conns} peer connections`);
            lastHealthLog = t;
        } else if (open > 0 && t - lastHealthLog >= healthEveryMs) {
            log(`[streams] ${open} torrent(s) open, ${conns} peer connections`);
            lastHealthLog = t;
        }
        return { open, conns, removed: removedHashes };
    }

    function start() {
        if (timer || sweepMs <= 0) return;
        timer = setInterval(() => { sweep().catch(() => {}); }, sweepMs);
        if (timer.unref) timer.unref();
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { track, sweep, start, stop, classify };
}

module.exports = { createStreamMonitor };
