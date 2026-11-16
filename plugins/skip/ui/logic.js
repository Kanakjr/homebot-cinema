// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "skip": pure timing logic (no React, tested by test/skip.spec.js).
// The server speaks SECONDS; the player (stremio-video) speaks MILLISECONDS. toPlayerSegments is the only conversion.

const AUTO_SKIP_WINDOW = 3000; // auto-skip only right after a segment starts, never when someone seeks into the middle of it
const END_SLACK = 1000; // hide the button in the last second of a segment
const AT_END = 2000; // credits that run to within 2 s of the end count as "the end"
const CREDITS_MAX_FROM_END = 10 * 60 * 1000; // Up Next at credits start only when they start in the last 10 minutes...
const CREDITS_MIN_FRACTION = 0.5; // ...and in the second half (bad community data must not open it mid-episode)

const DEFAULT_PREFS = { autoIntro: false, autoRecap: false, upNextAtCredits: true };

/** Profile settings (window.ssoProfile.settings.skip) -> complete prefs. */
function readPrefs(profile) {
    const raw = profile && profile.settings && typeof profile.settings.skip === 'object' && profile.settings.skip ? profile.settings.skip : {};
    return {
        autoIntro: typeof raw.autoIntro === 'boolean' ? raw.autoIntro : DEFAULT_PREFS.autoIntro,
        autoRecap: typeof raw.autoRecap === 'boolean' ? raw.autoRecap : DEFAULT_PREFS.autoRecap,
        upNextAtCredits: typeof raw.upNextAtCredits === 'boolean' ? raw.upNextAtCredits : DEFAULT_PREFS.upNextAtCredits,
    };
}

/**
 * Server segments (seconds) -> player segments (ms), fitted to this file: dropped when they start at or after its end
 * (timestamps from another release), clamped when they run past it.
 */
function toPlayerSegments(segments, durationMs) {
    if (!Array.isArray(segments)) return [];
    const known = Number.isFinite(durationMs) && durationMs > 0;
    return segments
        .map((s) => ({ type: s.type, source: s.source, start: Math.round(Number(s.start) * 1000), end: Math.round(Number(s.end) * 1000) }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start)
        .filter((s) => !known || s.start < durationMs - AT_END)
        .map((s) => (known && s.end > durationMs ? { ...s, end: durationMs } : s))
        .sort((a, b) => a.start - b.start);
}

const segmentKey = (s) => `${s.type}@${s.start}`;

/** The skippable segment playing at timeMs (post-credits scenes are never skipped), or null. */
function activeSegment(segments, timeMs) {
    if (!Number.isFinite(timeMs)) return null;
    return segments.find((s) => s.type !== 'postcredits' && timeMs >= s.start && timeMs < s.end - END_SLACK) || null;
}

/** Whether to skip `seg` by itself now: the profile asked for this type, playback just entered it, and it was not undone. */
function shouldAutoSkip(seg, timeMs, prefs, handled) {
    if (!seg || !prefs) return false;
    const wanted = (seg.type === 'intro' && prefs.autoIntro) || (seg.type === 'recap' && prefs.autoRecap);
    return !!wanted && !handled.has(segmentKey(seg)) && timeMs >= seg.start && timeMs - seg.start <= AUTO_SKIP_WINDOW;
}

/**
 * What the button does for `seg`: { label, kind: 'seek', to } or { label, kind: 'next' }.
 * Credits that run to the end of an episode go to the next one (seeking to the very end would leave the player).
 */
function skipAction(seg, segments, durationMs, hasNext) {
    if (seg.type === 'intro') return { label: 'Skip intro', kind: 'seek', to: seg.end };
    if (seg.type === 'recap') return { label: 'Skip recap', kind: 'seek', to: seg.end };
    const scene = segments.find((s) => s.type === 'postcredits' && s.start >= seg.end - END_SLACK);
    if (scene) return { label: 'Skip to the post-credits scene', kind: 'seek', to: scene.start };
    const toEnd = Number.isFinite(durationMs) && seg.end >= durationMs - AT_END;
    if (toEnd && hasNext) return { label: 'Next episode', kind: 'next' };
    return { label: 'Skip credits', kind: 'seek', to: toEnd && Number.isFinite(durationMs) ? Math.max(seg.end - 500, seg.start) : seg.end };
}

/** When the end credits start (ms), for the player's Up Next popup; null when unknown or implausible. */
function creditsStart(segments, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    const credits = segments.find((s) => s.type === 'credits');
    if (!credits) return null;
    if (durationMs - credits.start > CREDITS_MAX_FROM_END) return null;
    if (credits.start < durationMs * CREDITS_MIN_FRACTION) return null;
    return credits.start;
}

const MARK_LABELS = { intro: 'Intro', recap: 'Recap', credits: 'Credits', postcredits: 'Post-credits scene' };

/** Player segments -> seek-bar marks ({ start, end, label } in ms). */
function toMarks(segments) {
    return (segments || []).map((s) => ({ start: s.start, end: s.end, label: MARK_LABELS[s.type] || s.type }));
}

/** The library file id behind a server stream (…/api/downloads/stream/lf_12/video.mp4) -> 'lf_12', else null. */
function libraryFileParam(streamUrl) {
    const m = /\/api\/downloads\/stream\/(lf_\d{1,12})(?:$|[/?#])/.exec(String(streamUrl || ''));
    return m ? m[1] : null;
}

/** IMDb video ids IntroDB understands: tt123 (movie) or tt123:1:2 (episode). */
const lookupVideoId = (videoId) => (/^tt\d{1,10}(:\d{1,4}:\d{1,5})?$/.test(String(videoId || '')) ? videoId : null);

module.exports = {
    DEFAULT_PREFS, AUTO_SKIP_WINDOW, readPrefs, toPlayerSegments, segmentKey, activeSegment, shouldAutoSkip, skipAction,
    creditsStart, libraryFileParam, lookupVideoId, toMarks,
};
