// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const S = require('../ui/statsLogic');

describe('watch stats helpers', () => {
    it('formats watch time', () => {
        expect(S.hours(45 * 60000)).toBe('45 min');
        expect(S.hours(90 * 60000)).toBe('1.5 h');
        expect(S.hours(150 * 3600000)).toBe('150 h');
        expect(S.hours(null)).toBe('0 min');
    });

    it('rounds the axis up to 1, 2 or 5 x 10^n', () => {
        expect(S.niceMax(0)).toBe(1);
        expect(S.niceMax(0.3)).toBe(0.5);
        expect(S.niceMax(3.2)).toBe(5);
        expect(S.niceMax(12)).toBe(20);
    });

    it('lays out daily bars on a zero baseline with a gap between them', () => {
        const { max, bars } = S.dailyBars([{ day: '2026-11-16', watchedMs: 3600000, plays: 1 }, { day: '2026-11-17', watchedMs: 0, plays: 0 }], 200, 100);
        expect(max).toBe(1);
        expect(bars[0]).toMatchObject({ x: 1, w: 98, h: 100, y: 0 });
        expect(bars[1].h).toBe(0);
    });

    it('builds the heat grid Monday first with 0-4 levels', () => {
        const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
        grid[0][21] = 4 * 3600000; // Sunday 21:00
        grid[1][8] = 3600000; // Monday 08:00
        const rows = S.heatRows(grid);
        expect(rows[0].label).toBe('Mon');
        expect(rows[0].cells[8].level).toBe(1);
        expect(rows[6].label).toBe('Sun');
        expect(rows[6].cells[21].level).toBe(4);
        expect(rows[3].cells[0].level).toBe(0);
    });

    it('shares and labels', () => {
        expect(S.share([{ watchedMs: 3 }, { watchedMs: 1 }]).map((x) => x.pct)).toEqual([75, 25]);
        expect(S.episodeTag({ season: 2, episode: 5 })).toBe('S2 E5');
        expect(S.episodeTag({ season: null, episode: null })).toBe(null);
    });
});
