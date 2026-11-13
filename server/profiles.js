'use strict';
// Household profiles: PIN hashing/lockout, signed unlock tokens, preset avatar artwork.

const crypto = require('crypto');
const fs = require('fs');

const MAX_PROFILES = 8;
const MAX_PIN_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

// ---------- PIN ----------
function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}
function checkPin(pin, stored) {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const a = crypto.scryptSync(String(pin), salt, 32);
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const validPin = (pin) => /^\d{4}$/.test(String(pin || ''));

// ---------- unlock tokens (bound to profile + login email) ----------
function createTokens(secret, now = () => Date.now()) {
    const mac = (id, email, exp) => crypto.createHmac('sha256', secret).update(`ptok\n${id}\n${email}\n${exp}`).digest('base64url');
    return {
        issue(profileId, email) {
            const exp = now() + TOKEN_TTL_MS;
            return { token: `${profileId}.${exp}.${mac(profileId, email, exp)}`, expiresAt: new Date(exp).toISOString() };
        },
        verify(token, profileId, email) {
            const [id, exp, sig] = String(token || '').split('.');
            if (!id || !exp || !sig || String(id) !== String(profileId) || Number(exp) < now()) return false;
            const a = Buffer.from(sig);
            const b = Buffer.from(mac(id, email, Number(exp)));
            return a.length === b.length && crypto.timingSafeEqual(a, b);
        },
    };
}

// ---------- preset avatars (PNG files in server/avatars: original artwork, see scripts/brand/make-avatars.js) ----------
const PREFERRED = ['fox', 'panda', 'robot', 'owl'];
function loadPresetCatalog(dir) {
    let keys = [];
    try {
        keys = fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.png$/.test(f)).map((f) => f.slice(0, -4));
    } catch (_) {
        // no avatar directory: empty catalog
    }
    const rank = (k) => (PREFERRED.includes(k) ? PREFERRED.indexOf(k) : 99);
    keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return keys.map((key) => ({
        key,
        label: key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        url: `/api/avatars/preset/${key}.png`,
    }));
}

function safeJson(s) {
    try { return JSON.parse(s || '{}'); } catch (_) { return {}; }
}
const toPublic = (p) => ({
    id: p.id, name: p.name, avatar: p.avatar, isKid: !!p.is_kid, hasPin: !!p.pin_hash,
    accent: p.accent || null, settings: safeJson(p.settings_json),
});

module.exports = { MAX_PROFILES, MAX_PIN_FAILS, LOCK_MS, loadPresetCatalog, hashPin, checkPin, validPin, createTokens, toPublic, safeJson };
