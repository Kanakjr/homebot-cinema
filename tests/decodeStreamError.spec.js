// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */

const zlib = require('zlib');
const { extractEncodedStream, decodeStreamUrlSync, decodeStreamUrl } = require('../src/routes/Player/Error/decodeStreamUrl');

describe('Error decodeStreamUrl', () => {
    it('extracts encoded payload from player hash routes', () => {
        expect(extractEncodedStream('#/player/abc123/https%3A%2F%2Ffoo')).toBe('abc123');
        expect(extractEncodedStream('#/board')).toBe(null);
    });

    it('decodes uncompressed base64 and base64url JSON hashes synchronously and asynchronously', async () => {
        const b64 = Buffer.from(JSON.stringify({ url: 'https://cdn.example/video.mp4' })).toString('base64');
        const urlSafe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        expect(decodeStreamUrlSync(`#/player/${b64}`)).toBe('https://cdn.example/video.mp4');
        expect(decodeStreamUrlSync(`#/player/${urlSafe}`)).toBe('https://cdn.example/video.mp4');
        await expect(decodeStreamUrl(`#/player/${encodeURIComponent(b64)}`)).resolves.toBe('https://cdn.example/video.mp4');
    });

    it('decodes zlib-compressed (eAEB/eJx...) base64 stream hashes asynchronously', async () => {
        const deflated = zlib.deflateSync(Buffer.from(JSON.stringify({ url: 'http://127.0.0.1:11470/stream.mp4' })));
        const encoded = encodeURIComponent(deflated.toString('base64'));
        expect(decodeStreamUrlSync(`#/player/${encoded}`)).toBe(null);
        await expect(decodeStreamUrl(`#/player/${encoded}`)).resolves.toBe('http://127.0.0.1:11470/stream.mp4');
    });

    it('returns null gracefully on invalid or URL-less hashes', async () => {
        expect(decodeStreamUrlSync('#/player/not_valid_base64!!!')).toBe(null);
        await expect(decodeStreamUrl('#/player/not_valid_base64!!!')).resolves.toBe(null);
        const noUrl = Buffer.from(JSON.stringify({ infoHash: 'abc' })).toString('base64');
        await expect(decodeStreamUrl(`#/player/${noUrl}`)).resolves.toBe(null);
    });
});
