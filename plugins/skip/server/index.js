'use strict';
// Plugin "skip": Skip intro / recap / credits in the player.
//   GET /api/skip/segments?videoId=tt0944947:1:2[&file=lf_12] -> { segments: [{ type, start, end, source }] } (seconds)
// Sources, best first: chapter markers in the server file (file=lf_<library file id>), then IntroDB by IMDb id.
// The UI (ui/) shows the buttons, auto-skips when the profile asks for it, and tells the player when the credits start.

const { parseVideoId, mergeSegments, libraryFileId } = require('./segments');
const { createIntroDb, createChapterReader } = require('./sources');

const DEFAULT_INTRODB_URL = 'https://api.introdb.app';

function register(ctx, { fetchImpl, chapterReader } = {}) {
    ctx.db.migrate([
        `CREATE TABLE skip_segments (
            key TEXT PRIMARY KEY,
            segments_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        )`,
    ]);

    // SKIP_INTRODB_URL=off (or none) keeps every lookup on this machine: only chapter markers are used
    const url = ctx.config.get('SKIP_INTRODB_URL', DEFAULT_INTRODB_URL);
    const introDb = /^(off|none|0|false)$/i.test(url) ? null : createIntroDb({ baseUrl: url, raw: ctx.db.raw, fetchImpl });
    const chapters = chapterReader || createChapterReader({ log: ctx.log });
    const library = ctx.services.library;

    async function fileSegments(fileParam) {
        if (fileParam === undefined || fileParam === '') return [];
        if (!/^lf_\d{1,12}$/.test(String(fileParam))) return null; // bad input
        const p = library && typeof library.filePath === 'function' ? library.filePath(libraryFileId(fileParam)) : null;
        if (!p || !ctx.sdk.isInsideRoots(p)) return [];
        return chapters.read(p);
    }

    ctx.app.get('/api/skip/segments', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const rawId = req.query.videoId;
        const id = rawId === undefined || rawId === '' ? null : parseVideoId(rawId);
        if (rawId && !id) return res.status(400).json({ error: 'bad_video_id' });
        const fromFile = await fileSegments(req.query.file);
        if (fromFile === null) return res.status(400).json({ error: 'bad_file' });

        let fromDb = [];
        let introdb = introDb ? 'none' : 'off';
        if (id && introDb) {
            try {
                const r = await introDb.lookup(id);
                fromDb = r.segments;
                introdb = r.segments.length ? 'found' : 'none';
            } catch (e) {
                introdb = 'error';
                ctx.log.warn(`IntroDB lookup failed for ${rawId}: ${e.message}`);
            }
        }
        res.json({ segments: mergeSegments(fromFile, fromDb), introdb });
    });

    return {};
}

module.exports = { register, DEFAULT_INTRODB_URL };
