// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const L = require('../ui/logic');
const { SLOTS } = require('../../../src/plugins/host');

const MIN = 60 * 1000;

describe('skip plugin: timing logic', () => {
    it('converts seconds to milliseconds once and fits segments to the file', () => {
        const duration = 22 * MIN;
        const out = L.toPlayerSegments([
            { type: 'credits', start: 1300, end: 1400, source: 'introdb' }, // runs past the end: clamped
            { type: 'intro', start: 0, end: 31.5, source: 'introdb' },
            { type: 'recap', start: 1400, end: 1450, source: 'introdb' }, // starts after the end (another cut): dropped
        ], duration);
        expect(out).toEqual([
            { type: 'intro', source: 'introdb', start: 0, end: 31500 },
            { type: 'credits', source: 'introdb', start: 1300000, end: duration },
        ]);
        expect(L.toPlayerSegments(null, duration)).toEqual([]);
        // duration not known yet: keep as is
        expect(L.toPlayerSegments([{ type: 'intro', start: 5, end: 30 }], null)).toEqual([{ type: 'intro', source: undefined, start: 5000, end: 30000 }]);
    });

    it('finds the segment playing now, never a post-credits scene, and hides it in its last second', () => {
        const segs = [{ type: 'intro', start: 10000, end: 40000 }, { type: 'postcredits', start: 50000, end: 60000 }];
        expect(L.activeSegment(segs, 9999)).toBe(null);
        expect(L.activeSegment(segs, 10000)).toBe(segs[0]);
        expect(L.activeSegment(segs, 39500)).toBe(null);
        expect(L.activeSegment(segs, 55000)).toBe(null);
        expect(L.activeSegment(segs, null)).toBe(null);
    });

    it('auto-skips only when the profile asked, right after the segment starts, and once', () => {
        const intro = { type: 'intro', start: 10000, end: 40000 };
        const on = { ...L.DEFAULT_PREFS, autoIntro: true };
        const handled = new Set();
        expect(L.shouldAutoSkip(intro, 10500, L.DEFAULT_PREFS, handled)).toBe(false);
        expect(L.shouldAutoSkip(intro, 10500, on, handled)).toBe(true);
        expect(L.shouldAutoSkip(intro, 10000 + L.AUTO_SKIP_WINDOW + 1, on, handled)).toBe(false); // seeked into the middle
        handled.add(L.segmentKey(intro)); // skipped or undone
        expect(L.shouldAutoSkip(intro, 10500, on, handled)).toBe(false);
        expect(L.shouldAutoSkip({ type: 'credits', start: 0, end: 60000 }, 100, { autoIntro: true, autoRecap: true }, new Set())).toBe(false);
        expect(L.shouldAutoSkip({ type: 'recap', start: 0, end: 60000 }, 100, { ...on, autoRecap: true }, new Set())).toBe(true);
    });

    it('labels and targets: intro, credits to the next episode, credits to a post-credits scene', () => {
        const duration = 40 * MIN;
        const intro = { type: 'intro', start: 0, end: 30000 };
        expect(L.skipAction(intro, [intro], duration, true)).toEqual({ label: 'Skip intro', kind: 'seek', to: 30000 });

        const toEnd = { type: 'credits', start: duration - 60000, end: duration };
        expect(L.skipAction(toEnd, [toEnd], duration, true)).toEqual({ label: 'Next episode', kind: 'next' });
        expect(L.skipAction(toEnd, [toEnd], duration, false)).toEqual({ label: 'Skip credits', kind: 'seek', to: duration - 500 });

        const mid = { type: 'credits', start: duration - 300000, end: duration - 120000 };
        const scene = { type: 'postcredits', start: duration - 120000, end: duration - 60000 };
        expect(L.skipAction(mid, [mid, scene], duration, false)).toEqual({ label: 'Skip to the post-credits scene', kind: 'seek', to: scene.start });
    });

    it('reports the credits start for Up Next only when it is plausible', () => {
        const duration = 45 * MIN;
        expect(L.creditsStart([{ type: 'credits', start: duration - 90000, end: duration }], duration)).toBe(duration - 90000);
        expect(L.creditsStart([{ type: 'credits', start: 5 * MIN, end: 6 * MIN }], duration)).toBe(null); // mid-episode: bad data
        expect(L.creditsStart([{ type: 'credits', start: duration - 15 * MIN, end: duration }], duration)).toBe(null); // too early
        expect(L.creditsStart([{ type: 'credits', start: 9 * MIN, end: 10 * MIN }], 11 * MIN)).toBe(9 * MIN);
        expect(L.creditsStart([{ type: 'credits', start: 2 * MIN, end: 3 * MIN }], 11 * MIN)).toBe(null); // first half
        expect(L.creditsStart([], duration)).toBe(null);
        expect(L.creditsStart([{ type: 'credits', start: 1, end: 2 }], null)).toBe(null);
    });

    it('reads per-profile prefs with defaults', () => {
        expect(L.readPrefs(null)).toEqual(L.DEFAULT_PREFS);
        expect(L.readPrefs({ settings: { skip: { autoIntro: true, upNextAtCredits: false, junk: 1 } } }))
            .toEqual({ autoIntro: true, autoRecap: false, upNextAtCredits: false });
        expect(L.readPrefs({ settings: { skip: 'nope' } })).toEqual(L.DEFAULT_PREFS);
    });

    it('only asks the server about IMDb ids and library files', () => {
        expect(L.lookupVideoId('tt0944947:1:2')).toBe('tt0944947:1:2');
        expect(L.lookupVideoId('tt0816692')).toBe('tt0816692');
        expect(L.lookupVideoId('kitsu:42:1')).toBe(null);
        expect(L.libraryFileParam('https://h.example.com/api/downloads/stream/lf_12/video.mp4')).toBe('lf_12');
        expect(L.libraryFileParam('https://h.example.com/api/downloads/stream/abc123/video.mp4')).toBe(null);
        expect(L.libraryFileParam(null)).toBe(null);
    });

    it('contributes to known slots only', () => {
        expect(SLOTS).toContain('playerOverlays');
    });
});
