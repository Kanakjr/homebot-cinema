// Copyright (C) 2017-2026 HomeBot Cinema

const { INTERFACE_SCALES, DEFAULT_INTERFACE_SCALE, nearestInterfaceScale } = require('../src/common/interfaceScaleOptions');
const CONSTANTS = require('../src/common/CONSTANTS');

describe('interface zoom choices', () => {
    it('defaults to 90% and offers it as a choice', () => {
        expect(DEFAULT_INTERFACE_SCALE).toBe(90);
        expect(INTERFACE_SCALES).toContain(90);
        expect(CONSTANTS.INTERFACE_SCALES).toBe(INTERFACE_SCALES);
        expect(CONSTANTS.DEFAULT_INTERFACE_SCALE).toBe(90);
    });

    it('offers more choices than the original five, in ascending order, around 100%', () => {
        expect(INTERFACE_SCALES.length).toBeGreaterThan(5);
        expect([...INTERFACE_SCALES].sort((a, b) => a - b)).toEqual(INTERFACE_SCALES);
        expect(INTERFACE_SCALES).toEqual(expect.arrayContaining([80, 90, 100, 110]));
    });

    it('keeps every listed value and maps anything else to the closest choice (undefined -> default)', () => {
        INTERFACE_SCALES.forEach((scale) => expect(nearestInterfaceScale(scale)).toBe(scale));
        expect(nearestInterfaceScale(undefined)).toBe(90);
        expect(nearestInterfaceScale(null)).toBe(90);
        expect(nearestInterfaceScale(NaN)).toBe(90);
        expect(nearestInterfaceScale('100')).toBe(90);
        expect(nearestInterfaceScale(75)).toBe(70); // an old choice
        expect(nearestInterfaceScale(88)).toBe(90);
        expect(nearestInterfaceScale(400)).toBe(175);
        expect(nearestInterfaceScale(1)).toBe(70);
    });
});
