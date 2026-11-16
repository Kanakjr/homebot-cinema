'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../db');
const { Library } = require('../library/library');

function touch(p, bytes = 10) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(bytes, 1));
}

function fixture() {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lib-')));
    const M = path.join(base, 'Movies');
    const T = path.join(base, 'TV');
    touch(path.join(M, 'Leviticus.2026.1080p.WEBRip.x265.mkv'));
    touch(path.join(M, 'The Northman (2022)', 'the.northman.2022.1080p.mkv'));
    touch(path.join(M, 'The Northman (2022)', 'Sample', 'sample.mkv'));
    touch(path.join(M, 'The Northman (2022)', 'info.nfo'));
    touch(path.join(M, 'Scary.Movie.2026.1080p.mkv'));
    touch(path.join(M, 'Scary.Movie.2026.1080p.mp4')); // remux duplicate of the .mkv
    touch(path.join(T, 'Silo - S01E09', 'Season 1', 'Silo (2023) - S01E09 - The Janitor (1080p).mp4'));
    touch(path.join(T, 'Silo - S03E01', 'Season 3', 'Silo.S03E01.1080p.mp4'));
    touch(path.join(T, 'Silo - S03E02', 'Season 3', 'Silo.S03E02.mp4'));
    touch(path.join(T, 'Lost (2004) Season 3 S03 + Extras (1080p)', 'Lost - S03E05.mkv'));
    touch(path.join(T, 'Lost (2004) Season 3 S03 + Extras (1080p)', 'Lost - S03E06.mkv'));
    touch(path.join(T, 'Lost (2004) Season 3 S03 + Extras (1080p)', 'readme.txt'));
    touch(path.join(T, 'abc123.torrent'));
    const calls = [];
    const fetchJson = async (url) => {
        calls.push(url);
        const metas = {
            Silo: [{ id: 'tt14688458', imdb_id: 'tt14688458', name: 'Silo', releaseInfo: '2023–' }],
            Lost: [{ id: 'tt0411008', imdb_id: 'tt0411008', name: 'Lost', releaseInfo: '2004–2010' }, { id: 'tt9999999', imdb_id: 'tt9999999', name: 'Lost', releaseInfo: '1990' }],
            'The Northman': [{ id: 'tt11138512', imdb_id: 'tt11138512', name: 'The Northman', year: '2022' }],
        };
        let m = /\/meta\/(\w+)\/(tt\d+)\.json/.exec(url);
        if (m) return { meta: { name: m[2] === 'tt1375666' ? 'Inception' : null, year: '2010' } };
        m = /search=([^.]+)\.json/.exec(url);
        return { metas: metas[decodeURIComponent(m[1])] || [] };
    };
    const db = openDb(base, ':memory:');
    const lib = new Library({ db, roots: { movie: M, series: T }, fetchJson, minBytes: 1 });
    return { base, M, T, db, lib, calls };
}

const names = (lib) => lib.list().items.map((i) => i.title).sort();

test('scan: one item per movie/show; sample, .torrent and remux duplicates are ignored', async () => {
    const { lib } = fixture();
    await lib.scan();
    assert.deepEqual(names(lib), ['Leviticus', 'Lost', 'Scary Movie', 'Silo', 'The Northman']);
    const silo = lib.list({ type: 'series', q: 'silo' }).items[0];
    assert.equal(silo.episodeCount, 3, 'three per-episode folders collapse into one show with three episodes');
    assert.deepEqual(silo.seasons, [1, 3]);
    assert.equal(lib.list().items.find((i) => i.title === 'The Northman').fileCount, 1, 'sample ignored');
    assert.equal(lib.list().items.find((i) => i.title === 'Scary Movie').fileCount, 1, 'remux duplicate ignored');
    assert.deepEqual(lib.list().counts, { all: 5, movie: 3, series: 2, unmatched: 2 }); // Leviticus and Scary Movie are unknown to the fake Cinemeta
});

test('matching: exact title + nearest year; unmatched stay unmatched and are not re-queried within 24h', async () => {
    const { lib, calls } = fixture();
    await lib.scan();
    const silo = lib.list({ q: 'Silo' }).items[0];
    assert.equal(silo.imdbId, 'tt14688458');
    assert.match(silo.poster, /metahub\.space\/poster\/small\/tt14688458/);
    assert.equal(lib.list({ q: 'Lost' }).items[0].imdbId, 'tt0411008', 'year 2004 picks the 2004 show, not the 1990 one');
    assert.equal(lib.list({ q: 'Leviticus' }).items[0].matched, false);
    assert.deepEqual(lib.list({ unmatched: true }).items.map((i) => i.title).sort(), ['Leviticus', 'Scary Movie']);
    const before = calls.length;
    await lib.scan();
    assert.equal(calls.length, before, 'no repeat lookups inside the retry window');
});

