#!/usr/bin/env node
'use strict';
// One-off import of legacy JSON state into data/cinema.db.
//   node scripts/migrate_json_to_sqlite.js [--data ./data] [--owner-name KanakJr] [--dry-run]
// - Backs up data/ JSON files to data/backup-pre-sqlite-<timestamp>/ first.
// - data/users/<email>.json -> one profile + its library blobs (idempotent: matched by created_by=email).
// - downloads.json / monitored_series.json stay authoritative until the downloads manager
//   and Sentinel are ported (Phase 3); they are only backed up here, not imported.

const fs = require('fs');
const path = require('path');
const { openDb } = require('../server/db');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const dataPath = path.resolve(opt('data', path.join(__dirname, '../data')));
const dryRun = args.includes('--dry-run');
const ownerName = opt('owner-name', null);
const adminEmails = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function displayName(email) {
    if (ownerName && adminEmails[0] === email) return ownerName;
    const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    return local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

function backup() {
    const dir = path.join(dataPath, `backup-pre-sqlite-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['downloads.json', 'monitored_series.json', 'addons.json']) {
        const p = path.join(dataPath, f);
        if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dir, f));
    }
    const usersDir = path.join(dataPath, 'users');
    if (fs.existsSync(usersDir)) {
        fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
        for (const f of fs.readdirSync(usersDir)) fs.copyFileSync(path.join(usersDir, f), path.join(dir, 'users', f));
    }
    return dir;
}

const usersDir = path.join(dataPath, 'users');
const files = fs.existsSync(usersDir) ? fs.readdirSync(usersDir).filter((f) => f.endsWith('.json')) : [];
console.log(`[migrate] data=${dataPath} users=${files.length} dryRun=${dryRun}`);
if (dryRun) {
    for (const f of files) console.log(`  would import ${f} -> profile "${displayName(f.replace(/\.json$/, ''))}"`);
    process.exit(0);
}

console.log(`[migrate] backup -> ${backup()}`);
const db = openDb(dataPath);
const raw = db.raw;
const findProfile = raw.prepare('SELECT id FROM profiles WHERE created_by = ?');
const addProfile = raw.prepare('INSERT INTO profiles (name, created_by, created_at, sort) VALUES (?, ?, ?, ?) RETURNING id');
const putBlob = raw.prepare(`INSERT INTO profile_blobs (profile_id, key, json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, key) DO NOTHING`);

let created = 0, skipped = 0, blobs = 0;
raw.exec('BEGIN');
try {
    files.forEach((f, i) => {
        const data = JSON.parse(fs.readFileSync(path.join(usersDir, f), 'utf8'));
        const email = String(data.email || f.replace(/\.json$/, '')).toLowerCase();
        let row = findProfile.get(email);
        if (row) skipped++; else { row = addProfile.get(displayName(email), email, new Date().toISOString(), i); created++; }
        for (const key of ['library', 'library_recent']) {
            if (data[key] != null) { blobs += Number(putBlob.run(row.id, key, JSON.stringify(data[key]), data.updatedAt || new Date().toISOString()).changes); }
        }
    });
    raw.exec('COMMIT');
} catch (e) {
    raw.exec('ROLLBACK');
    console.error('[migrate] FAILED, rolled back:', e.message);
    process.exit(1);
}
console.log(`[migrate] profiles created=${created} existing=${skipped}, blobs written=${blobs}`);
db.close();
