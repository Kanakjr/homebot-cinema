'use strict';
// Plugin "skip": pure helpers. A segment is { type, start, end, source } in SECONDS (the player converts to ms in one place,
// ui/logic.js). Types: intro, recap, credits, postcredits.

const TYPES = ['intro', 'recap', 'credits', 'postcredits'];
// sanity limits per type (seconds); longer "segments" are bad data, not an intro
const MAX_LENGTH = { intro: 300, recap: 600, credits: 1200, postcredits: 900 };
const MIN_LENGTH = 2;

/** 'tt0944947:1:2' -> { imdbId, season, episode }; 'tt0816692' -> { imdbId, movie: true }; anything else -> null */
function parseVideoId(videoId) {
    const m = /^(tt\d{1,10})(?::(\d{1,4}):(\d{1,5}))?$/.exec(String(videoId || ''));
    if (!m) return null;
    if (m[2] === undefined) return { imdbId: m[1], movie: true };
    return { imdbId: m[1], season: Number(m[2]), episode: Number(m[3]), movie: false };
}

/** Keeps a segment only if it has finite, ordered, plausible times. */
function validSegment(seg) {
    if (!seg || !TYPES.includes(seg.type)) return false;
    const { start, end } = seg;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return false;
    const len = end - start;
    return len >= MIN_LENGTH && len <= MAX_LENGTH[seg.type];
}

const round = (n) => Math.round(n * 1000) / 1000;

/** End credits must stop where a post-credits scene starts, even when the data overlaps (we never skip the scene). */
function trimCreditsBeforeScene(segments) {
    const scene = segments.find((s) => s.type === 'postcredits');
    if (!scene) return segments;
    return segments
        .map((s) => (s.type === 'credits' && scene.start < s.end && scene.end > s.start ? { ...s, end: scene.start } : s))
        .filter(validSegment);
}

/** IntroDB /segments response -> segments. outro = end credits; post_credits = the scene after them. */
function fromIntroDb(json) {
    if (!json || typeof json !== 'object') return [];
    const pick = (raw, type) => {
        if (!raw || typeof raw !== 'object') return null;
        const start = Number.isFinite(raw.start_sec) ? raw.start_sec : (Number.isFinite(raw.start_ms) ? raw.start_ms / 1000 : NaN);
        const end = Number.isFinite(raw.end_sec) ? raw.end_sec : (Number.isFinite(raw.end_ms) ? raw.end_ms / 1000 : NaN);
        return { type, start: round(start), end: round(end), source: 'introdb' };
    };
    const out = [
        pick(json.intro, 'intro'),
        pick(json.recap, 'recap'),
        pick(json.outro, 'credits'),
        pick(json.post_credits, 'postcredits'),
    ].filter(validSegment);
    return trimCreditsBeforeScene(out);
}

/** Chapter title -> segment type, or null. Order matters: "Opening credits" is an intro, "Post-credits" is not credits. */
function chapterType(title) {
    const t = String(title || '').trim();
    if (!t) return null;
    if (/\b(post|mid|after)[\s._-]*credits?\b|\bstinger\b/i.test(t)) return 'postcredits';
    if (/\b(intro(duction)?|opening|op|title sequence|main titles?)\b/i.test(t)) return 'intro';
    if (/\b(recap|previously)\b/i.test(t)) return 'recap';
    if (/\b(credits?|ending|end titles?|outro|ed|closing)\b/i.test(t)) return 'credits';
    return null;
}

/** ffprobe -show_chapters JSON -> segments. Back-to-back chapters of one type (Credits 1, Credits 2) become one segment. */
function fromChapters(chapters) {
    if (!Array.isArray(chapters)) return [];
    const out = [];
    for (const ch of chapters) {
        const type = chapterType(ch && ch.tags && (ch.tags.title || ch.tags.TITLE));
        const start = Number(ch && ch.start_time);
        const end = Number(ch && ch.end_time);
        if (!type || !Number.isFinite(start) || !Number.isFinite(end)) continue;
        const prev = out.find((s) => s.type === type);
        if (prev) {
            if (Math.abs(prev.end - start) < 1) prev.end = round(end); // contiguous: extend
            continue; // first one of each type wins
        }
        out.push({ type, start: round(start), end: round(end), source: 'chapters' });
    }
    return trimCreditsBeforeScene(out.filter(validSegment));
}

/** Per type, the first list that has it wins (chapters in the file beat community data, which may be for another cut). */
function mergeSegments(...lists) {
    const out = [];
    for (const type of TYPES) {
        for (const list of lists) {
            const hit = (list || []).find((s) => s.type === type);
            if (hit) {
                out.push(hit);
                break;
            }
        }
    }
    return trimCreditsBeforeScene(out).sort((a, b) => a.start - b.start);
}

/** The library file id behind a server stream URL (/api/downloads/stream/lf_12/video.mp4), or null. */
function libraryFileId(value) {
    const m = /(?:^|\/api\/downloads\/stream\/)lf_(\d{1,12})(?:$|[/?#])/.exec(String(value || ''));
    return m ? Number(m[1]) : null;
}

module.exports = { TYPES, parseVideoId, validSegment, fromIntroDb, chapterType, fromChapters, mergeSegments, trimCreditsBeforeScene, libraryFileId };
