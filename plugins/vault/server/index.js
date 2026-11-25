'use strict';
// Plugin "vault": the Locked folder. A folder of private videos (VAULT_DIR) behind its own passcode, for the admin login
// on the unlocked owner profile. It keeps its own index, thumbnails and resume points; its files never enter the core
// library, so no core route (library, search, calendar, copilot, stream-by-path) can list or serve them.
// Routes: /api/vault/* (server/routes.js). Settings: VAULT_DIR, VAULT_AUTOLOCK_MIN.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore, MIGRATIONS } = require('./store');
const { createSessions } = require('./secrets');
const { createThumbs } = require('./thumbs');
const { registerRoutes } = require('./routes');
const { under } = require('./media');

const SCAN_EVERY_MS = 6 * 3600 * 1000;
const THUMBS_DIR = '.cinema-thumbs';

const real = (p) => {
    try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); }
};

function loadSecret(dir) {
    const file = path.join(dir, 'secret.key');
    try {
        const s = fs.readFileSync(file, 'utf8').trim();
        if (s.length >= 32) return s;
    } catch (_) { /* first run */ }
    const fresh = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
    return fresh;
}

function register(ctx, { now = () => Date.now(), run, timers = true } = {}) {
    const dirSetting = String(ctx.config.get('VAULT_DIR', '') || '').trim();
    if (!dirSetting || !path.isAbsolute(dirSetting)) return ctx.disable('VAULT_DIR must be an absolute path inside the container');
    const root = path.resolve(dirSetting);

    // the vault must never overlap a folder core serves or scans, or core routes could list or stream its files
    const lib = ctx.services.library;
    const coreRoots = [...ctx.sdk.mediaRoots(), ...(lib && typeof lib.allowedRoots === 'function' ? lib.allowedRoots() : [])];
    const clash = coreRoots.find((r) => under(real(root), real(r)) || under(real(r), real(root)));
    if (clash) return ctx.disable(`VAULT_DIR overlaps ${clash} (MEDIA_ROOTS or a library folder): keep the locked folder separate`);

    ctx.db.migrate(MIGRATIONS);
    const autolockMin = Math.min(Math.max(ctx.config.int('VAULT_AUTOLOCK_MIN', 10), 1), 240);
    const data = ctx.dataDir();
    const store = createStore({ raw: ctx.db.raw, root, now });
    const sessions = createSessions({ secret: loadSecret(data), now, idleMs: autolockMin * 60 * 1000 });
    // thumbnails live on the locked drive (hidden, skipped by the scan), never in data/: backups of data/ may go to the cloud
    const thumbs = createThumbs({ dir: path.join(root, THUMBS_DIR), store, ...(run ? { run } : {}), log: ctx.log });

    let lastScan = 0;
    const rescan = ({ ifOlderThanMs = 0 } = {}) => {
        if (ifOlderThanMs && now() - lastScan < ifOlderThanMs) return;
        lastScan = now();
        setImmediate(() => {
            const t0 = Date.now();
            const st = store.scan();
            if (st.error) ctx.log.warn(`scan failed: ${st.error}`);
            else if (!st.online) ctx.log.info('scan skipped: folder not connected or no .cinema-root marker');
            else {
                ctx.log.info(`scan: ${st.files} videos in ${Date.now() - t0} ms (+${st.added} / -${st.removed})`); // counts only, never names
                thumbs.fill();
            }
        });
    };

    registerRoutes({ app: ctx.app, auth: ctx.auth, store, sessions, thumbs, audit: ctx.db.audit, now, autolockMin, rescan });

    if (timers) {
        setTimeout(() => rescan(), 20 * 1000).unref();
        setInterval(() => rescan(), SCAN_EVERY_MS).unref();
    }
    ctx.log.info(`locked folder at ${root}${store.online() ? '' : ' (not connected or no .cinema-root marker yet)'}`);
    return { store, sessions, thumbs, rescan };
}

module.exports = { register };
