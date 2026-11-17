// Copyright (C) 2017-2026 HomeBot Cinema

const { contrastRatio, accentForeground, accentThumb, ACCENTS } = require('../src/common/theme');
const pluginAccents = require('../plugins/themes/ui/accents');

const all = [...Object.values(ACCENTS), ...pluginAccents].map((a) => a.color);

describe('accent contrast tokens', () => {
    it('computes WCAG contrast ratios', () => {
        expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
        expect(contrastRatio('#F27A24', '#FFFFFF')).toBeCloseTo(2.77, 2); // white text on amber fails 4.5:1
        expect(contrastRatio('#F27A24', '#000000')).toBeCloseTo(7.58, 2);
        expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    });

    it('puts dark text on light accents and white text on dark ones', () => {
        expect(accentForeground('#F27A24')).toBe('#000000'); // amber
        expect(accentForeground('#F4F4F5')).toBe('#000000'); // white
        expect(accentForeground('#9B30D0')).toBe('#FFFFFF'); // violet
    });

    it('keeps text on every shipped accent at 4.5:1 or better', () => {
        expect(all.length).toBeGreaterThan(5);
        all.forEach((color) => {
            expect(contrastRatio(color, accentForeground(color))).toBeGreaterThanOrEqual(4.5);
        });
    });

    it('keeps the toggle thumb white unless the accent is nearly white', () => {
        expect(accentThumb('#F27A24')).toBe('#FFFFFF');
        expect(accentThumb('#A1A1AA')).toBe('#FFFFFF'); // graphite
        expect(accentThumb('#F4F4F5')).toBe('#000000'); // white
    });
});
