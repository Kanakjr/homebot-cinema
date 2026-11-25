#!/usr/bin/env node
'use strict';
// Forgot the Locked folder passcode? Run this on the server itself (never run by the app):
//   docker exec homebot-cinema node plugins/vault/scripts/reset-passcode.js
// It clears the passcode and the lockout. Nothing in the folder is touched. The next time the admin opens the Locked
// folder on the owner profile they set a new passcode. Restart the app afterwards to close sessions that are still open.

/* eslint-disable no-console */ // a command-line tool: it talks to the person running it
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.resolve(process.env.CINEMA_DATA_DIR || path.join(__dirname, '..', '..', '..', 'data'));
const db = new DatabaseSync(path.join(dataDir, 'cinema.db'));
try {
    const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'vault_config');
    if (!row) {
        console.log('The Locked folder has never been set up on this server: nothing to reset.');
        process.exit(0);
    }
    db.prepare('UPDATE vault_config SET passcode_hash = NULL, numeric = 0, fail_count = 0, locked_until = NULL, updated_at = ? WHERE id = 1')
        .run(new Date().toISOString());
    db.prepare('INSERT INTO audit_log (ts, email, profile_id, action, payload) VALUES (?, NULL, NULL, ?, NULL)')
        .run(new Date().toISOString(), 'vault.passcode_reset');
    console.log('Locked folder passcode cleared. Restart the app, then set a new passcode from the Locked folder tile.');
} finally {
    db.close();
}
