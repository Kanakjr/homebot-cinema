// Copyright (C) 2017-2026 HomeBot Cinema

const { RATINGS, VOTES, YEARS, RUNTIMES, SORTS, PRESET_GROUPS, PRESETS } = require('../src/routes/Find/presets');

// TMDB's genre names, as listed by /api/find/options for each type
const GENRES = {
    movie: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'TV Movie', 'Thriller', 'War', 'Western'],
    series: ['Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Kids', 'Mystery', 'News', 'Reality', 'Sci-Fi & Fantasy', 'Soap', 'Talk', 'War & Politics', 'Western'],
};

describe('Smart filters quick picks', () => {
    it('has many picks, in named groups, with unique labels and dropdown indexes', () => {
        expect(PRESET_GROUPS.length).toBeGreaterThanOrEqual(5);
        expect(PRESETS.length).toBeGreaterThanOrEqual(25);
        expect(new Set(PRESETS.map((p) => p.label)).size).toBe(PRESETS.length);
        PRESETS.forEach((p, i) => expect(p.index).toBe(i));
        PRESET_GROUPS.forEach((g) => expect(g.items.length).toBeGreaterThan(0));
    });

    it('only uses values the filter UI can show, so a pick survives being saved and reloaded', () => {
        PRESETS.forEach(({ label, f }) => {
            expect([label, ['movie', 'series']]).toEqual([label, expect.arrayContaining([f.type])]);
            if (f.minRating !== undefined) expect([label, RATINGS.includes(f.minRating)]).toEqual([label, true]);
            if (f.minVotes !== undefined) expect([label, VOTES.includes(f.minVotes)]).toEqual([label, true]);
            if (f.yearFrom !== undefined) expect([label, YEARS.includes(f.yearFrom)]).toEqual([label, true]);
            if (f.maxRuntime !== undefined) expect([label, RUNTIMES.includes(f.maxRuntime)]).toEqual([label, true]);
            if (f.sort !== undefined) expect([label, SORTS.some(([k]) => k === f.sort)]).toEqual([label, true]);
            if (f.lang !== undefined) expect(f.lang).toMatch(/^[a-z]{2,3}$/);
        });
    });

    it('only asks for genres that exist for that type (a wrong name is a server error)', () => {
        PRESETS.forEach(({ label, f }) => (f.genres || []).forEach((g) => expect([label, GENRES[f.type].includes(g)]).toEqual([label, true])));
    });

    it('every pick narrows the search (no pick returns everything)', () => {
        PRESETS.forEach(({ label, f }) => {
            const narrowed = f.minRating || f.minVotes || (f.genres || []).length || f.lang || f.maxRuntime || f.yearFrom || (f.services || []).length || f.sort === 'popularity';
            expect([label, Boolean(narrowed)]).toEqual([label, true]);
        });
    });
});
