'use strict';
// Imports legacy data/users/<email>.json into profiles + library blobs. Idempotent (keyed on created_by=email).
const fs = require('fs');
const path = require('path');

function displayName(email, { ownerName, adminEmails = [] } = {}) {
    if (ownerName && adminEmails[0] === email) return ownerName;
    const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    return local.replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

function importUsers({ raw, dataPath, ownerName, adminEmails = [], avatarFor = () => null }) {
    const dir = path.join(dataPath, 'users');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const find = raw.prepare('SELECT id FROM profiles WHERE created_by = ?');
    const add = raw.prepare('INSERT INTO profiles (name, avatar, created_by, created_at, sort) VALUES (?, ?, ?, ?, ?) RETURNING id');
    const put = raw.prepare('INSERT INTO profile_blobs (profile_id, key, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(profile_id, key) DO NOTHING');
    let created = 0;
    let existing = 0;
    let blobs = 0;
    raw.exec('BEGIN');
    try {
        files.forEach((f, i) => {
            const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            const email = String(data.email || f.replace(/\.json$/, '')).toLowerCase();
            let row = find.get(email);
            if (row) {
                existing++;
            } else {
                row = add.get(displayName(email, { ownerName, adminEmails }), avatarFor(i), email, new Date().toISOString(), i);
                created++;
            }
            for (const key of ['library', 'library_recent']) {
                if (data[key] != null) {
                    blobs += Number(put.run(row.id, key, JSON.stringify(data[key]), data.updatedAt || new Date().toISOString()).changes);
                }
            }
        });
        raw.exec('COMMIT');
    } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
    }
    return { created, existing, blobs, files: files.length };
}

module.exports = { importUsers, displayName };
