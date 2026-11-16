// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const { timeLeft, airLabel } = require('../src/common/whenLabels');

describe('home screen time labels', () => {
    it('time left', () => {
        expect(timeLeft(23 * 60000)).toBe('23m left');
        expect(timeLeft(65 * 60000)).toBe('1h 5m left');
        expect(timeLeft(120 * 60000)).toBe('2h left');
        expect(timeLeft(20000)).toBe('Almost done');
        expect(timeLeft(0)).toBe(null);
        expect(timeLeft(null)).toBe(null);
    });

    it('air dates relative to today', () => {
        const now = new Date(2026, 10, 17, 12, 0).getTime(); // local time
        const at = (days, hour = 20) => new Date(2026, 10, 17 + days, hour, 0).toISOString();
        expect(airLabel(at(0, 2), now)).toBe('Today');
        expect(airLabel(at(1), now)).toBe('Tomorrow');
        expect(airLabel(at(-1), now)).toBe('Yesterday');
        expect(airLabel(at(3), now)).toBe(new Date(2026, 10, 20).toLocaleDateString(undefined, { weekday: 'long' }));
        expect(airLabel(at(10), now)).toBe(new Date(2026, 10, 27).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
        expect(airLabel('nope', now)).toBe(null);
    });
});
