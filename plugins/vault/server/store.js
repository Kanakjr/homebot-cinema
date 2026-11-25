'use strict';
// The Locked folder's own index and settings (plugin tables). Its files never enter the core library tables, so no core
// route (library, search, calendar, copilot, admin overview) can list them.

const fs = require('fs');
const path = require('path');
const { isVideo, MIN_BYTES } = require('./media');

const MARKER = '.cinema-root';
const MAX_SEARCH = 300;

const MIGRATIONS = [
    `
    CREATE TABLE vault_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        passcode_hash TEXT,
        numeric INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER,
        updated_at TEXT
    );
    INSERT INTO vault_config (id) VALUES (1);
    CREATE TABLE vault_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rel_path TEXT NOT NULL UNIQUE,
        folder TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        duration_ms INTEGER,
        thumb_state INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL
    );
    CREATE INDEX vault_files_folder ON vault_files(folder);
    CREATE TABLE vault_progress (
        file_id INTEGER PRIMARY KEY,
        position_ms INTEGER NOT NULL,
        duration_ms INTEGER,
        updated_at TEXT NOT NULL
    );
    `,
];

const SORTS = {
    date: 'mtime DESC, name COLLATE NOCASE',
    name: 'name COLLATE NOCASE, mtime DESC',
    size: 'size DESC, name COLLATE NOCASE',
    length: 'COALESCE(duration_ms, 0) DESC, name COLLATE NOCASE',
};

const shapeFile = (r, progress) => ({
    id: r.id, name: r.name, folder: r.folder, size: r.size, mtime: r.mtime, durationMs: r.duration_ms,
    thumb: r.thumb_state >= 0, positionMs: progress ? progress.position_ms : null,
});

