'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseName, parseMediaPath, normTitle, isVideoFile } = require('../library/parse');

const pick = (o, ...k) => Object.fromEntries(k.map((x) => [x, o[x]]));

test('movie release names from the real library', () => {
    assert.deepEqual(pick(parseName('Disclosure.Day.2026.1080p.MA.WEBRip.10Bit.DDP5.1.x265-NeoNoir.mkv'), 'title', 'year', 'resolution', 'codec'),
        { title: 'Disclosure Day', year: 2026, resolution: '1080p', codec: 'x265' });
    assert.deepEqual(pick(parseName('Star.Wars The Mandalorian And Grogu 2026 1080p WEB-DL HEVC x265 5.1 BONE.mkv'), 'title', 'year'),
        { title: 'Star Wars The Mandalorian And Grogu', year: 2026 });
    assert.deepEqual(pick(parseName('The Furious (2026) Eng 1080p WEBRip x265 DDP 5.1 ESub.mkv'), 'title', 'year'), { title: 'The Furious', year: 2026 });
    assert.deepEqual(pick(parseName('Ready or Not - Here I Come (2026)'), 'title', 'year'), { title: 'Ready or Not - Here I Come', year: 2026 });
    assert.deepEqual(pick(parseName('Scary Movie 2026 1080p WEB-DL HEVC x265 5.1 BONE.mkv'), 'title', 'year', 'source'), { title: 'Scary Movie', year: 2026, source: 'WEB-DL' });
});

test('a title that is itself a year is not cut', () => {
    assert.equal(parseName('2012 (2009) 1080p BluRay x264.mkv').title, '2012');
    assert.equal(parseName('1917.2019.2160p.UHD.BluRay.x265.mkv').title, '1917');
    assert.equal(parseName('1917.2019.2160p.UHD.BluRay.x265.mkv').resolution, '2160p');
});

test('episode names in all the styles seen on disk', () => {
    assert.deepEqual(pick(parseName('Silo (2023) - S01E03 - Machines (1080p ATVP WEB-DL x265 t3nzin).mp4'), 'title', 'year', 'season', 'episode'),
        { title: 'Silo', year: 2023, season: 1, episode: 3 });
    assert.deepEqual(pick(parseName('Silo.S03E01.1080p.WEB.h264-ETHEL[EZTVx.to].mp4'), 'title', 'season', 'episode', 'codec'),
        { title: 'Silo', season: 3, episode: 1, codec: 'x264' });
    assert.deepEqual(pick(parseName('Silo S03E02 Its All Good 1080p ATVP WEB-DL DDP5 1 H 264-NTb[EZTVx.to].mp4'), 'title', 'season', 'episode'),
        { title: 'Silo', season: 3, episode: 2 });
    assert.deepEqual(pick(parseName('silo.s03e05.1080p.web.h264-cakes[EZTVx.to].mp4'), 'title', 'season', 'episode'), { title: 'silo', season: 3, episode: 5 });
    assert.deepEqual(pick(parseName('Silo.S03E03.mp4'), 'title', 'season', 'episode'), { title: 'Silo', season: 3, episode: 3 });
    assert.deepEqual(pick(parseName('Show 2x05 Title 720p.mkv'), 'title', 'season', 'episode'), { title: 'Show', season: 2, episode: 5 });
});

test('EP-style episode tags (Indian releases)', () => {
    assert.deepEqual(pick(parseName('Mirzapur (2024) S03EP08.mkv'), 'title', 'year', 'season', 'episode'), { title: 'Mirzapur', year: 2024, season: 3, episode: 8 });
    assert.deepEqual(pick(parseName('Show.S01EP12.720p.mkv'), 'title', 'season', 'episode'), { title: 'Show', season: 1, episode: 12 });
});

test('season-pack folder names', () => {
    assert.deepEqual(pick(parseName('Lost (2004) Season 3 S03 + Extras (1080p BluRay x265 HEVC 10bit AAC 5.1 Silence)'), 'title', 'year', 'season', 'episode'),
        { title: 'Lost', year: 2004, season: 3, episode: null });
    assert.deepEqual(pick(parseName('Mirzapur (2024) Season 03 Hindi S03 Complete 1080p AMZN WEB-DL - 5.7 GB - DDP 5.1 AVC x264 Esub - SHADOW [ProtonMovies]'), 'title', 'year', 'season'),
        { title: 'Mirzapur', year: 2024, season: 3 });
    assert.deepEqual(pick(parseName('Mirzapur S01 Hindi 720p AMZN WEB-DL x264 DD 5.1 ESubs [MW]'), 'title', 'season', 'resolution'),
        { title: 'Mirzapur', season: 1, resolution: '720p' });
    assert.equal(parseName('Silo - S01E09').title, 'Silo');
});

test('dots are kept in titles that contain spaces', () => {
    assert.equal(parseName('Dr. STONE').title, 'Dr. STONE');
    assert.equal(parseName('Mr.Robot.S01E01.720p.mkv').title, 'Mr Robot');
});

test('parseMediaPath: series title/year come from the top folder, episode from the file', () => {
    const a = parseMediaPath('Silo - S01E09/Season 1/Silo (2023) - S01E09 - The Janitor (1080p x265).mp4', 'series');
    assert.deepEqual(pick(a, 'title', 'season', 'episode'), { title: 'Silo', season: 1, episode: 9 });
    const b = parseMediaPath('Lost (2004) Season 3 S03 + Extras (1080p BluRay x265)/Lost - S03E05 - Title.mkv', 'series');
    assert.deepEqual(pick(b, 'title', 'year', 'season', 'episode'), { title: 'Lost', year: 2004, season: 3, episode: 5 });
    const c = parseMediaPath('Dr. STONE/Season 2/Dr. STONE - S02E03.mkv', 'series');
    assert.deepEqual(pick(c, 'title', 'season', 'episode'), { title: 'Dr. STONE', season: 2, episode: 3 });
    const d = parseMediaPath('Show Name/Season 4/episode 7.mkv', 'series');
    assert.deepEqual(pick(d, 'title', 'season'), { title: 'Show Name', season: 4 });
});

test('parseMediaPath: movies prefer a clean "Title (Year)" folder, else the file name', () => {
    assert.deepEqual(pick(parseMediaPath('The Northman (2022)/the.northman.2022.1080p.bluray.mkv', 'movie'), 'title', 'year'), { title: 'The Northman', year: 2022 });
    assert.deepEqual(pick(parseMediaPath('Leviticus.2026.1080p.WEBRip.10Bit.DDP5.1.x265-NeoNoir.mkv', 'movie'), 'title', 'year'), { title: 'Leviticus', year: 2026 });
});

test('normTitle and isVideoFile', () => {
    assert.equal(normTitle('Dr. STONE'), normTitle('dr stone'));
    assert.equal(normTitle('Ready or Not - Here I Come'), 'ready or not here i come');
    assert.ok(isVideoFile('a.MKV') && isVideoFile('a.mp4') && !isVideoFile('a.torrent') && !isVideoFile('a.nfo'));
});
