'use strict';
// Household profiles API. Every route is behind the Cloudflare login gate (req.login is set).
// Profiles are universal: any login may list/pick/create; only admin may delete or bypass a PIN.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const P = require('./profiles');
const { importUsers } = require('./migrate_users');

const NAME_MAX = 24;
const AVATAR_MAX_BYTES = 400 * 1024;
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

function registerProfileRoutes(app, { db, secret, dataPath, ownerName = '', adminEmails = [], presetDir = path.join(__dirname, 'avatars') }) {
    const raw = db.raw;
    const tokens = P.createTokens(secret);
    const avatarDir = path.join(dataPath, 'avatars');
    const catalog = P.loadPresetCatalog(presetDir);
    const presetUrls = new Set(catalog.map((c) => c.url));
    const presetAt = (i) => (catalog.length ? catalog[i % catalog.length].url : null);

    // First start after upgrade: turn legacy per-email libraries into profiles.
    if (raw.prepare('SELECT COUNT(*) c FROM profiles').get().c === 0) {
        try {
            const r = importUsers({
                raw, dataPath, ownerName, adminEmails,
                avatarFor: presetAt,
            });
            if (r.created) console.info(`[Profiles] imported ${r.created} legacy user(s) as profiles`);
        } catch (e) {
            console.error('[Profiles] legacy import failed:', e.message);
        }
    }

    // Profiles still pointing at a removed placeholder avatar get a catalog avatar.
    raw.prepare('SELECT id, avatar FROM profiles ORDER BY sort, id').all().forEach((p, i) => {
        if (p.avatar && !presetUrls.has(p.avatar) && !/^\/api\/avatars\/file\//.test(p.avatar) && catalog.length) {
            raw.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(presetAt(i), p.id);
        }
    });

    const getProfile = (id) => raw.prepare('SELECT * FROM profiles WHERE id = ?').get(Number(id));
    const count = () => raw.prepare('SELECT COUNT(*) c FROM profiles').get().c;
    const tokenOk = (req, p) => tokens.verify(req.headers['x-profile-token'], p.id, req.login.email);
    const canManage = (req, p) => req.login.isAdmin || !p.pin_hash || tokenOk(req, p);
    const bad = (res, code, error, extra = {}) => res.status(code).json({ error, ...extra });

    function validName(name) {
        const n = String(name || '').trim();
        return n.length >= 1 && n.length <= NAME_MAX ? n : null;
    }
    const validAvatar = (a) => typeof a === 'string' && (presetUrls.has(a) || /^\/api\/avatars\/file\/[a-f0-9]{16}\.(png|jpg|webp)$/.test(a));

    // Resolves the active profile for per-profile sync routes.
    function requireProfile(req, res, next) {
        const p = getProfile(req.headers['x-profile-id']);
        if (!p) return bad(res, 400, 'no_profile');
        if (p.pin_hash && !tokenOk(req, p)) return bad(res, 423, 'profile_locked');
        req.profile = p;
        next();
    }

    // ---- profiles ----
    app.get('/api/profiles', (_req, res) => {
        res.json(raw.prepare('SELECT * FROM profiles ORDER BY sort, id').all().map(P.toPublic));
    });

    app.post('/api/profiles', (req, res) => {
        const name = validName(req.body && req.body.name);
        if (!name) return bad(res, 400, 'invalid_name');
        if (count() >= P.MAX_PROFILES) return bad(res, 409, 'profile_limit', { max: P.MAX_PROFILES });
        const avatar = validAvatar(req.body.avatar) ? req.body.avatar : presetAt(count());
        let pinHash = null;
        if (req.body.pin != null && req.body.pin !== '') {
            if (!P.validPin(req.body.pin)) return bad(res, 400, 'invalid_pin');
            pinHash = P.hashPin(req.body.pin);
        }
        const row = raw.prepare(`INSERT INTO profiles (name, avatar, pin_hash, is_kid, created_by, created_at, sort)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
            .get(name, avatar, pinHash, req.body.isKid ? 1 : 0, req.login.email, new Date().toISOString(), count());
        db.audit(req.login.email, row.id, 'profile.create', { name });
        res.status(201).json(P.toPublic(row));
    });

    app.patch('/api/profiles/:id', (req, res) => {
        const p = getProfile(req.params.id);
        if (!p) return bad(res, 404, 'not_found');
        if (!canManage(req, p)) return bad(res, 423, 'profile_locked');
        const b = req.body || {};
        let { name, avatar, is_kid, accent, settings_json } = p;
        if (b.name !== undefined) { name = validName(b.name); if (!name) return bad(res, 400, 'invalid_name'); }
        if (b.avatar !== undefined) { if (!validAvatar(b.avatar)) return bad(res, 400, 'invalid_avatar'); avatar = b.avatar; }
        if (b.isKid !== undefined) is_kid = b.isKid ? 1 : 0;
        if (b.accent !== undefined) accent = b.accent === null ? null : String(b.accent).slice(0, 16);
        if (b.settings !== undefined) {
            const merged = JSON.stringify({ ...P.safeJson(settings_json), ...(typeof b.settings === 'object' && b.settings ? b.settings : {}) });
            if (merged.length > 4096) return bad(res, 413, 'settings_too_large');
            settings_json = merged;
        }
        raw.prepare('UPDATE profiles SET name=?, avatar=?, is_kid=?, accent=?, settings_json=? WHERE id=?')
            .run(name, avatar, is_kid, accent, settings_json, p.id);
        res.json(P.toPublic(getProfile(p.id)));
    });

    app.delete('/api/profiles/:id', (req, res) => {
        if (!req.login.isAdmin) return bad(res, 403, 'admin_only');
        const p = getProfile(req.params.id);
        if (!p) return bad(res, 404, 'not_found');
        if (count() <= 1) return bad(res, 409, 'last_profile');
        raw.prepare('DELETE FROM profiles WHERE id = ?').run(p.id);
        db.audit(req.login.email, p.id, 'profile.delete', { name: p.name });
        res.json({ success: true });
    });

    // ---- PIN ----
    app.post('/api/profiles/:id/unlock', (req, res) => {
        const p = getProfile(req.params.id);
        if (!p) return bad(res, 404, 'not_found');
        const now = Date.now();
        if (p.pin_locked_until && p.pin_locked_until > now) {
            return bad(res, 429, 'locked', { retryAfterSec: Math.ceil((p.pin_locked_until - now) / 1000) });
        }
        if (p.pin_hash) {
            if (!P.checkPin(req.body && req.body.pin, p.pin_hash)) {
                const fails = p.pin_fail_count + 1;
                const lock = fails >= P.MAX_PIN_FAILS;
                raw.prepare('UPDATE profiles SET pin_fail_count=?, pin_locked_until=? WHERE id=?')
                    .run(lock ? 0 : fails, lock ? now + P.LOCK_MS : null, p.id);
                return lock
                    ? bad(res, 429, 'locked', { retryAfterSec: P.LOCK_MS / 1000 })
                    : bad(res, 401, 'bad_pin', { remaining: P.MAX_PIN_FAILS - fails });
            }
            raw.prepare('UPDATE profiles SET pin_fail_count=0, pin_locked_until=NULL WHERE id=?').run(p.id);
        }
        res.json(tokens.issue(p.id, req.login.email));
    });

    app.post('/api/profiles/:id/pin', (req, res) => {
        const p = getProfile(req.params.id);
        if (!p) return bad(res, 404, 'not_found');
        const b = req.body || {};
        if (!P.validPin(b.pin)) return bad(res, 400, 'invalid_pin');
        if (!req.login.isAdmin && p.pin_hash && !P.checkPin(b.currentPin, p.pin_hash)) return bad(res, 401, 'bad_pin');
        raw.prepare('UPDATE profiles SET pin_hash=?, pin_fail_count=0, pin_locked_until=NULL WHERE id=?').run(P.hashPin(b.pin), p.id);
        db.audit(req.login.email, p.id, 'profile.pin_set', null);
        res.json({ success: true, ...tokens.issue(p.id, req.login.email) });
    });

    app.post('/api/profiles/:id/pin/remove', (req, res) => {
        const p = getProfile(req.params.id);
        if (!p) return bad(res, 404, 'not_found');
        if (!req.login.isAdmin && p.pin_hash && !P.checkPin(req.body && req.body.currentPin, p.pin_hash)) return bad(res, 401, 'bad_pin');
        raw.prepare('UPDATE profiles SET pin_hash=NULL, pin_fail_count=0, pin_locked_until=NULL WHERE id=?').run(p.id);
        db.audit(req.login.email, p.id, 'profile.pin_remove', null);
        res.json({ success: true });
    });

    // ---- avatars ----
    app.get('/api/avatars', (_req, res) => {
        res.json(catalog);
    });
    app.get('/api/avatars/preset/:file', (req, res) => {
        const m = /^([a-z0-9-]+)\.png$/.exec(req.params.file);
        if (!m || !catalog.some((c) => c.key === m[1])) return res.status(404).end();
        res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800', 'X-Content-Type-Options': 'nosniff' })
            .sendFile(path.join(presetDir, `${m[1]}.png`));
    });
    app.post('/api/avatars', (req, res) => {
        const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.dataUrl) || '');
        if (!m) return bad(res, 400, 'invalid_image');
        const buf = Buffer.from(m[2], 'base64');
        if (!buf.length || buf.length > AVATAR_MAX_BYTES) return bad(res, 413, 'image_too_large', { maxBytes: AVATAR_MAX_BYTES });
        const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${MIME_EXT[m[1]]}`;
        fs.mkdirSync(avatarDir, { recursive: true });
        fs.writeFileSync(path.join(avatarDir, name), buf);
        res.status(201).json({ url: `/api/avatars/file/${name}` });
    });
    app.get('/api/avatars/file/:name', (req, res) => {
        const m = /^[a-f0-9]{16}\.(png|jpg|webp)$/.exec(req.params.name);
        if (!m) return res.status(404).end();
        const file = path.join(avatarDir, req.params.name);
        if (!fs.existsSync(file)) return res.status(404).end();
        res.set({ 'Content-Type': EXT_MIME[m[1]], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).sendFile(file);
    });

    // ---- per-profile sync (headers: X-Profile-Id [+ X-Profile-Token when the profile has a PIN]) ----
    const getBlob = raw.prepare('SELECT json, updated_at FROM profile_blobs WHERE profile_id = ? AND key = ?');
    const putBlob = raw.prepare(`INSERT INTO profile_blobs (profile_id, key, json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`);

    app.get('/api/sync/library', requireProfile, (req, res) => {
        const out = { profileId: req.profile.id, library: null, library_recent: null, updatedAt: null };
        for (const key of ['library', 'library_recent']) {
            const row = getBlob.get(req.profile.id, key);
            if (row) {
                try { out[key] = JSON.parse(row.json); } catch (_) { /* corrupt blob: treat as empty */ }
                if (!out.updatedAt || row.updated_at > out.updatedAt) out.updatedAt = row.updated_at;
            }
        }
        res.json(out);
    });

    app.post('/api/sync/library', requireProfile, (req, res) => {
        const now = new Date().toISOString();
        for (const key of ['library', 'library_recent']) {
            const v = req.body && req.body[key];
            if (v && typeof v === 'object') putBlob.run(req.profile.id, key, JSON.stringify(v), now);
        }
        res.json({ success: true, updatedAt: now });
    });

    app.get('/api/sync/settings', requireProfile, (req, res) => {
        res.json(P.toPublic(req.profile));
    });
    app.patch('/api/sync/settings', requireProfile, (req, res) => {
        const b = req.body || {};
        const merged = JSON.stringify({ ...P.safeJson(req.profile.settings_json), ...(typeof b.settings === 'object' && b.settings ? b.settings : {}) });
        if (merged.length > 4096) return bad(res, 413, 'settings_too_large');
        raw.prepare('UPDATE profiles SET accent=?, settings_json=? WHERE id=?')
            .run(b.accent === undefined ? req.profile.accent : (b.accent === null ? null : String(b.accent).slice(0, 16)), merged, req.profile.id);
        res.json(P.toPublic(getProfile(req.profile.id)));
    });

    return { requireProfile, getProfile };
}

module.exports = { registerProfileRoutes };
