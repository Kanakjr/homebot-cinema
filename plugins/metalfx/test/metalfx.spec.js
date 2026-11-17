// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const { analyzeStream, formatPillTitle } = require('../ui/logic');
const ui = require('../ui');
const { SLOTS } = require('../../../src/plugins/host');

describe('metalfx plugin: stream resolution analysis', () => {
    it('detects 1080p streams as upscale candidates', () => {
        const stream1080p = {
            name: 'Torrent [1080p]',
            title: 'Movie.2024.1080p.BluRay.x264',
        };
        const res = analyzeStream(stream1080p);
        expect(res.is1080p).toBe(true);
        expect(res.isNative4K).toBe(false);
        expect(res.canUpscale).toBe(true);
    });

    it('detects 720p streams as upscale candidates', () => {
        const stream720p = {
            name: 'Fast Stream 720p',
            description: '720p HEVC AAC',
        };
        const res = analyzeStream(stream720p);
        expect(res.is720p).toBe(true);
        expect(res.isNative4K).toBe(false);
        expect(res.canUpscale).toBe(true);
    });

    it('detects 4K / 2160p streams and marks them as native 4K (bypasses upscaling)', () => {
        const stream4K = {
            name: 'Torrent 4K Remux',
            title: 'Film.2024.2160p.UHD.HDR',
        };
        const res = analyzeStream(stream4K);
        expect(res.isNative4K).toBe(true);
        expect(res.canUpscale).toBe(false);
    });

    it('handles null, undefined, or empty stream objects safely without throwing', () => {
        expect(analyzeStream(null)).toEqual({
            is1080p: false,
            is720p: false,
            isNative4K: false,
            canUpscale: false,
        });
        expect(analyzeStream({})).toEqual({
            is1080p: true,
            is720p: false,
            isNative4K: false,
            canUpscale: true,
        });
    });

    it('formats correct tooltip labels based on active state and resolution', () => {
        const stream1080p = { is1080p: true, is720p: false, isNative4K: false, canUpscale: true };
        const stream4K = { is1080p: false, is720p: false, isNative4K: true, canUpscale: false };

        expect(formatPillTitle(true, stream1080p)).toContain('ON');
        expect(formatPillTitle(false, stream1080p)).toContain('OFF');
        expect(formatPillTitle(true, stream4K)).toContain('native 4K UHD');
    });
});

describe('metalfx plugin: UI slots registration', () => {
    it('exports playerControls, playerOverlays, and settingsSections slots recognized by host.js', () => {
        expect(SLOTS).toContain('playerControls');
        expect(SLOTS).toContain('playerOverlays');
        expect(SLOTS).toContain('settingsSections');

        expect(Array.isArray(ui.playerControls)).toBe(true);
        expect(ui.playerControls[0].id).toBe('metalfx-btn');
        expect(ui.playerControls[0].Component).toBeDefined();

        expect(Array.isArray(ui.playerOverlays)).toBe(true);
        expect(ui.playerOverlays[0].id).toBe('metalfx-stats');
        expect(ui.playerOverlays[0].Component).toBeDefined();

        expect(Array.isArray(ui.settingsSections)).toBe(true);
        expect(ui.settingsSections[0].id).toBe('metalfx');
        expect(ui.settingsSections[0].label).toBe('MetalFX 4K Upscaler');
        expect(ui.settingsSections[0].Component).toBeDefined();
    });
});
