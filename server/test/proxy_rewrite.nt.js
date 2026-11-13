'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rewriteUpstreamPath: rewriteRaw, forceH264ForHls } = require('../proxy_rewrite');

const H = 'a'.repeat(40);
const enc = encodeURIComponent;
const HOSTS = ['cinema.example.com', '192.168.1.20:3002'];
const rewriteUpstreamPath = (p, o) => rewriteRaw(p, { hosts: HOSTS, ...o });

test('videoUrl (subtitle hash) pointing at a public torrent URL is read from the streaming server directly', () => {
    const out = rewriteUpstreamPath(`/opensubHash?videoUrl=${enc(`https://cinema.example.com/${H}/2?`)}`);
    assert.equal(out, `/opensubHash?videoUrl=${enc(`http://127.0.0.1:11470/${H}/2?`)}`);
});

test('mediaURL keeps working for HLS requests, torrent and non-torrent', () => {
    const t = rewriteUpstreamPath(`/hlsv2/x/master.m3u8?mediaURL=${enc(`https://cinema.example.com/${H}/2?`)}&videoCodecs=h264`);
    assert.equal(t, `/hlsv2/x/master.m3u8?mediaURL=${enc(`http://127.0.0.1:11470/${H}/2?`)}&videoCodecs=h264`);
    const local = rewriteUpstreamPath(`/hlsv2/x/master.m3u8?mediaURL=${enc('https://cinema.example.com/api/downloads/stream/dl_1/video.mp4')}`);
    assert.equal(local, `/hlsv2/x/master.m3u8?mediaURL=${enc('http://homebot-cinema:8080/api/downloads/stream/dl_1/video.mp4')}`);
});

test('the /streaming/ prefix on torrent URLs is dropped, plain (unencoded) forms are handled too', () => {
    assert.equal(rewriteUpstreamPath(`/x?videoUrl=${enc(`https://cinema.example.com/streaming/${H}/0`)}`), `/x?videoUrl=${enc(`http://127.0.0.1:11470/${H}/0`)}`);
    assert.equal(rewriteUpstreamPath(`/x?mediaURL=https://cinema.example.com/${H}/1`), `/x?mediaURL=http://127.0.0.1:11470/${H}/1`);
});

test('LAN origins are rewritten as well; external URLs and unrelated parameters are left alone', () => {
    assert.equal(rewriteUpstreamPath(`/x?videoUrl=${enc('http://192.168.1.20:3002/api/downloads/stream/dl_1/video.mp4')}`), `/x?videoUrl=${enc('http://homebot-cinema:8080/api/downloads/stream/dl_1/video.mp4')}`);
    const ext = `/subtitles.vtt?from=${enc('https://subs5.strem.io/en/download/file/1961938243')}`;
    assert.equal(rewriteUpstreamPath(ext), ext);
    const other = `/x?foo=${enc('https://cinema.example.com/y')}`;
    assert.equal(rewriteUpstreamPath(other), other, 'only mediaURL / videoUrl are touched');
    assert.equal(rewriteUpstreamPath('/settings'), '/settings');
});

test('both parameters in one request, and case-insensitive host/param matching', () => {
    const out = rewriteUpstreamPath(`/x?videoUrl=${enc(`https://cinema.example.com/${H}/2`)}&mediaURL=${enc(`https://cinema.example.com/${H}/2`)}`);
    assert.equal(out.match(/127\.0\.0\.1%3A11470/g).length, 2);
    assert.equal(rewriteUpstreamPath(`/x?VIDEOURL=${enc(`https://CINEMA.example.com/${H}/2`)}`).includes('127.0.0.1%3A11470'), true);
});

test('HLS requests: HEVC is removed from the advertised video codecs, H.264 and audio codecs stay', () => {
    const q = 'mediaURL=x&videoCodecs=h264&videoCodecs=h265&videoCodecs=hevc&audioCodecs=aac&audioCodecs=mp3&maxAudioChannels=8';
    assert.equal(forceH264ForHls(`/hlsv2/abc/master.m3u8?${q}`), '/hlsv2/abc/master.m3u8?mediaURL=x&videoCodecs=h264&audioCodecs=aac&audioCodecs=mp3&maxAudioChannels=8');
    assert.equal(forceH264ForHls('/hlsv2/abc/video0/segment3.m4s?videoCodecs=hevc&videoCodecs=h264&x=1'), '/hlsv2/abc/video0/segment3.m4s?videoCodecs=h264&x=1');
});

test('forceH264ForHls always leaves h264 advertised, ignores non-HLS paths and queryless requests', () => {
    assert.equal(forceH264ForHls('/hlsv2/abc/master.m3u8?videoCodecs=hevc&videoCodecs=h265'), '/hlsv2/abc/master.m3u8?videoCodecs=h264');
    const other = '/settings?videoCodecs=hevc';
    assert.equal(forceH264ForHls(other), other);
    assert.equal(forceH264ForHls('/hlsv2/abc/init.mp4'), '/hlsv2/abc/init.mp4');
    assert.equal(forceH264ForHls('/hlsv2/abc/master.m3u8?videoCodecs=VP9&videoCodecs=H265'), '/hlsv2/abc/master.m3u8?videoCodecs=VP9&videoCodecs=h264');
});

test('combined with the host rewrite, the full proxied HLS path is correct', () => {
    const H2 = 'b'.repeat(40);
    const p = `/hlsv2/id/master.m3u8?mediaURL=${encodeURIComponent(`https://cinema.example.com/${H2}/2?`)}&videoCodecs=h264&videoCodecs=hevc`;
    assert.equal(forceH264ForHls(rewriteUpstreamPath(p)), `/hlsv2/id/master.m3u8?mediaURL=${encodeURIComponent(`http://127.0.0.1:11470/${H2}/2?`)}&videoCodecs=h264`);
});

test('the host list is the only thing that counts as "ours": no hosts configured means nothing is rewritten', () => {
    const p = `/x?mediaURL=${enc('https://cinema.example.com/api/downloads/stream/dl_1/video.mp4')}`;
    assert.equal(rewriteRaw(p), p);
    assert.equal(rewriteRaw(p, { hosts: [] }), p);
    assert.equal(rewriteRaw(p, { hosts: ['cinema.example.com'] }), `/x?mediaURL=${enc('http://homebot-cinema:8080/api/downloads/stream/dl_1/video.mp4')}`);
});

test('a host only matches as a whole, and junk entries in the list are ignored', () => {
    const evil = `/x?mediaURL=${enc('https://cinema.example.com.evil.net/a')}`;
    assert.equal(rewriteUpstreamPath(evil), evil);
    const port = `/x?mediaURL=${enc('http://192.168.1.20:30021/a')}`;
    assert.equal(rewriteUpstreamPath(port), port, 'port 3002 must not match 30021');
    const weird = `/x?mediaURL=${enc('https://cinema.example.com/a')}`;
    assert.equal(rewriteRaw(weird, { hosts: ['(.*)', '', null, 'a b'] }), weird, 'regex characters and blanks never become patterns');
});
