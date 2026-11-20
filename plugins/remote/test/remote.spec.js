// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
// Plugin "remote": Jest frontend tests for remote logic, formatting, and slots.
// Run with: pnpm test

const plugin = require('../ui');
const { SLOTS } = require('../../../src/plugins/host');
const {
    formatTime,
    calculateProgress,
    detectDeviceName,
    formatDisplayTitle,
    parsePlayerPath,
    KEY_CODES,
} = require('../ui/logic');

describe('remote plugin', () => {
    it('exports only known slots', () => {
        Object.keys(plugin).forEach((k) => expect(SLOTS).toContain(k));
    });

    describe('formatTime', () => {
        it('formats milliseconds into mm:ss', () => {
            expect(formatTime(0)).toBe('0:00');
            expect(formatTime(5000)).toBe('0:05');
            expect(formatTime(65000)).toBe('1:05');
            expect(formatTime(3600000)).toBe('60:00');
        });

        it('handles null, undefined, and NaN gracefully', () => {
            expect(formatTime(null)).toBe('0:00');
            expect(formatTime(undefined)).toBe('0:00');
            expect(formatTime(NaN)).toBe('0:00');
            expect(formatTime(-100)).toBe('0:00');
        });
    });

    describe('calculateProgress', () => {
        it('calculates progress percentage correctly', () => {
            expect(calculateProgress(30000, 60000)).toBe(50);
            expect(calculateProgress(0, 60000)).toBe(0);
            expect(calculateProgress(60000, 60000)).toBe(100);
            expect(calculateProgress(70000, 60000)).toBe(100);
        });

        it('handles zero or invalid duration', () => {
            expect(calculateProgress(100, 0)).toBe(0);
            expect(calculateProgress(100, null)).toBe(0);
            expect(calculateProgress(100, NaN)).toBe(0);
        });
    });

    describe('detectDeviceName', () => {
        it('detects Mac Mini desktop app when running under macos shell', () => {
            expect(detectDeviceName('Mozilla/5.0 Macintosh', true)).toBe('Mac Mini (Desktop App)');
            expect(detectDeviceName('Mozilla/5.0 Tauri libmpv', false)).toBe('Desktop App');
        });

        it('detects Android phone vs tablet', () => {
            expect(detectDeviceName('Mozilla/5.0 (Linux; Android 14; Mobile; Pixel 8)')).toBe('Android Phone');
            expect(detectDeviceName('Mozilla/5.0 (Linux; Android 14; Tablet)')).toBe('Android Tablet');
        });

        it('detects iOS devices', () => {
            expect(detectDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
            expect(detectDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
        });

        it('detects desktop browsers', () => {
            expect(detectDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0')).toBe('Mac Browser');
            expect(detectDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0')).toBe('Windows PC');
            expect(detectDeviceName('')).toBe('Cinema Screen');
        });
    });

    describe('formatDisplayTitle', () => {
        it('formats series episode with show name and title', () => {
            expect(formatDisplayTitle('Ozymandias', 'Breaking Bad')).toBe('Breaking Bad - Ozymandias');
        });

        it('falls back to single title or show name', () => {
            expect(formatDisplayTitle('Inception', null)).toBe('Inception');
            expect(formatDisplayTitle(null, 'Severance')).toBe('Severance');
            expect(formatDisplayTitle(null, null)).toBe('Playing Media');
        });
    });

    describe('parsePlayerPath', () => {
        it('ensures leading hash on player paths', () => {
            expect(parsePlayerPath('/player/stream123')).toBe('#/player/stream123');
            expect(parsePlayerPath('#/player/stream123')).toBe('#/player/stream123');
        });

        it('extracts deepLinks.player from stream object', () => {
            const obj = { stream: { deepLinks: { player: '#/player/deep123' } } };
            expect(parsePlayerPath(obj)).toBe('#/player/deep123');
        });

        it('returns null for empty or invalid input', () => {
            expect(parsePlayerPath(null)).toBe(null);
            expect(parsePlayerPath({})).toBe(null);
        });
    });

    describe('KEY_CODES', () => {
        it('maps standard navigation and player keys', () => {
            expect(KEY_CODES.ArrowUp).toBe(38);
            expect(KEY_CODES.ArrowDown).toBe(40);
            expect(KEY_CODES.ArrowLeft).toBe(37);
            expect(KEY_CODES.ArrowRight).toBe(39);
            expect(KEY_CODES.Enter).toBe(13);
            expect(KEY_CODES.Escape).toBe(27);
            expect(KEY_CODES.Space).toBe(32);
            expect(KEY_CODES.KeyF).toBe(70);
        });
    });
});
