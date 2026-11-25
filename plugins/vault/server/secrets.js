'use strict';
// Locked folder secrets: the passcode (scrypt), unlock sessions (memory only: a restart locks everything) and per-file
// stream grants. A session token and a grant are both bound to the login email, so neither works for another login.
//
//   token = <session id>.<hmac(session id, email)>                   sent as X-Vault-Token (or ?vt= for <img> thumbnails)
//   grant = <session id>.<expiry s>.<hmac(session id, file, email, expiry)>   in the stream URL (?g=), for the player and mpv
//
// A session dies after `idleMs` without use (auto-lock), after `maxMs` in all, or on Lock; its grants die with it.

const crypto = require('crypto');

const MIN_LEN = 6;
const MAX_LEN = 64;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

function hashPasscode(code) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(String(code), salt, 32).toString('hex')}`;
}

function checkPasscode(code, stored) {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash || typeof code !== 'string') return false;
    const a = crypto.scryptSync(code, salt, 32);
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** null when fine, else the reason. */
function passcodeProblem(code) {
    if (typeof code !== 'string') return 'passcode_required';
    if (code.length < MIN_LEN) return 'passcode_too_short';
    if (code.length > MAX_LEN) return 'passcode_too_long';
    if (code.trim() !== code) return 'passcode_spaces';
    return null;
}

const isNumeric = (code) => /^\d+$/.test(String(code || ''));

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createSessions({ secret, now = () => Date.now(), idleMs = 10 * 60 * 1000, maxMs = 12 * 3600 * 1000, grantTtlS = 6 * 3600 } = {}) {
    if (!secret) throw new Error('vault secret required');
    const mac = (...parts) => crypto.createHmac('sha256', secret).update(parts.join('\n')).digest('base64url');
    const sessions = new Map(); // id -> { email, createdAt, lastSeen }

    const alive = (s, t) => s && t - s.lastSeen <= idleMs && t - s.createdAt <= maxMs;
    const prune = () => {
        const t = now();
        for (const [id, s] of sessions) if (!alive(s, t)) sessions.delete(id);
    };

    function open(email) {
        prune();
        const id = crypto.randomBytes(12).toString('base64url');
        const t = now();
        sessions.set(id, { email, createdAt: t, lastSeen: t });
        return { token: `${id}.${mac('vtok', id, email)}`, idleMs };
    }

    /** The session behind a token, refreshed (it counts as activity); null when locked, expired or not this login's. */
    function check(token, email) {
        const [id, sig] = String(token || '').split('.');
        if (!id || !sig || !safeEqual(sig, mac('vtok', id, email))) return null;
        const s = sessions.get(id);
        const t = now();
        if (!alive(s, t) || s.email !== email) {
            sessions.delete(id);
            return null;
        }
        s.lastSeen = t;
        return { id, ...s };
    }

    function grant(sessionId, fileId, email) {
        const exp = Math.floor(now() / 1000) + grantTtlS;
        return `${sessionId}.${exp}.${mac('vgrant', sessionId, String(fileId), email, exp)}`;
    }

    /** True when the grant is for this file and login, unexpired, and its session is still unlocked (refreshes it). */
    function checkGrant(g, fileId, email) {
        const [id, exp, sig] = String(g || '').split('.');
        const e = Number(exp);
        if (!id || !sig || !Number.isInteger(e) || e < Math.floor(now() / 1000)) return false;
        if (!safeEqual(sig, mac('vgrant', id, String(fileId), email, e))) return false;
        const s = sessions.get(id);
        const t = now();
        if (!alive(s, t) || s.email !== email) return false;
        s.lastSeen = t;
        return true;
    }

    const close = (id) => sessions.delete(id);
    const closeAll = () => sessions.clear();
    const count = () => { prune(); return sessions.size; };

    return { open, check, grant, checkGrant, close, closeAll, count };
}

module.exports = { hashPasscode, checkPasscode, passcodeProblem, isNumeric, createSessions, MIN_LEN, MAX_FAILS, LOCK_MS };