test('a show whose release-name year is a later season year still matches; a movie with a far-off year does not', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'libm-')));
    touch(path.join(base, 'TV', 'Mirzapur (2024) Season 03 Hindi S03 Complete 1080p', 'Mirzapur (2024) S03EP08.mkv'));
    touch(path.join(base, 'TV', 'mirzapur S02 (2020) (Season 2 1080p)', 'mirzapur.s02e01.mkv'));
    touch(path.join(base, 'Movies', 'Heat (2024) 1080p.mkv'));
    const fetchJson = async (u) => (/Heat/.test(u)
        ? { metas: [{ id: 'tt0113277', imdb_id: 'tt0113277', name: 'Heat', year: '1995' }] }
        : { metas: [{ id: 'tt6525202', imdb_id: 'tt6525202', name: 'Mirzapur', releaseInfo: '2018–' }] });
    const lib = new Library({ db: openDb(base, ':memory:'), roots: { movie: path.join(base, 'Movies'), series: path.join(base, 'TV') }, fetchJson, minBytes: 1 });
    await lib.scan();
    const mirz = lib.list({ q: 'Mirzapur' }).items[0];
    assert.equal(mirz.imdbId, 'tt6525202');
    assert.equal(mirz.episodeCount, 2, 'both folders merge into one show; EP08 is parsed as an episode');
    assert.deepEqual(mirz.seasons, [2, 3]);
    assert.equal(lib.list({ q: 'Heat' }).items[0].matched, false, 'Heat (2024) is not Heat (1995)');
});

test('series detail groups seasons and episodes; lookup by imdb id', async () => {
    const { lib } = fixture();
    await lib.scan();
    const d = lib.getByImdb('tt14688458');
    assert.equal(d.type, 'series');
    assert.deepEqual(d.seasons.map((s) => [s.season, s.episodes.map((e) => e.episode)]), [[1, [9]], [3, [1, 2]]]);
    const f = d.seasons[0].episodes[0].files[0];
    assert.match(f.streamId, /^lf_\d+$/);
    assert.equal(f.resolution, '1080p');
    assert.equal(lib.get(lib.list({ q: 'Northman' }).items[0].id).files.length, 1);
    assert.equal(lib.getByImdb('tt0000000'), null);
});

test('rescan is stable, picks up removed files', async () => {
    const { lib, T } = fixture();
    await lib.scan();
    const idBefore = lib.list({ q: 'Silo' }).items[0].id;
    fs.unlinkSync(path.join(T, 'Silo - S03E02', 'Season 3', 'Silo.S03E02.mp4'));
    await lib.scan();
    const silo = lib.list({ q: 'Silo' }).items[0];
    assert.equal(silo.id, idBefore);
    assert.equal(silo.episodeCount, 2);
});

test('deleteFile removes the file, its remux twin, and the folders left empty - never the root', async () => {
    const { lib, M, T } = fixture();
    await lib.scan();
    const silo = lib.getByImdb('tt14688458');
    const ep9 = silo.seasons[0].episodes[0].files[0];
    lib.deleteFile(ep9.id);
    assert.ok(!fs.existsSync(path.join(T, 'Silo - S01E09')), 'per-episode folder removed');
    assert.ok(fs.existsSync(T), 'TV root kept');
    const scary = lib.list({ q: 'Scary' }).items[0];
    lib.deleteFile(lib.get(scary.id).files[0].id);
    assert.ok(!fs.existsSync(path.join(M, 'Scary.Movie.2026.1080p.mkv')));
    assert.ok(!fs.existsSync(path.join(M, 'Scary.Movie.2026.1080p.mp4')), 'remux twin removed too');
    assert.ok(fs.existsSync(M));
    assert.equal(lib.list({ q: 'Scary' }).items.length, 0, 'item disappears with its last file');
});

