/* global describe, it, expect */
const topResults = require('../src/routes/Search/topResults');

const ready = (items) => ({ content: { type: 'Ready', content: items } });
const item = (id, name, extra = {}) => ({ id, name, type: 'movie', poster: `https://img/${id}.jpg`, ...extra });

describe('topResults', () => {
    it('puts the exact title first, then prefix matches', () => {
        const out = topResults([ready([item('a', 'Dune: Part Two'), item('b', 'Dune'), item('c', 'Sand Dune Wars')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    });
    it('keeps one card per title across catalogs', () => {
        const out = topResults([ready([item('a', 'Dune')]), ready([item('a', 'Dune'), item('b', 'Dune')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['a', 'b']);
    });
    it('drops items without a poster and items that do not match', () => {
        const out = topResults([ready([item('a', 'Dune', { poster: null }), item('b', 'Heat'), item('c', 'Dune')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['c']);
    });
    it('adds year and type', () => {
        const [first] = topResults([ready([item('a', 'Dune', { releaseInfo: '2021' })])], 'dune');
        expect(first.subtitle).toBe('2021 · Movie');
    });
    it('ignores catalogs that are not ready', () => {
        expect(topResults([{ content: { type: 'Loading' } }, { content: { type: 'Err', content: 'EmptyContent' } }], 'dune')).toEqual([]);
    });

    it('mergeServerResults bumps matched local titles, marks them On your server, and includes unmatched local titles', () => {
        const ranked = topResults([ready([item('tt1160419', 'Dune', { releaseInfo: '2021' }), item('tt0087182', 'Dune (1984)')])], 'dune');
        const serverItems = [
            { id: 7, type: 'movie', title: 'Dune', year: 2021, imdbId: 'tt1160419', poster: 'https://img/dune.jpg' },
            { id: 9, type: 'movie', title: 'Dune Home Cut', year: 2023, imdbId: null, poster: null },
            { id: 10, type: 'series', title: 'Dune: Prophecy', year: 2024, imdbId: 'tt10466872', poster: null },
        ];
        const merged = topResults.mergeServerResults(ranked, serverItems);
        expect(merged.map((m) => m.id)).toEqual(['tt1160419', 'server:9', 'tt10466872', 'tt0087182']);
        expect(merged[0].subtitle).toBe('On your server · 2021 · Movie');
        expect(merged[1].href).toBe('#/server/9');
        expect(merged[1].subtitle).toBe('On your server · 2023 · Movie');
        expect(merged[2].href).toBe('#/detail/series/tt10466872');
    });
});
