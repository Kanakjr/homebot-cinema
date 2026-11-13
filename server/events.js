'use strict';
// Live updates over Server-Sent Events. Events are small "this changed" hints (downloads, library, sentinel);
// pages refetch with their own auth, so nothing private is broadcast. Replaces per-tab polling.

const HEADERS = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
};

function createEventHub({ heartbeatMs = 25000, throttleMs = 1000, now = () => Date.now() } = {}) {
    const clients = new Set();
    const last = new Map();
    const pending = new Map();
    const write = (res, chunk) => {
        try { res.write(chunk); } catch (_) { /* connection already gone */ }
    };
    const send = (type, data) => {
        const chunk = `event: ${type}\ndata: ${JSON.stringify(data || {})}\n\n`;
        for (const res of clients) write(res, chunk);
    };

    // GET /api/events (mounted behind requireLogin). The heartbeat keeps Cloudflare (100 s idle cut-off) and proxies from closing it.
    function handler(req, res) {
        res.writeHead(200, HEADERS);
        res.write('retry: 5000\n\n');
        clients.add(res);
        const hb = setInterval(() => write(res, ': hb\n\n'), heartbeatMs);
        const done = () => {
            clearInterval(hb);
            clients.delete(res);
        };
        req.on('close', done);
        res.on('close', done);
    }

    // At most one event per type per throttle window; bursts collapse into one trailing event with the latest data.
    function emit(type, data) {
        const t = now();
        const prev = last.has(type) ? last.get(type) : -Infinity;
        if (pending.has(type)) {
            pending.get(type).data = data;
            return;
        }
        if (t - prev >= throttleMs) {
            last.set(type, t);
            send(type, data);
            return;
        }
        const p = { data };
        p.timer = setTimeout(() => {
            pending.delete(type);
            last.set(type, now());
            send(type, p.data);
        }, throttleMs - (t - prev));
        pending.set(type, p);
    }

    function close() {
        for (const p of pending.values()) clearTimeout(p.timer);
        pending.clear();
        for (const res of clients) {
            try { res.end(); } catch (_) { /* ignore */ }
        }
        clients.clear();
    }

    return { handler, emit, close, size: () => clients.size };
}

// Emit `type` after each listed method settles (sync or async), without changing what the method returns or throws.
function emitAfter(obj, methods, emit, type) {
    for (const m of methods) {
        if (typeof obj[m] !== 'function') throw new Error(`emitAfter: ${m} is not a method`);
        const orig = obj[m].bind(obj);
        obj[m] = (...args) => {
            let r;
            try {
                r = orig(...args);
            } catch (e) {
                emit(type);
                throw e;
            }
            if (r && typeof r.then === 'function') r.then(() => emit(type), () => emit(type));
            else emit(type);
            return r;
        };
    }
}

// Watches Transmission so progress and completions are pushed: every activeMs while something downloads, else idleMs.
// onComplete(hash) runs once per torrent that reaches 100 % (used to post-process and rescan the library).
function createTorrentWatcher({ getTorrents, emit, onComplete = () => {}, activeMs = 3000, idleMs = 20000, log = console }) {
    let sig = null;
    let timer = null;
    let stopped = false;
    let known = null; // hash -> done, from the previous tick
    async function tick() {
        let active = false;
        try {
            const torrents = await getTorrents(['hashString', 'status', 'percentDone', 'rateDownload', 'isFinished', 'errorString']);
            const next = new Map();
            for (const t of torrents) {
                const done = t.percentDone >= 1 || !!t.isFinished;
                next.set(t.hashString, done);
                if (!done) active = true;
                if (done && known && known.get(t.hashString) === false) {
                    try { onComplete(t.hashString); } catch (e) { log.error('[Events] onComplete failed:', e.message); }
                }
            }
            known = next;
            const s = JSON.stringify(torrents.map((t) => [t.hashString, t.status, Math.round((t.percentDone || 0) * 1000), t.rateDownload > 0, t.errorString || '']).sort());
            if (sig !== null && s !== sig) emit('downloads');
            sig = s;
        } catch (_) {
            // Transmission unreachable: try again later
        }
        if (!stopped) {
            timer = setTimeout(tick, active ? activeMs : idleMs);
            if (timer.unref) timer.unref();
        }
        return active;
    }
    return {
        start() { stopped = false; return tick(); },
        tick,
        stop() { stopped = true; clearTimeout(timer); },
    };
}

module.exports = { createEventHub, emitAfter, createTorrentWatcher };
