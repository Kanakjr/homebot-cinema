// Copyright (C) 2017-2026 HomeBot Cinema

const { pickHeroItems, MAX_SLIDES } = require('../src/routes/Board/HeroCarousel/pickHeroItems');

const mk = (n, type = 'movie', extra = {}) => ({ id: `tt${n}`, type, name: `T${n}`, ...extra });
const movies = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, 'movie'));
const shows = [11, 12, 13, 14, 15, 16, 17, 18].map((n) => mk(n, 'series'));

describe('Home hero banner picker', () => {
    it('mixes the catalogs (round-robin) instead of filling the banner from the first one', () => {
        const out = pickHeroItems([movies, shows]);
        expect(out.slice(0, 4).map((i) => i.type)).toEqual(['movie', 'series', 'movie', 'series']);
        expect(out.length).toBe(MAX_SLIDES);
    });

    it('limits how much one catalog can supply when several are available', () => {
        const out = pickHeroItems([movies, shows, [21, 22, 23, 24, 25].map((n) => mk(n)), [31, 32, 33, 34, 35].map((n) => mk(n, 'series'))]);
        expect(out.length).toBe(MAX_SLIDES);
        const perCatalog = [movies, shows].map((l) => out.filter((i) => l.some((x) => x.id === i.id)).length);
        expect(Math.max(...perCatalog)).toBeLessThanOrEqual(2);
    });

    it('skips watched titles, titles in Continue watching, and duplicates across catalogs', () => {
        const watched = mk(2, 'movie', { watched: true });
        const out = pickHeroItems([[movies[0], watched, movies[2]], [movies[0], movies[2], shows[0]]], { exclude: new Set(['tt3']) });
        expect(out.map((i) => i.id)).toEqual(['tt1', 'tt11']);
    });

    it('only uses movies and series that have an IMDb id (backdrops are looked up by it)', () => {
        const odd = [{ id: 'kitsu:1', type: 'series' }, { id: 'tt9', type: 'tv' }, { id: 'tt10', type: 'channel' }, null, undefined, mk(5)];
        expect(pickHeroItems([odd]).map((i) => i.id)).toEqual(['tt5']);
    });

    it('copes with nothing to show', () => {
        expect(pickHeroItems([])).toEqual([]);
        expect(pickHeroItems(undefined)).toEqual([]);
        expect(pickHeroItems([[], null])).toEqual([]);
    });

    it('fills the banner from a single catalog when that is all there is, and respects maxSlides', () => {
        expect(pickHeroItems([movies]).length).toBe(MAX_SLIDES);
        expect(pickHeroItems([movies, shows], { maxSlides: 5 }).length).toBe(5);
    });
});