test('deleteItem: a whole season, then a whole show including junk files in its folder', async () => {
    const { lib, T } = fixture();
    await lib.scan();
    const silo = lib.getByImdb('tt14688458');
    assert.equal(lib.deleteItem(silo.id, 3).length, 2);
    assert.deepEqual(lib.getByImdb('tt14688458').seasons.map((s) => s.season), [1]);
    const lost = lib.getByImdb('tt0411008');
    lib.deleteItem(lost.id);
    assert.equal(fs.readdirSync(T).filter((n) => n.startsWith('Lost')).length, 0, 'folder with readme.txt leftover is gone');
    assert.ok(fs.existsSync(path.join(T, 'abc123.torrent')), 'unrelated files in the root are never touched');
});

test('a DB row pointing outside the media roots is never deleted from disk', async () => {
    const { lib, base, db } = fixture();
    await lib.scan();
    const secret = path.join(base, 'data', 'stream_secret.key');
    touch(secret, 65);
    const item = lib.list({ q: 'Silo' }).items[0];
    const info = db.raw.prepare("INSERT INTO media_files (media_item_id, path, size, added_at) VALUES (?, ?, 65, 'x')").run(item.id, secret);
    assert.throws(() => lib.deleteFile(Number(info.lastInsertRowid)), /path_outside_media_roots/);
    assert.ok(fs.existsSync(secret), 'file untouched');
});

test('identify: manual match is kept by later scans; bad ids are rejected', async () => {
    const { lib } = fixture();
    await lib.scan();
    const lev = lib.list({ q: 'Leviticus' }).items[0];
    await assert.rejects(lib.identify(lev.id, 'nonsense'), /invalid_imdb_id/);
    const r = await lib.identify(lev.id, 'tt1375666');
    assert.equal(r.imdbId, 'tt1375666');
    assert.equal(r.title, 'Inception');
    await lib.scan();
    const again = lib.list({ q: 'Inception' }).items[0];
    assert.equal(again.imdbId, 'tt1375666');
    assert.equal(again.matched, true);
});

test('missing media roots do not break a scan', async () => {
    const db = openDb(os.tmpdir(), ':memory:');
    const lib = new Library({ db, roots: { movie: '/no/such/dir', series: '/nor/this' }, fetchJson: async () => ({ metas: [] }) });
    const st = await lib.scan();
    assert.equal(st.error, null);
    assert.equal(st.items, 0);
});

test('deleteFile / deleteItem report what was removed (used to tell Sentinel an episode was deleted on purpose)', async () => {
    const { lib } = fixture();
    await lib.scan();
    const silo = lib.getByImdb('tt14688458');
    const ep = silo.seasons[0].episodes[0].files[0];
    const before = lib.filePath(ep.id);
    assert.deepEqual(lib.deleteFile(ep.id), { path: before, type: 'series', imdbId: 'tt14688458', season: 1, episode: 9 });
    const gone = lib.deleteItem(lib.getByImdb('tt14688458').id, 3);
    assert.deepEqual(gone.map((d) => [d.season, d.episode]).sort((x, y) => x[1] - y[1]), [[3, 1], [3, 2]]);
    assert.ok(gone.every((d) => d.imdbId === 'tt14688458' && d.type === 'series'));
});

test('scanTrusted is false before a scan, after a failed scan and when a media drive is missing', async () => {
    const { lib } = fixture();
    assert.equal(lib.scanTrusted(), false, 'no scan yet');
    await lib.scan();
    assert.equal(lib.scanTrusted(), true);
    lib.roots = { ...lib.roots, series: '/definitely/not/mounted' };
    assert.equal(lib.scanTrusted(), false, 'drive unplugged');
});

test('list: limit caps the rows; newCount counts files added in the last few days (Home "Recently added" rail)', async () => {
    const { lib, T } = fixture();
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const oldEp = path.join(T, 'Silo - S01E09', 'Season 1', 'Silo (2023) - S01E09 - The Janitor (1080p).mp4');
    fs.utimesSync(oldEp, old, old);
    await lib.scan();
    const silo = () => lib.list({ q: 'silo' }).items[0];
    assert.equal(silo().newCount, 2, 'two recent episodes; the 10-day-old one is not new');
    assert.equal(lib.list({ q: 'silo', newDays: 30 }).items[0].newCount, 3);
    assert.equal(lib.list({ limit: 2 }).items.length, 2);
    assert.equal(lib.list({ limit: 0 }).items.length, 5, 'no limit when 0 or missing');
});

test('episodeIds lists matched episodes on disk as Stremio video ids (Calendar markers)', async () => {
    const { lib } = fixture();
    await lib.scan();
    const ids = lib.episodeIds();
    assert.ok(ids.includes('tt14688458:1:9'));
    assert.ok(ids.includes('tt14688458:3:2'));
    assert.ok(ids.includes('tt0411008:3:5'));
    assert.ok(ids.every((v) => /^tt\d+:\d+:\d+$/.test(v)), 'movies and unmatched items are left out');
});

