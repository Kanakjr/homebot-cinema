'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStreamInfo } = require('../grabber/stream_info');
const { BUILTIN, normalizeProfile, evaluate, pickBest } = require('../grabber/quality');

const st = (title, name = 'StreamAddon') => ({ name, title });
const profile = (key) => normalizeProfile(BUILTIN.find((b) => b.key === key).config);

// modelled on the StreamAddon results for "Example Movie"
const A = st('Example.Movie.2026.MULTi.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.HEVC-GRPD\n👤 1478 💾 17.86 GB ⚙️ SRC', 'StreamAddon\n4k DV | HDR');
const B = st('Example.Movie.2026.2160p.WEB-DL.DV.HDR10+.MULTi.MP4-GRPE\n👤 829 💾 19.94 GB ⚙️ SRC', 'StreamAddon\n4k DV | HDR10+');
const C = st('Example Movie 2026 1080p WEB-DL 5.1 x264\n👤 3550 💾 1.53 GB ⚙️ GRPA', 'StreamAddon\n1080p');
const D = st('Example.Movie.2026.1080p.WEB-DL.DDP5.1.H.264\n👤 1547 💾 5.95 GB ⚙️ SRC', 'StreamAddon\n1080p');
const E = st('Example.Movie.2026.1080p.WEBRip.x265\n👤 4858 💾 1.94 GB ⚙️ GRPA', 'StreamAddon\n1080p');
const F = st('Example.Movie.2026.720p.WEB-DL.x265.HEVC\n👤 200 💾 0.9 GB ⚙️ GRPB', 'StreamAddon\n720p');
const G = st('Example.Movie.2026.HDCAM.720p.x264\n👤 400 💾 1.1 GB', 'StreamAddon\n720p');
const H = st('Example.Movie.2026.1080p.BluRay.REMUX.AVC.TrueHD.7.1\n👤 80 💾 25 GB', 'StreamAddon\n1080p');
const ALL = [A, B, C, D, E, F, G, H];

test('parseStreamInfo reads resolution, HDR, codec, audio, size and seeders', () => {
    const i = parseStreamInfo(A);
    assert.equal(i.resolution, '4K');
    assert.equal(i.hdr, 'DV');
    assert.equal(i.codec, 'HEVC');
    assert.equal(i.source, 'WEB-DL');
    assert.ok(i.audio.includes('Atmos') && i.audio.includes('DD+'));
    assert.equal(i.sizeGB, 17.86);
    assert.equal(i.seeders, 1478);
    assert.equal(parseStreamInfo(st('x 1080p 850 MB 👤 12')).sizeGB, 0.83);
    assert.equal(parseStreamInfo({ name: 'x 1080p', behaviorHints: { videoSize: 2_500_000_000 } }).sizeGB, 2.5);
    assert.equal(parseStreamInfo(H).source, 'Remux');
    assert.equal(parseStreamInfo(B).hdr, 'DV'); // DV wins over HDR10+ when both are present
    assert.equal(parseStreamInfo(st('Movie.2026.1080p.DVDRip')).hdr, null, 'DVDRip is not Dolby Vision');
});

test('4K Ultra HD: only 4K, the larger HDR/DV release wins the tie, everything else says why', () => {
    const r = pickBest(profile('4k-ultra'), ALL, 'movie');
    assert.equal(r.picked.info.resolution, '4K');
    assert.equal(r.picked.stream, B, 'A and B both carry DV + preferred keywords; "larger" breaks the tie');
    assert.equal(r.acceptedCount, 2);
    const c = r.results[2];
    assert.equal(c.accepted, false);
    assert.match(c.reasons[0], /1080p is not allowed/);
});

test('HD Balanced: takes 1080p, never CAM, never over the size limit', () => {
    const r = pickBest(profile('hd-balanced'), ALL, 'movie');
    assert.equal(r.picked.info.resolution, '1080p');
    assert.notEqual(r.picked.stream, G);
    assert.notEqual(r.picked.stream, H);
    assert.match(r.results[7].reasons.join(' '), /over the 12 GB limit/);
    assert.match(r.results[6].reasons.join(' '), /CAM/);
});