function createStore({ raw, root, now = () => Date.now() }) {
    const q = {
        config: raw.prepare('SELECT * FROM vault_config WHERE id = 1'),
        setPasscode: raw.prepare('UPDATE vault_config SET passcode_hash = ?, numeric = ?, fail_count = 0, locked_until = NULL, updated_at = ? WHERE id = 1'),
        setFails: raw.prepare('UPDATE vault_config SET fail_count = ?, locked_until = ? WHERE id = 1'),
        upsert: raw.prepare(`INSERT INTO vault_files (rel_path, folder, name, size, mtime, added_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(rel_path) DO UPDATE SET
                thumb_state = CASE WHEN vault_files.size != excluded.size OR vault_files.mtime != excluded.mtime THEN 0 ELSE vault_files.thumb_state END,
                duration_ms = CASE WHEN vault_files.size != excluded.size OR vault_files.mtime != excluded.mtime THEN NULL ELSE vault_files.duration_ms END,
                size = excluded.size, mtime = excluded.mtime`),
        get: raw.prepare('SELECT * FROM vault_files WHERE id = ?'),
        allPaths: raw.prepare('SELECT id, rel_path FROM vault_files'),
        del: raw.prepare('DELETE FROM vault_files WHERE id = ?'),
        delProgress: raw.prepare('DELETE FROM vault_progress WHERE file_id = ?'),
        folders: raw.prepare('SELECT folder, COUNT(*) n, MAX(mtime) latest FROM vault_files GROUP BY folder'),
        cover: raw.prepare('SELECT id FROM vault_files WHERE folder = ? OR folder LIKE ? ESCAPE \'\\\' ORDER BY thumb_state DESC, mtime DESC LIMIT 1'),
        progress: raw.prepare('SELECT * FROM vault_progress WHERE file_id = ?'),
        setProgress: raw.prepare(`INSERT INTO vault_progress (file_id, position_ms, duration_ms, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(file_id) DO UPDATE SET position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, updated_at = excluded.updated_at`),
        setThumb: raw.prepare('UPDATE vault_files SET thumb_state = ?, duration_ms = COALESCE(?, duration_ms) WHERE id = ?'),
        pendingThumbs: raw.prepare('SELECT * FROM vault_files WHERE thumb_state = 0 ORDER BY mtime DESC LIMIT ?'),
        counts: raw.prepare('SELECT COUNT(*) files, COALESCE(SUM(size), 0) bytes FROM vault_files'),
    };
    const status = { running: false, finishedAt: null, files: 0, added: 0, removed: 0, error: null, online: null };

    /** Online = the folder can be listed AND holds the marker (an empty, unmounted mount point is never "everything deleted"). */
    function online() {
        try {
            fs.readdirSync(root);
            return fs.existsSync(path.join(root, MARKER));
        } catch (_) {
            return false;
        }
    }

    function walk(errors) {
        const found = [];
        const stack = [''];
        while (stack.length) {
            const rel = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
            } catch (_) {
                errors.push(rel);
                continue;
            }
            for (const e of entries) {
                if (e.name.startsWith('.')) continue; // hidden files, macOS "._" resource forks, the marker
                const childRel = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) { stack.push(childRel); continue; }
                if (!e.isFile() || !isVideo(e.name)) continue;
                let st;
                try {
                    st = fs.statSync(path.join(root, childRel));
                } catch (_) {
                    continue;
                }
                if (st.size < MIN_BYTES) continue;
                found.push({ rel: childRel, folder: rel, name: e.name, size: st.size, mtime: Math.floor(st.mtimeMs) });
            }
        }
        return found;
    }

    /** Re-reads the folder. Rows of files that are gone are dropped only after a clean walk of an online folder. */
    function scan() {
        if (status.running) return status;
        Object.assign(status, { running: true, error: null });
        try {
            status.online = online();
            if (!status.online) return status;
            const errors = [];
            const files = walk(errors);
            const before = new Map(q.allPaths.all().map((r) => [r.rel_path, r.id]));
            const iso = new Date(now()).toISOString();
            const seen = new Set();
            let added = 0;
            let removed = 0;
            raw.exec('BEGIN');
            try {
                for (const f of files) {
                    if (!before.has(f.rel)) added += 1;
                    q.upsert.run(f.rel, f.folder, f.name, f.size, f.mtime, iso);
                    seen.add(f.rel);
                }
                if (!errors.length) {
                    for (const [rel, id] of before) {
                        if (seen.has(rel)) continue;
                        q.del.run(id);
                        q.delProgress.run(id);
                        removed += 1;
                    }
                }
                raw.exec('COMMIT');
            } catch (e) {
                raw.exec('ROLLBACK');
                throw e;
            }
            Object.assign(status, { files: files.length, added, removed, walkErrors: errors.length });
        } catch (e) {
            status.error = e.message;
        } finally {
            status.running = false;
            status.finishedAt = new Date(now()).toISOString();
        }
        return status;
    }

    /** Direct sub-folders of `parent` ('' = top): name, path, videos inside (all levels), newest change, a cover file. */
    function folders(parent = '') {
        const prefix = parent ? `${parent}/` : '';
        const children = new Map();
        for (const r of q.folders.all()) {
            if (r.folder === parent || (parent && !r.folder.startsWith(prefix))) continue;
            const rest = r.folder.slice(prefix.length);
            if (!rest) continue;
            const name = rest.split('/')[0];
            const c = children.get(name) || { name, path: prefix + name, count: 0, latest: 0 };
            c.count += r.n;
            c.latest = Math.max(c.latest, r.latest || 0);
            children.set(name, c);
        }
        const esc = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
        return [...children.values()]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            .map((c) => {
                const cover = q.cover.get(c.path, `${esc(c.path)}/%`);
                return { ...c, coverId: cover ? cover.id : null };
            });
    }

    function files({ folder = '', search = '', sort = 'date', limit = 500, offset = 0 } = {}) {
        const order = SORTS[sort] || SORTS.date;
        const lim = Math.min(Math.max(1, Number(limit) || 500), 1000);
        const off = Math.max(0, Number(offset) || 0);
        const rows = search
            ? raw.prepare(`SELECT * FROM vault_files WHERE name LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT ?`).all(`%${String(search).replace(/[\\%_]/g, (m) => `\\${m}`)}%`, MAX_SEARCH)
            : raw.prepare(`SELECT * FROM vault_files WHERE folder = ? ORDER BY ${order} LIMIT ? OFFSET ?`).all(folder, lim, off);
        return rows.map((r) => shapeFile(r, q.progress.get(r.id)));
    }

    return {
        MARKER,
        root,
        status,
        online,
        scan,
        folders,
        files,
        get: (id) => q.get.get(id) || null,
        remove(id) {
            q.del.run(id);
            q.delProgress.run(id);
        },
        counts: () => q.counts.get(),
        config: () => q.config.get(),
        setPasscode: (hash, numeric) => q.setPasscode.run(hash, numeric ? 1 : 0, new Date(now()).toISOString()),
        setFails: (count, lockedUntil) => q.setFails.run(count, lockedUntil || null),
        progress: (id) => {
            const p = q.progress.get(id);
            return p ? { positionMs: p.position_ms, durationMs: p.duration_ms, updatedAt: p.updated_at } : null;
        },
        setProgress: (id, positionMs, durationMs) => q.setProgress.run(id, Math.max(0, Math.round(positionMs)), Number.isFinite(durationMs) ? Math.round(durationMs) : null, new Date(now()).toISOString()),
        setThumb: (id, state, durationMs) => q.setThumb.run(state, Number.isFinite(durationMs) ? durationMs : null, id),
        pendingThumbs: (limit = 20) => q.pendingThumbs.all(limit),
    };
}

module.exports = { createStore, MIGRATIONS, MARKER, shapeFile };
