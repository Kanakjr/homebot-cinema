'use strict';
// Plugin "livesubs": subtitles generated live by Whisper while you watch, for streams that have none.
//   POST /api/livesubs/open { infoHash, fileIdx } | { file: 'lf_12' }, position (s), language?, translate?
//        -> { id, status }            starts (or joins) transcription from the viewer's position
//   GET  /api/livesubs/:id?pos=&from=&to=  -> { cues: [{ start, end, text }], status }   also the playhead heartbeat
//   POST /api/livesubs/:id/close           -> stop reading now (AI subtitles switched off or player closed)
//   GET  /api/livesubs/:id/vtt             -> everything transcribed so far, as WebVTT
//   GET  /api/livesubs/health              -> { whisper: true|false }
// Audio is read through the streaming server (torrents) or from the library file; Whisper runs on a whisper.cpp server
// (LIVESUBS_WHISPER_URL), normally on the host so it can use the GPU. Nothing leaves the house.

const crypto = require('crypto');
const { createEngine } = require('./engine');
const { createWhisperClient } = require('./whisper');
const C = require('./cues');

const HASH = /^[a-f0-9]{40}$/i;
const LIB_FILE = /^lf_(\d{1,12})$/;
const LANG = /^(auto|[a-z]{2,3})$/;

function register(ctx, { engine: injectedEngine, fetchImpl } = {}) {
    const whisperUrl = ctx.config.get('LIVESUBS_WHISPER_URL', '');
    if (!whisperUrl && !injectedEngine) return ctx.disable('LIVESUBS_WHISPER_URL is not set');

    ctx.db.migrate([
        `CREATE TABLE livesubs_cues (
            key TEXT PRIMARY KEY,
            cues_json TEXT NOT NULL,
            ranges_json TEXT NOT NULL,
            language TEXT,
            updated_at INTEGER NOT NULL
        )`,
    ]);
    const raw = ctx.db.raw;
    const store = {
        load(key) {
            const row = raw.prepare('SELECT cues_json, ranges_json, language FROM livesubs_cues WHERE key = ?').get(key);
            return row ? { cues: JSON.parse(row.cues_json), ranges: JSON.parse(row.ranges_json), language: row.language } : null;
        },
        save(key, { cues, ranges, language }) {
            raw.prepare(`INSERT INTO livesubs_cues (key, cues_json, ranges_json, language, updated_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET cues_json = excluded.cues_json, ranges_json = excluded.ranges_json,
                language = excluded.language, updated_at = excluded.updated_at`)
                .run(key, JSON.stringify(cues), JSON.stringify(ranges), language || null, Date.now());
        },
    };

    const whisper = whisperUrl ? createWhisperClient({ baseUrl: whisperUrl, fetchImpl }) : null;
    const engine = injectedEngine || createEngine({
        whisper,
        log: ctx.log,
        store,
        maxLeadSec: ctx.config.int('LIVESUBS_MAX_LEAD_SEC', 150),
        chunkSec: ctx.config.int('LIVESUBS_CHUNK_SEC', 30),
        firstChunkSec: ctx.config.int('LIVESUBS_FIRST_CHUNK_SEC', 8),
    });
    const defaultLanguage = ctx.config.get('LIVESUBS_LANGUAGE', 'auto');
    const streamingBase = `http://${ctx.config.get('STREMIO_SERVER_HOST', 'stremio-streaming-server')}:${ctx.config.int('STREMIO_SERVER_PORT', 11470)}`;
    const ids = new Map(); // public id -> engine key

    async function guessFileIdx(hash) {
        const r = await (fetchImpl || fetch)(`${streamingBase}/${hash}/create`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ torrent: { infoHash: hash }, guessFileIdx: {} }),
            signal: AbortSignal.timeout(20000),
        });
        const j = await r.json();
        return Number.isInteger(j.guessedFileIdx) ? j.guessedFileIdx : null;
    }

    /** -> { key, input } or { error } */
    async function resolveSource(body) {
        if (body.infoHash !== undefined) {
            const hash = String(body.infoHash).toLowerCase();
            if (!HASH.test(hash)) return { error: 'bad_info_hash' };
            let idx = body.fileIdx;
            if (idx === undefined || idx === null || idx === '') idx = await guessFileIdx(hash).catch(() => null);
            if (!Number.isInteger(Number(idx)) || Number(idx) < 0) return { error: 'no_file_idx' };
            return { key: `bt:${hash}:${Number(idx)}`, input: `${streamingBase}/${hash}/${Number(idx)}` };
        }
        if (body.file !== undefined) {
            const m = LIB_FILE.exec(String(body.file));
            if (!m) return { error: 'bad_file' };
            const lib = ctx.services.library;
            const p = lib && typeof lib.filePath === 'function' ? lib.filePath(Number(m[1])) : null;
            if (!p || !ctx.sdk.isInsideRoots(p)) return { error: 'not_found' };
            return { key: `lf:${m[1]}`, input: p };
        }
        // plain URL streams would let a client make the server fetch any address: not supported (yet)
        return { error: 'unsupported_source' };
    }

    function cuesFor(t, q) {
        const pos = Number(q.pos);
        const from = Number.isFinite(Number(q.from)) ? Number(q.from) : (Number.isFinite(pos) ? pos - 10 : 0);
        const to = Number.isFinite(Number(q.to)) ? Number(q.to) : from + 300;
        return C.cuesBetween(t.cues, from, to);
    }

    ctx.app.get('/api/livesubs/health', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        res.json({ whisper: whisper ? await whisper.health() : true });
    });

    ctx.app.post('/api/livesubs/open', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const body = req.body || {};
        const language = body.language === undefined ? defaultLanguage : String(body.language);
        if (!LANG.test(language)) return res.status(400).json({ error: 'bad_language' });
        const translate = body.translate === true;
        const position = Math.max(0, Number(body.position) || 0);
        const src = await resolveSource(body);
        if (src.error) return res.status(400).json({ error: src.error });
        const key = `${src.key}|${language}|${translate ? 'en' : 'src'}`;
        const t = engine.open({ key, input: src.input, language, translate, position });
        const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
        ids.set(id, key);
        res.json({ id, status: t.status() });
    });

    // the viewer switched AI subtitles off (or left the player): stop reading the stream now
    ctx.app.post('/api/livesubs/:id/close', (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const key = ids.get(req.params.id);
        if (!key || !engine.release(key)) return res.status(404).json({ error: 'not_found' });
        res.json({ ok: true });
    });

    ctx.app.get('/api/livesubs/:id/vtt', (req, res) => {
        const t = engine.get(ids.get(req.params.id));
        if (!t) return res.status(404).json({ error: 'not_found' });
        res.set('Cache-Control', 'private, no-store');
        res.type('text/vtt').send(C.toVtt(t.cues));
    });

    ctx.app.get('/api/livesubs/:id', (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const t = engine.get(ids.get(req.params.id));
        if (!t) return res.status(404).json({ error: 'not_found' });
        const pos = Number(req.query.pos);
        if (Number.isFinite(pos)) t.touch(pos);
        res.json({ cues: cuesFor(t, req.query), status: t.status() });
    });

    return { engine };
}

module.exports = { register };
