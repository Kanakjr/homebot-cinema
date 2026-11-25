// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, test, expect */
const L = require('../ui/logic');

describe('livesubs UI logic', () => {
    test('sourceOf: torrents and library files only', () => {
        expect(L.sourceOf({ infoHash: 'A'.repeat(40), fileIdx: 2 }, null)).toEqual({ infoHash: 'a'.repeat(40), fileIdx: 2 });
        expect(L.sourceOf({ infoHash: 'a'.repeat(40) }, null)).toEqual({ infoHash: 'a'.repeat(40), fileIdx: undefined });
        expect(L.sourceOf({ url: 'https://x/api/downloads/stream/lf_12/video.mp4/?exp=1' }, null)).toEqual({ file: 'lf_12' });
        expect(L.sourceOf(null, '/api/downloads/stream/lf_3')).toEqual({ file: 'lf_3' });
        expect(L.sourceOf({ url: 'https://cdn.example/movie.mp4' }, null)).toBeNull();
        expect(L.sourceOf({ ytId: 'abc' }, null)).toBeNull();
    });

    test('cueAt picks the line on screen', () => {
        const cues = [{ start: 1, end: 3, text: 'a' }, { start: 4, end: 6, text: 'b' }];
        expect(L.cueAt(cues, 2).text).toBe('a');
        expect(L.cueAt(cues, 3.5)).toBeNull();
        expect(L.cueAt(cues, 5.9).text).toBe('b');
        expect(L.cueAt([], 1)).toBeNull();
    });

    test('mergeWindow keeps one copy of each cue, sorted', () => {
        const a = [{ start: 4, end: 5, text: 'b' }];
        const b = [{ start: 1, end: 2, text: 'a' }, { start: 4, end: 5, text: 'b' }];
        expect(L.mergeWindow(a, b).map((c) => c.text)).toEqual(['a', 'b']);
    });

    test('isSeek tells a seek from normal playback and pauses', () => {
        expect(L.isSeek(null, 0, 10, 1000, false)).toBe(false);
        expect(L.isSeek(10, 0, 12, 2000, false)).toBe(false);
        expect(L.isSeek(10, 0, 60, 2000, false)).toBe(true);
        expect(L.isSeek(10, 0, 10, 60000, true)).toBe(false);
        expect(L.isSeek(10, 0, 3, 1000, true)).toBe(true);
    });
});
