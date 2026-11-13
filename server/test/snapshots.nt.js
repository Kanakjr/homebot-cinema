'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../db');
const { createSnapshots } = require('../snapshots');

const quiet = { log() {}, error() {} };

test('a snapshot is a complete database that opens on its own and has the data', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-snap-'));
    const db = openDb(tmp);
    db.raw.exec("INSERT INTO profiles (name, avatar, created_at) VALUES ('Snap', 'a.png', 1)");
    const s = createSnapshots({ raw: db.raw, dir: path.join(tmp, 'snapshots'), now: () => new Date('2026-11-12T03:00:00Z'), log: quiet });
    const file = s.snapshot();
    assert.equal(path.basename(file), 'cinema-20261112.db');
    assert.ok(!fs.existsSync(`${file}-wal`), 'standalone file, no WAL needed');
    const copy = new DatabaseSync(file, { readOnly: true });
    assert.equal(copy.prepare("SELECT name FROM profiles WHERE name = 'Snap'").get().name, 'Snap');
    copy.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('one snapshot per day, and only the newest 7 are kept', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-snap-'));
    const db = openDb(tmp);
    let day = new Date('2026-11-01T03:00:00Z');
    const s = createSnapshots({ raw: db.raw, dir: path.join(tmp, 'snapshots'), now: () => day, log: quiet });
    assert.equal(s.due(), true);
    s.tick();
    assert.equal(s.due(), false, 'already done today');
    s.tick();
    assert.equal(s.list().length, 1);
    for (let i = 0; i < 10; i++) {
        day = new Date(day.getTime() + 24 * 3600 * 1000);
        s.tick();
    }
    const left = s.list();
    assert.equal(left.length, 7);
    assert.equal(left[left.length - 1], 'cinema-20261111.db');
    assert.equal(left[0], 'cinema-20261105.db');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('a failing snapshot is logged, never thrown into the server', () => {
    const errors = [];
    const s = createSnapshots({ raw: { exec() { throw new Error('disk full'); } }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-snap-')), log: { log() {}, error: (...a) => errors.push(a.join(' ')) } });
    assert.doesNotThrow(() => s.tick());
    assert.match(errors[0], /disk full/);
});
