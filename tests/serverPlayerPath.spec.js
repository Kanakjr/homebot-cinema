// Copyright (C) 2017-2026 HomeBot Cinema

const { serverPlayerPath } = require('../src/common/serverApi');

const T = encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json');

describe('serverPlayerPath', () => {
    it('gives an episode the full player route so the core tracks progress', () => {
        expect(serverPlayerPath('abc', { type: 'series', imdbId: 'tt14688458', season: 2, episode: 3 }))
            .toBe(`/player/abc/${T}/${T}/series/tt14688458/${encodeURIComponent('tt14688458:2:3')}`);
    });
    it('uses the IMDb id as the video id for a movie', () => {
        expect(serverPlayerPath('abc', { type: 'movie', imdbId: 'tt0111161', season: null, episode: null }))
            .toBe(`/player/abc/${T}/${T}/movie/tt0111161/tt0111161`);
    });
    it('keeps season 0 (specials)', () => {
        expect(serverPlayerPath('abc', { type: 'series', imdbId: 'tt1', season: 0, episode: 5 })).toContain(encodeURIComponent('tt1:0:5'));
    });
    it('falls back to the bare route when there is nothing to track against', () => {
        expect(serverPlayerPath('a/b', null)).toBe('/player/a%2Fb');
        expect(serverPlayerPath('abc', { type: 'series', imdbId: null, season: 1, episode: 1 })).toBe('/player/abc');
        expect(serverPlayerPath('abc', { type: 'series', imdbId: 'tt1', season: 1, episode: null })).toBe('/player/abc');
        expect(serverPlayerPath('abc', { type: 'other', imdbId: 'tt1' })).toBe('/player/abc');
        expect(serverPlayerPath('abc', { type: 'movie', imdbId: 'kitsu:1' })).toBe('/player/abc');
    });
});
