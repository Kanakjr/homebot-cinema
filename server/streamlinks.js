'use strict';
// Signed, expiring links for /api/downloads/stream/<id>.
// These let external players (VLC, Infuse, IINA) fetch a file through the Cloudflare Access
// bypass for that path without a login cookie. The HMAC covers only (id, exp), so extra query
// params such as ?raw=1 / ?download=1 can be appended freely.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_SECONDS = 12 * 3600;

function loadSecret(dataPath, env = process.env) {
    if (env.STREAM_LINK_SECRET && env.STREAM_LINK_SECRET.length >= 16) return env.STREAM_LINK_SECRET;
    const file = path.join(dataPath, 'stream_secret.key');
    try {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing.length >= 32) return existing;
    } catch (_) { /* generate below */ }
    const fresh = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataPath, { recursive: true });
    fs.writeFileSync(file, fresh + '\n', { mode: 0o600 });
    return fresh;
}

function createStreamLinks({ secret, now = () => Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS }) {
    if (!secret) throw new Error('stream link secret required');
    const mac = (id, exp) => crypto.createHmac('sha256', secret).update(`${id}\n${exp}`).digest('base64url');

    function sign(id) {
        const exp = Math.floor(now() / 1000) + ttlSeconds;
        return { exp, sig: mac(String(id), exp) };
    }

    function verify(id, exp, sig) {
        const e = Number(exp);
        if (!id || !sig || !Number.isInteger(e)) return false;
        if (e < Math.floor(now() / 1000)) return false;
        const a = Buffer.from(String(sig));
        const b = Buffer.from(mac(String(id), e));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    return { sign, verify };
}

module.exports = { createStreamLinks, loadSecret, DEFAULT_TTL_SECONDS };
