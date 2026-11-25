// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */

const L = require('../ui/logic');
const { isPrivatePlayback } = require('../../../src/common/privatePlayback');
const host = require('../../../src/plugins/host');
const vault = require('../ui');

describe('vault ui logic', () => {
    it('breadcrumbs for a nested folder', () => {
        expect(L.crumbs('Trips/2024')).toEqual([
            { name: 'Locked folder', path: '' }, { name: 'Trips', path: 'Trips' }, { name: '2024', path: 'Trips/2024' },
        ]);
        expect(L.crumbs('')).toEqual([{ name: 'Locked folder', path: '' }]);
    });
    it('durations', () => {
        expect(L.duration(75000)).toBe('1:15');
        expect(L.duration(3725000)).toBe('1:02:05');
        expect(L.duration(null)).toBe('');
    });
    it('reads the file id and grant from a Locked folder stream URL only', () => {
        expect(L.parseVaultStream('https://x.example/api/vault/stream/12?g=abc.1.sig&cinema_private=1')).toEqual({ id: 12, g: 'abc.1.sig' });
        expect(L.parseVaultStream('/api/vault/stream/12')).toBeNull();
        expect(L.parseVaultStream('https://x.example/api/downloads/stream/lf_3/video.mp4')).toBeNull();
        expect(L.parseVaultStream(undefined)).toBeNull();
    });
    it('resumes only from a real position', () => {
        expect(L.shouldResume(61000, 120000)).toBe(true);
        expect(L.shouldResume(10000, 120000)).toBe(false);
        expect(L.shouldResume(118000, 120000)).toBe(false);
        expect(L.shouldResume(null, 120000)).toBe(false);
    });
    it('number pad input', () => {
        expect(L.padInput('12', '3')).toBe('123');
        expect(L.padInput('123', 'back')).toBe('12');
        expect(L.padInput('123', 'clear')).toBe('');
        expect(L.padInput('1', 'x')).toBe('1');
    });
    it('passcode messages', () => {
        expect(L.passcodeError({ message: 'bad_passcode', data: { remaining: 1 } })).toMatch(/1 try left/);
        expect(L.passcodeError({ message: 'locked', data: { retryAfterSec: 900 } })).toMatch(/15 min/);
    });
    it('plays non-web formats only in the Mac app', () => {
        expect(L.canPlayHere({ webPlayable: false, desktop: false })).toBe(false);
        expect(L.canPlayHere({ webPlayable: false, desktop: true })).toBe(true);
        expect(L.canPlayHere({ webPlayable: true, desktop: false })).toBe(true);
    });
});

describe('private playback', () => {
    it('is flagged by cinema_private=1 in the stream URL', () => {
        expect(isPrivatePlayback({ streamUrl: 'https://x.example/api/vault/stream/1?g=a&cinema_private=1' })).toBe(true);
        expect(isPrivatePlayback({ stream: { url: '/api/vault/stream/1?cinema_private=1' } })).toBe(true);
        expect(isPrivatePlayback({ streamUrl: 'https://x.example/api/downloads/stream/lf_1/video.mp4' })).toBe(false);
        expect(isPrivatePlayback({})).toBe(false);
    });
});

describe('vault slots', () => {
    it('exports only known slots, including the Server library tile', () => {
        for (const key of Object.keys(vault)) expect(host.SLOTS).toContain(key);
        expect(host.slot('serverLibraryTiles', { vault }, ['vault']).map((t) => t.id)).toEqual(['vault']);
        expect(host.slot('routes', { vault }, ['vault']).map((r) => r.path)).toEqual(['/vault']);
    });
});