test('imdbIdsOnServer: matched titles on disk, as a set (smart browse "On server" badge)', async () => {
    const { lib } = fixture();
    await lib.scan();
    const ids = lib.imdbIdsOnServer();
    assert.ok(ids.has('tt14688458') && ids.has('tt0411008'));
    assert.ok([...ids].every((v) => /^tt\d+$/.test(v)));
});

// ---------- cold roots (Google Drive mounted through rclone) ----------
const { COLD_MARKER } = require('../library/library');

function coldFixture({ online = true } = {}) {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cold-')));
    const M = path.join(base, 'Movies');
    const GM = path.join(base, 'GDriveMovies');
    touch(path.join(M, 'Local.Film.2024.1080p.mkv'));
    touch(path.join(GM, 'Cloud.Film.2020.1080p.mkv'));
    if (online) touch(path.join(GM, COLD_MARKER), 0);
    fs.mkdirSync(path.join(base, 'TV'));
    touch(path.join(base, 'TV', 'Show - S01E01.mkv'));
    const db = openDb(base, ':memory:');
    const lib = new Library({ db, roots: { movie: M, series: path.join(base, 'TV') }, extraRoots: { movie: [GM] }, fetchJson: async () => ({ metas: [] }), minBytes: 1 });
    return { base, M, GM, lib, db };
}

test('cold root: files on the mounted drive appear in the library next to local ones', async () => {
    const { lib } = coldFixture();
    await lib.scan();
    assert.deepEqual(names(lib), ['Cloud Film', 'Local Film', 'Show']);
    assert.equal(lib.scanTrusted(), true);
});

test('cold root without its marker (unmounted, empty mount point) is skipped, untrusted, and its rows survive', async () => {
    const { lib, GM } = coldFixture();
    await lib.scan();
    fs.rmSync(path.join(GM, COLD_MARKER)); // mount dropped: directory is there, marker is not
    fs.rmSync(path.join(GM, 'Cloud.Film.2020.1080p.mkv')); // and the listing is empty
    await lib.scan();
    assert.deepEqual(lib.status.offlineRoots, [GM]);
    assert.equal(lib.scanTrusted(), false, 'Sentinel must not judge deletions while the drive is away');
    assert.ok(names(lib).includes('Cloud Film'), 'rows under the offline root are kept, not treated as deleted');
});

test('cold root that comes back is trusted again; a real deletion is then noticed', async () => {
    const { lib, GM } = coldFixture();
    await lib.scan();
    fs.rmSync(path.join(GM, COLD_MARKER));
    await lib.scan();
    touch(path.join(GM, COLD_MARKER), 0);
    fs.rmSync(path.join(GM, 'Cloud.Film.2020.1080p.mkv'));
    await lib.scan();
    assert.equal(lib.scanTrusted(), true);
    assert.deepEqual(names(lib), ['Local Film', 'Show']);
});

test('deleting a file on an offline cold root fails with 503 and keeps the row', async () => {
    const { lib, GM } = coldFixture();
    await lib.scan();
    const id = lib.list().items.find((i) => i.title === 'Cloud Film').id;
    const fileId = lib.raw.prepare('SELECT id FROM media_files WHERE media_item_id = ?').get(id).id;
    fs.rmSync(path.join(GM, COLD_MARKER));
    assert.throws(() => lib.deleteFile(fileId), (e) => e.status === 503 && /root_offline/.test(e.message));
    assert.ok(lib.raw.prepare('SELECT id FROM media_files WHERE id = ?').get(fileId), 'row kept');
});

test('an unreadable sub-folder mid-scan makes the scan untrusted and prunes nothing', async () => {
    const { lib, M } = coldFixture();
    await lib.scan();
    const bad = path.join(M, 'Locked (2020)');
    touch(path.join(bad, 'locked.2020.mkv'));
    await lib.scan();
    fs.chmodSync(bad, 0o000);
    try {
        await lib.scan();
        if (lib.status.walkErrors) {
            assert.equal(lib.scanTrusted(), false);
            assert.ok(names(lib).includes('Locked'), 'row kept while the folder cannot be read');
        } // running as root can read it anyway: nothing to assert
    } finally {
        fs.chmodSync(bad, 0o755);
    }
});
