'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPlayResolver, registerPlayRoutes, timeLeft } = require('../play_resolve');

test('timeLeft formatting', () => {
    assert.equal(timeLeft(0), null);
    assert.equal(timeLeft(-1000), null);
    assert.equal(timeLeft(20000), 'Almost done');
    assert.equal(timeLeft(38 * 60 * 1000), '38 min left');
    assert.equal(timeLeft(60 * 60 * 1000), '1h left');
    assert.equal(timeLeft(65 * 60 * 1000), '1h 5m left');
});

test('resolve local movie', async () => {
    const fakeLibrary = {
        getByImdb: (imdbId) => {
            if (imdbId === 'tt0111161') {
                return {
                    id: 1,
                    type: 'movie',
                    title: 'The Shawshank Redemption',
                    files: [{ id: 10, streamId: 'lf_10', name: 'Shawshank.mkv' }],
                };
            }
            return null;
        },
    };
    const resolver = createPlayResolver({ library: fakeLibrary });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt0111161', type: 'movie' });
    assert.equal(res.action, 'play');
    assert.equal(res.source, 'local');
    assert.equal(res.streamId, 'lf_10');
    assert.equal(res.label, 'Play');
    assert.equal(res.url, '/api/downloads/stream/lf_10?direct=1');
});

test('resolve movie in-progress with resume label', async () => {
    const fakeUpnext = {
        continueFor: async () => [{
            id: 'tt0111161',
            mode: 'resume',
            remainingMs: 38 * 60 * 1000,
        }],
    };
    const resolver = createPlayResolver({ upnext: fakeUpnext });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt0111161', type: 'movie' });
    assert.equal(res.mode, 'resume');
    assert.equal(res.label, 'Resume · 38 min left');
});

test('resolve series in-progress finds episode and local file', async () => {
    const fakeUpnext = {
        continueFor: async () => [{
            id: 'tt14452060',
            mode: 'resume',
            videoId: 'tt14452060:2:1',
            season: 2,
            episode: 1,
            remainingMs: 38 * 60 * 1000,
        }],
    };
    const fakeLibrary = {
        getByImdb: () => ({
            id: 2,
            type: 'series',
            title: 'Silo',
            seasons: [{
                season: 2,
                episodes: [{
                    episode: 1,
                    files: [{ id: 21, streamId: 'lf_21', name: 'Silo.S02E01.mkv' }],
                }],
            }],
        }),
    };
    const resolver = createPlayResolver({ library: fakeLibrary, upnext: fakeUpnext });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt14452060', type: 'series' });
    assert.equal(res.action, 'play');
    assert.equal(res.source, 'local');
    assert.equal(res.season, 2);
    assert.equal(res.episode, 1);
    assert.equal(res.label, 'Resume S2E1 · 38 min left');
    assert.equal(res.streamId, 'lf_21');
});

test('resolve series next episode', async () => {
    const fakeUpnext = {
        continueFor: async () => [{
            id: 'tt14452060',
            mode: 'next',
            next: { id: 'tt14452060:2:2', season: 2, episode: 2 },
        }],
    };
    const resolver = createPlayResolver({ upnext: fakeUpnext });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt14452060', type: 'series' });
    assert.equal(res.season, 2);
    assert.equal(res.episode, 2);
    assert.equal(res.label, 'Play S2E2');
    assert.equal(res.action, 'browse'); // no local file, no stream addon
    assert.equal(res.source, 'none');
});

test('resolve series default to S1E1 when unwatched', async () => {
    const fakeUpnext = {
        continueFor: async () => [],
    };
    const resolver = createPlayResolver({ upnext: fakeUpnext });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt14452060', type: 'series' });
    assert.equal(res.season, 1);
    assert.equal(res.episode, 1);
    assert.equal(res.label, 'Play S1E1');
});

test('resolve with stream addon picks best stream', async () => {
    const streams = [
        { name: '1080p Stream', title: 'Movie 1080p BluRay x264 4GB', url: 'http://cdn/1080p.mp4' },
        { name: '4K Stream', title: 'Movie 2160p Remux 30GB', url: 'http://cdn/4k.mp4' },
    ];
    const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ streams }),
    });
    const fakeGrabber = {
        resolve: () => ({
            name: 'Default',
            config: {
                qualities: ['1080p', '4K'],
                sizes: { '1080p': { movie: { minGB: 1, maxGB: 10 } } },
                bannedKeywords: [],
                requiredKeywords: [],
                preferredKeywords: [],
                minSeeders: 0,
                hdr: 'any',
                codec: 'any',
                sizeBias: 'none',
            },
        }),
    };
    const resolver = createPlayResolver({
        streamAddonUrl: 'http://addon.test',
        fetchImpl,
        grabberStore: fakeGrabber,
    });
    const res = await resolver.resolve({ profileId: 'p1', id: 'tt0111161', type: 'movie' });
    assert.equal(res.action, 'play');
    assert.equal(res.source, 'stream');
    assert.ok(res.stream);
});

test('registerPlayRoutes handles HTTP requests and validation', async () => {
    const app = express();
    const fakeResolver = {
        resolve: async ({ id, type }) => ({
            id,
            type,
            action: 'play',
            source: 'local',
            label: 'Play',
        }),
    };
    const requireProfile = (req, _res, next) => {
        req.profile = { id: 'prof-1' };
        next();
    };
    registerPlayRoutes(app, { resolver: fakeResolver, requireProfile });

    const server = app.listen(0);
    const { port } = server.address();
    try {
        // missing type
        const badRes = await fetch(`http://127.0.0.1:${port}/api/play/resolve?id=tt123`);
        assert.equal(badRes.status, 400);

        // invalid non-integer season/episode -> 400 (never SNaNENaN)
        const badSeason = await fetch(`http://127.0.0.1:${port}/api/play/resolve?id=tt1254207&type=series&season=abc&episode=def`);
        assert.equal(badSeason.status, 400);
        const negEp = await fetch(`http://127.0.0.1:${port}/api/play/resolve?id=tt1254207&type=series&season=1&episode=-1`);
        assert.equal(negEp.status, 400);

        // valid request
        const okRes = await fetch(`http://127.0.0.1:${port}/api/play/resolve?id=tt123&type=movie`);
        assert.equal(okRes.status, 200);
        const data = await okRes.json();
        assert.equal(data.label, 'Play');
        assert.equal(data.action, 'play');
    } finally {
        server.close();
    }
});