test('HD Balanced falls back to 720p only when no 1080p is acceptable', () => {
    const r = pickBest(profile('hd-balanced'), [F, G, A], 'movie');
    assert.equal(r.picked.stream, F);
});

test('4K Efficient: a 4K that fits under the cap wins; a too-big 4K falls back to 1080p', () => {
    const p = profile('4k-efficient');
    assert.equal(pickBest(p, [A, B, C], 'movie').picked.stream, A, '17.86 GB fits the 18 GB cap and 4K ranks first');
    const r = pickBest(p, [B, C], 'movie');
    assert.equal(r.picked.stream, C, '19.94 GB 4K is over the cap, so the 1080p is used');
    assert.match(r.results[0].reasons[0], /over the 18 GB limit/);
});

test('Space Saver prefers 720p and small HEVC even when 1080p exists', () => {
    const r = pickBest(profile('space-saver'), ALL, 'movie');
    assert.equal(r.picked.stream, F);
});

test('Direct Play bans HEVC / x265, DTS / TrueHD and HDR', () => {
    const p = profile('direct-play');
    const r = pickBest(p, [E, F, A, H, D, C], 'movie');
    assert.ok([C, D].includes(r.picked.stream), 'an H.264 WEB-DL wins');
    for (const bannedOne of [E, F, A, H]) assert.equal(r.results[[E, F, A, H, D, C].indexOf(bannedOne)].accepted, false);
    assert.equal(evaluate(p, parseStreamInfo(st('Show.S01E01.1080p.WEB-DL.H264.DTS-HD\n👤 50 💾 1.2 GB')), 'episode').accepted, false);
});

test('episode and movie use different size ranges', () => {
    const p = profile('hd-balanced');
    const big = parseStreamInfo(st('Show.S01E01.1080p.WEB-DL.x264\n👤 100 💾 4 GB'));
    assert.equal(evaluate(p, big, 'episode').accepted, false);
    assert.equal(evaluate(p, big, 'movie').accepted, true);
    const tiny = parseStreamInfo(st('Movie.2026.1080p.WEB-DL\n👤 100 💾 0.3 GB'));
    assert.match(evaluate(p, tiny, 'movie').reasons[0], /under the 0.8 GB minimum/);
});

test('minimum seeders, unknown size and unknown seeders', () => {
    const p = profile('hd-balanced');
    assert.match(evaluate(p, parseStreamInfo(st('Movie.1080p.WEB-DL\n👤 2 💾 2 GB')), 'movie').reasons[0], /only 2 seeders/);
    assert.equal(evaluate(p, parseStreamInfo(st('Movie.1080p.WEB-DL')), 'movie').accepted, true, 'unknown size/seeders are not held against a release');
    assert.match(evaluate(p, parseStreamInfo(st('Movie.WEB-DL\n👤 50 💾 2 GB')), 'movie').reasons.join(' '), /resolution not stated/);
});

test('required (any-of), banned and preferred keywords', () => {
    const base = { name: 'T', qualities: ['1080p'], minSeeders: 0 };
    const req = normalizeProfile({ ...base, requiredKeywords: 'grpa, grpb' });
    assert.equal(evaluate(req, parseStreamInfo(st('M.1080p.GRPA')), 'movie').accepted, true);
    assert.equal(evaluate(req, parseStreamInfo(st('M.1080p.GRPC')), 'movie').accepted, false);
    const ban = normalizeProfile({ ...base, bannedKeywords: ['hindi'] });
    assert.equal(evaluate(ban, parseStreamInfo(st('M.1080p.Hindi.WEB-DL')), 'movie').accepted, false);
    const pref = normalizeProfile({ ...base, preferredKeywords: ['atmos'] });
    const a = evaluate(pref, parseStreamInfo(st('M.1080p.Atmos')), 'movie');
    const b = evaluate(pref, parseStreamInfo(st('M.1080p')), 'movie');
    assert.ok(a.score > b.score);
});

