'use strict';
// HTTP API of the Locked folder. Everything except /stream needs the admin login on the unlocked owner profile
// (ctx.auth.requireAdmin) AND an unlock session (X-Vault-Token, or ?vt= for <img> thumbnails).
// /stream needs a signed grant for that file, bound to the same login, while its session is unlocked: mpv in the Mac app
// only carries the Cloudflare login cookie, not the profile cookies. Every response is `private, no-store`.

const fs = require('fs');
const path = require('path');
const S = require('./secrets');
const { VIDEO, extOf, webPlayable, resolveInside, sendFile } = require('./media');

const SIDECAR_EXT = ['jpg', 'jpeg', 'png', 'webp', 'json', 'info.json', 'nfo', 'srt', 'vtt', 'description'];

function registerRoutes({ app, auth, store, sessions, thumbs, audit, now = () => Date.now(), autolockMin, rescan }) {
    const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
    const bad = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });
    const email = (req) => (req.login && req.login.email) || '';
    const tokenOf = (req) => req.get('x-vault-token') || (typeof req.query.vt === 'string' ? req.query.vt : '');
    const num = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

    function unlocked(req, res, next) {
        const s = sessions.check(tokenOf(req), email(req));
        if (!s) return bad(res, 401, 'vault_locked');
        req.vault = s;
        next();
    }
    const guard = [noStore, auth.requireAdmin];
    const open = [...guard, unlocked];

    // lockout after MAX_FAILS wrong passcodes, kept in the database so a restart does not reset it
    function lockedFor() {
        const c = store.config();
        return c.locked_until && c.locked_until > now() ? Math.ceil((c.locked_until - now()) / 1000) : 0;
    }
    function verify(code) {
        const c = store.config();
        if (S.checkPasscode(code, c.passcode_hash)) {
            store.setFails(0, null);
            return { ok: true };
        }
        const fails = c.fail_count + 1;
        const lock = fails >= S.MAX_FAILS;
        store.setFails(lock ? 0 : fails, lock ? now() + S.LOCK_MS : null);
        return lock ? { ok: false, status: 429, body: { retryAfterSec: S.LOCK_MS / 1000 }, error: 'locked' }
            : { ok: false, status: 401, body: { remaining: S.MAX_FAILS - fails }, error: 'bad_passcode' };
    }

    app.get('/api/vault/status', guard, (req, res) => {
        const c = store.config();
        const s = sessions.check(tokenOf(req), email(req));
        const out = {
            configured: !!c.passcode_hash, numeric: !!c.numeric, unlocked: !!s, lockedForSec: lockedFor(),
            online: store.online(), autolockMin, marker: store.MARKER,
        };
        if (s) Object.assign(out, store.counts(), { scan: store.status });
        res.json(out);
    });

    // first passcode, or a new one (needs the current passcode)
    app.post('/api/vault/setup', guard, (req, res) => {
        const b = req.body || {};
        const c = store.config();
        if (c.passcode_hash) {
            const wait = lockedFor();
            if (wait) return bad(res, 429, 'locked', { retryAfterSec: wait });
            const v = verify(b.currentPasscode);
            if (!v.ok) return bad(res, v.status, v.error, v.body);
        }
        const problem = S.passcodeProblem(b.passcode);
        if (problem) return bad(res, 400, problem);
        store.setPasscode(S.hashPasscode(b.passcode), S.isNumeric(b.passcode));
        sessions.closeAll(); // a new passcode locks every other open session
        audit(email(req), null, c.passcode_hash ? 'vault.passcode_change' : 'vault.passcode_set', null);
        const opened = sessions.open(email(req));
        rescan();
        res.json({ ...opened, numeric: S.isNumeric(b.passcode) });
    });

    app.post('/api/vault/unlock', guard, (req, res) => {
        const c = store.config();
        if (!c.passcode_hash) return bad(res, 409, 'not_configured');
        const wait = lockedFor();
        if (wait) return bad(res, 429, 'locked', { retryAfterSec: wait });
        const v = verify((req.body || {}).passcode);
        if (!v.ok) {
            audit(email(req), null, 'vault.unlock_failed', null);
            return bad(res, v.status, v.error, v.body);
        }
        audit(email(req), null, 'vault.unlock', null);
        const opened = sessions.open(email(req));
        rescan({ ifOlderThanMs: 10 * 60 * 1000 });
        res.json(opened);
    });

    app.post('/api/vault/lock', guard, (req, res) => {
        const s = sessions.check(tokenOf(req), email(req));
        if (s) sessions.close(s.id);
        res.json({ locked: true });
    });

    // one folder level: its sub-folders and its videos; ?q= searches every video by name instead
    app.get('/api/vault/browse', open, (req, res) => {
        const folder = typeof req.query.folder === 'string' ? req.query.folder.replace(/^\/+|\/+$/g, '') : '';
        const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
        const sort = typeof req.query.sort === 'string' ? req.query.sort : 'date';
        res.json({
            folder,
            search,
            folders: search ? [] : store.folders(folder),
            files: store.files({ folder, search, sort, limit: req.query.limit, offset: req.query.offset }),
            online: store.online(),
            scan: store.status,
        });
    });

    app.get('/api/vault/thumb/:id', open, async (req, res) => {
        const id = num(req.params.id);
        if (!id) return bad(res, 404, 'not_found');
        const file = await thumbs.ensure(id);
        if (!file) return bad(res, 404, 'no_thumbnail');
        return sendFile(req, res, file, 'image/jpeg');
    });

    // a signed stream URL for the player (and mpv); it dies with the unlock session
    app.get('/api/vault/link/:id', open, (req, res) => {
        const row = store.get(num(req.params.id));
        if (!row) return bad(res, 404, 'not_found');
        const g = sessions.grant(req.vault.id, row.id, email(req));
        res.json({
            url: `/api/vault/stream/${row.id}?g=${encodeURIComponent(g)}&cinema_private=1`,
            webPlayable: webPlayable(row.name),
            progress: store.progress(row.id),
        });
    });

    app.get('/api/vault/stream/:id', noStore, (req, res) => {
        const id = num(req.params.id);
        if (!id || !sessions.checkGrant(req.query.g, id, email(req))) return bad(res, 401, 'vault_locked');
        const row = store.get(id);
        const file = row ? resolveInside(store.root, row.rel_path) : null;
        if (!file) return bad(res, 404, 'not_found');
        return sendFile(req, res, file, VIDEO[extOf(row.name)]);
    });

    // private resume points: the player reports with the grant from its URL (it has no vault token after a reload)
    app.get('/api/vault/progress/:id', noStore, (req, res) => {
        const id = num(req.params.id);
        if (!id || !sessions.checkGrant(req.query.g, id, email(req))) return bad(res, 401, 'vault_locked');
        res.json({ progress: store.progress(id) });
    });
    app.post('/api/vault/progress/:id', noStore, (req, res) => {
        const id = num(req.params.id);
        const b = req.body || {};
        if (!id || !sessions.checkGrant(b.g, id, email(req))) return bad(res, 401, 'vault_locked');
        if (!store.get(id)) return bad(res, 404, 'not_found');
        const pos = Number(b.positionMs);
        const dur = Number(b.durationMs);
        if (!Number.isFinite(pos) || pos < 0) return bad(res, 400, 'bad_position');
        // finished (or nearly): start from the beginning next time
        const done = Number.isFinite(dur) && dur > 0 && pos >= dur * 0.95;
        store.setProgress(id, done ? 0 : pos, Number.isFinite(dur) ? dur : null);
        res.json({ ok: true });
    });

    app.delete('/api/vault/files/:id', open, (req, res) => {
        const row = store.get(num(req.params.id));
        if (!row) return bad(res, 404, 'not_found');
        const file = resolveInside(store.root, row.rel_path);
        if (file) {
            try {
                fs.unlinkSync(file);
            } catch (_) {
                return bad(res, 500, 'delete_failed');
            }
            // the same-name cover image / info file some downloaders leave next to a video
            const base = file.slice(0, file.length - path.extname(file).length);
            for (const ext of SIDECAR_EXT) {
                const side = `${base}.${ext}`;
                if (resolveInside(store.root, path.relative(store.root, side))) {
                    try { fs.unlinkSync(side); } catch (_) { /* not there */ }
                }
            }
        }
        store.remove(row.id);
        thumbs.remove(row.id);
        audit(email(req), null, 'vault.delete', null); // no names in the activity log
        res.json({ success: true });
    });

    app.post('/api/vault/rescan', open, (_req, res) => {
        rescan();
        res.status(202).json({ running: true });
    });
}

module.exports = { registerRoutes };
