// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */
const R = require('../ui/report');
const { SLOTS } = require('../../../src/plugins/host');

describe('nowplaying reporter helpers', () => {
    it('tells server files, torrents and links apart', () => {
        expect(R.streamSource({ url: 'https://h.example.com/api/downloads/stream/lf_2/video.mp4' })).toBe('server');
        expect(R.streamSource({ infoHash: 'a'.repeat(40), fileIdx: 0 })).toBe('torrent');
        expect(R.streamSource({ url: 'https://cdn.example.com/x.m3u8' })).toBe('link');
        expect(R.streamSource(null)).toBe(null);
    });

    it('calls it transcoding only while HLS segments are being fetched', () => {
        expect(R.isHlsResource('https://h.example.com/hlsv2/abc/video0/segment12.ts')).toBe(true);
        expect(R.isHlsResource('https://h.example.com/hlsv2/probe?mediaURL=x')).toBe(false);
        expect(R.isHlsResource('https://h.example.com/api/downloads/stream/lf_2/video.mp4')).toBe(false);
        expect(R.playbackMode(null, 1000)).toBe('direct');
        expect(R.playbackMode(1000, 1000 + R.HLS_WINDOW - 1)).toBe('transcode');
        expect(R.playbackMode(1000, 1000 + R.HLS_WINDOW + 1)).toBe('direct');
    });

    it('builds the heartbeat and session ids', () => {
        const hb = R.heartbeat({ session: 's1', title: 'X', timeMs: 5, durationMs: NaN, paused: undefined, stream: { infoHash: 'b'.repeat(40) }, lastHlsAt: null, nowMs: 0 });
        expect(hb).toMatchObject({ session: 's1', title: 'X', timeMs: 5, durationMs: null, paused: false, mode: 'direct', source: 'torrent' });
        expect(R.newSessionId()).toMatch(/^[0-9a-f]{24}$/);
        expect(R.clock(3723000)).toBe('1:02:03');
        expect(R.clock(65000)).toBe('1:05');
    });

    it('uses known slots', () => {
        expect(SLOTS).toEqual(expect.arrayContaining(['playerOverlays', 'adminTabs', 'metaDetailsSections']));
    });
});
