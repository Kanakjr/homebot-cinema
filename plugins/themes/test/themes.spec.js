// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const themes = require('../ui');
const { SLOTS } = require('../../../src/plugins/host');
const { ACCENTS } = require('../../../src/common/theme');

describe('themes plugin', () => {
    it('exports only known slots', () => {
        Object.keys(themes).forEach((k) => expect(SLOTS).toContain(k));
    });
    it('adds valid accents that do not clash with the core palette', () => {
        const keys = themes.accents.map((a) => a.key);
        expect(new Set(keys).size).toBe(keys.length);
        themes.accents.forEach((a) => {
            expect(a.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(ACCENTS[a.key]).toBeUndefined();
        });
    });
    it('contributes the Appearance settings section', () => {
        expect(themes.settingsSections.map((s) => s.id)).toEqual(['appearance']);
    });
});
