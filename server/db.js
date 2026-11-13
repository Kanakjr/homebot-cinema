'use strict';
// SQLite persistence (node:sqlite, built into Node >= 22.5, no native build needed).
// Schema is versioned through PRAGMA user_version; add new steps to MIGRATIONS only.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
    // v1 — baseline schema
    `
    CREATE TABLE logins (
        email       TEXT PRIMARY KEY,
        first_seen  TEXT NOT NULL,
        last_seen   TEXT NOT NULL,
        disabled    INTEGER NOT NULL DEFAULT 0,
        quota_gb    REAL
    );
    CREATE TABLE profiles (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT NOT NULL,
        avatar           TEXT,
        pin_hash         TEXT,
        pin_fail_count   INTEGER NOT NULL DEFAULT 0,
        pin_locked_until INTEGER,
        is_kid           INTEGER NOT NULL DEFAULT 0,
        accent           TEXT,
        settings_json    TEXT NOT NULL DEFAULT '{}',
        created_by       TEXT,
        sort             INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL
    );
    CREATE TABLE avatar_catalog (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        url      TEXT NOT NULL UNIQUE,
        category TEXT
    );
    -- stremio-core syncs library/library_recent as opaque blobs; keep them as-is per profile
    CREATE TABLE profile_blobs (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        key        TEXT NOT NULL,
        json       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, key)
    );
    CREATE TABLE watch_progress (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        meta_id    TEXT NOT NULL,
        video_id   TEXT NOT NULL DEFAULT '',
        position   INTEGER NOT NULL DEFAULT 0,
        duration   INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, meta_id, video_id)
    );
    CREATE TABLE watched_items (
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        meta_id    TEXT NOT NULL,
        video_id   TEXT NOT NULL DEFAULT '',
        watched_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, meta_id, video_id)
    );
    CREATE TABLE media_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL CHECK (type IN ('movie','series')),
        imdb_id     TEXT,
        title       TEXT NOT NULL,
        year        INTEGER,
        poster      TEXT,
        backdrop    TEXT,
        logo        TEXT,
        folder_path TEXT,
        matched     INTEGER NOT NULL DEFAULT 0,
        added_at    TEXT NOT NULL
    );
    CREATE INDEX media_items_imdb ON media_items(imdb_id);
    CREATE TABLE media_files (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        season        INTEGER,
        episode       INTEGER,
        path          TEXT NOT NULL UNIQUE,
        size          INTEGER,
        resolution    TEXT,
        video_codec   TEXT,
        audio_codec   TEXT,
        duration      INTEGER,
        added_at      TEXT NOT NULL
    );
    CREATE TABLE downloads (
        id                   TEXT PRIMARY KEY,
        hash                 TEXT,
        media_item_id        INTEGER REFERENCES media_items(id) ON DELETE SET NULL,
        season               INTEGER,
        episode              INTEGER,
        status               TEXT NOT NULL,
        progress             REAL NOT NULL DEFAULT 0,
        error                TEXT,
        requested_by_email   TEXT,
        requested_by_profile INTEGER,
        created_at           TEXT NOT NULL,
        completed_at         TEXT
    );
    CREATE TABLE monitored (
        imdb_id      TEXT PRIMARY KEY,
        title        TEXT,
        mode         TEXT NOT NULL DEFAULT 'future',
        quality      TEXT NOT NULL DEFAULT '1080p',
        last_checked TEXT
    );
    CREATE TABLE audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         TEXT NOT NULL,
        email      TEXT,
        profile_id INTEGER,
        action     TEXT NOT NULL,
        payload    TEXT
    );
    `,
    // v2 — library scanner: one item per (type, normalised title); match bookkeeping; file mtime
    `
    ALTER TABLE media_items ADD COLUMN norm TEXT;
    ALTER TABLE media_items ADD COLUMN match_tried_at TEXT;
    CREATE UNIQUE INDEX media_items_type_norm ON media_items(type, norm);
    ALTER TABLE media_files ADD COLUMN mtime INTEGER;
    `,
    // v3 — grabber: quality profiles + key/value settings
    `
    CREATE TABLE quality_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        name TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        config_json TEXT NOT NULL,
        sort INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
    // v4 — smart browse: TMDB id -> IMDb id (imdb_id NULL = TMDB has none; re-checked after 30 days)
    `
    CREATE TABLE tmdb_ids (
        kind TEXT NOT NULL,
        tmdb_id INTEGER NOT NULL,
        imdb_id TEXT,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (kind, tmdb_id)
    );
    `,
];

function openDb(dataPath, filename = 'cinema.db') {
    fs.mkdirSync(dataPath, { recursive: true });
    const file = filename === ':memory:' ? filename : path.join(dataPath, filename);
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

    const current = db.prepare('PRAGMA user_version').get().user_version;
    for (let v = current; v < MIGRATIONS.length; v++) {
        db.exec('BEGIN');
        try {
            db.exec(MIGRATIONS[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw new Error(`DB migration v${v + 1} failed: ${e.message}`);
        }
    }

    const now = () => new Date().toISOString();
    const upsertLogin = db.prepare(`
        INSERT INTO logins (email, first_seen, last_seen) VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen
        RETURNING email, disabled, quota_gb`);
    const insertAudit = db.prepare('INSERT INTO audit_log (ts, email, profile_id, action, payload) VALUES (?, ?, ?, ?, ?)');

    return {
        raw: db,
        schemaVersion: () => db.prepare('PRAGMA user_version').get().user_version,
        touchLogin: (email) => upsertLogin.get(email, now(), now()),
        audit: (email, profileId, action, payload) =>
            insertAudit.run(now(), email || null, profileId || null, action, payload == null ? null : JSON.stringify(payload)),
        close: () => db.close(),
    };
}

module.exports = { openDb, MIGRATIONS };