test('HDR modes: require / avoid', () => {
    const base = { name: 'T', qualities: ['4K'], minSeeders: 0 };
    assert.equal(evaluate(normalizeProfile({ ...base, hdr: 'require' }), parseStreamInfo(st('M.2160p.WEB-DL')), 'movie').accepted, false);
    assert.equal(evaluate(normalizeProfile({ ...base, hdr: 'avoid' }), parseStreamInfo(st('M.2160p.HDR')), 'movie').accepted, false);
    assert.equal(evaluate(normalizeProfile({ ...base, hdr: 'require' }), parseStreamInfo(st('M.2160p.HDR')), 'movie').accepted, true);
});

test('no acceptable release -> picked is null and the reasons are summarised', () => {
    const r = pickBest(profile('4k-ultra'), [C, D, G], 'movie');
    assert.equal(r.picked, null);
    assert.equal(r.acceptedCount, 0);
    assert.ok(Object.values(r.rejectedSummary).some((n) => n >= 2));
});

test('normalizeProfile validates input and tidies keywords', () => {
    assert.throws(() => normalizeProfile({ name: '', qualities: ['1080p'], minSeeders: 0 }), /Name is required/);
    assert.throws(() => normalizeProfile({ name: 'x', qualities: [], minSeeders: 0 }), /at least one quality/);
    assert.throws(() => normalizeProfile({ name: 'x', qualities: ['8K'], minSeeders: 0 }), /at least one quality/);
    assert.throws(() => normalizeProfile({ name: 'x', qualities: ['1080p'], minSeeders: 0, sizes: { '1080p': { movie: { minGB: 10, maxGB: 2 } } } }), /min size is larger/);
    assert.throws(() => normalizeProfile({ name: 'x', qualities: ['1080p'], minSeeders: 0, hdr: 'sometimes' }), /Invalid HDR/);
    assert.throws(() => normalizeProfile({ name: 'x', qualities: ['1080p'], minSeeders: -1 }), /Minimum seeders/);
    const ok = normalizeProfile({ name: ' Mine ', qualities: ['720p', '1080p', '720p'], minSeeders: '3', bannedKeywords: ' Foo, bar ,FOO\nbaz ' });
    assert.deepEqual(ok.qualities, ['720p', '1080p']);
    assert.deepEqual(ok.bannedKeywords, ['foo', 'bar', 'baz']);
    assert.equal(ok.name, 'Mine');
    assert.equal(ok.minSeeders, 3);
});

test('all built-in profiles are valid and distinct', () => {
    assert.equal(BUILTIN.length, 5);
    for (const b of BUILTIN) assert.doesNotThrow(() => normalizeProfile(b.config), b.key);
    assert.equal(new Set(BUILTIN.map((b) => b.key)).size, 5);
});

test('size limits are per quality: a 4K minimum does not apply to the 1080p fallback', () => {
    const p = profile('4k-efficient');
    assert.equal(p.sizes['4K'].movie.minGB, 3);
    assert.equal(p.sizes['1080p'].movie.minGB, 0.8);
    const small1080 = parseStreamInfo(st('M.2026.1080p.WEB-DL\n👤 100 💾 1.5 GB'));
    assert.equal(evaluate(p, small1080, 'movie').accepted, true);
    const small4k = parseStreamInfo(st('M.2026.2160p.WEB-DL.HDR\n👤 100 💾 1.5 GB'));
    assert.match(evaluate(p, small4k, 'movie').reasons[0], /under the 3 GB minimum/);
    assert.deepEqual(Object.keys(profile('4k-ultra').sizes), ['4K'], 'only allowed qualities carry size rules');
});
