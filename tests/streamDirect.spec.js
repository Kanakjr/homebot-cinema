// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */

const { parseStream, isDirectStream } = require('../src/routes/MetaDetails/StreamsList/streamParser');

describe('Direct streams (the "Direct" filter in the stream list)', () => {
    it('counts a plain http(s) link as direct', () => {
        expect(isDirectStream({ name: 'Addon 4K', url: 'https://cdn.example.com/video.mkv' })).toBe(true);
        expect(isDirectStream({ url: 'http://192.168.1.5:8080/v.mp4' })).toBe(true);
    });

    it('never counts torrents: info hash or magnet link', () => {
        expect(isDirectStream({ infoHash: 'abc123', fileIdx: 0 })).toBe(false);
        expect(isDirectStream({ infoHash: 'abc123', url: 'https://x.example/v.mkv' })).toBe(false);
        expect(isDirectStream({ url: 'magnet:?xt=urn:btih:abc123' })).toBe(false);
    });

    it('ignores links to a web page ("watch on ...", donation notes) even when the player links offer a download link', () => {
        expect(isDirectStream({ name: 'support the project', externalUrl: 'https://example.com/donate' })).toBe(false);
        expect(isDirectStream({ name: 'Rent, Buy', externalUrl: 'https://store.example.com/x', deepLinks: { externalPlayer: { download: 'https://store.example.com/x' } } })).toBe(false);
        expect(isDirectStream({ url: 'ftp://example.com/v.mkv' })).toBe(false);
        expect(isDirectStream({})).toBe(false);
        expect(isDirectStream(null)).toBe(false);
        expect(isDirectStream(undefined)).toBe(false);
    });

    it('is reported by parseStream next to the quality details, without changing them', () => {
        const direct = parseStream({ name: 'Addon 4K • Source', description: 'Movie | 4K • MKV • HEVC • HDR', url: 'https://cdn.example.com/v.mkv' });
        expect(direct.isDirect).toBe(true);
        expect(direct.resolution).toBe('4K');
        expect(direct.hdr).toBe('HDR');
        const torrent = parseStream({ name: 'Torrent 1080p', description: '👤 120 / 14 💾 2.1 GB', infoHash: 'abc123' });
        expect(torrent.isDirect).toBe(false);
        expect(torrent.seeders).toBe(120);
    });

    it('does not read a bitrate (Mbps) as a file size in MB', () => {
        const direct = parseStream({ name: 'Addon 1080p', description: 'Dune (2021) | 1080p • MP4 • H.264 • ~3.0 Mbps | Source: X', url: 'https://cdn.example.com/v.mp4' });
        expect(direct.sizeGB).toBeNull();
        expect(parseStream({ description: '1080p 💾 2.1 GB' }).sizeGB).toBe(2.1);
        expect(parseStream({ description: '700 MB' }).sizeLabel).toBe('700 MB');
    });
});
