'use strict';
// Cloudflare Access authentication.
//
// Identity is ONLY accepted from a Cloudflare Access JWT whose signature, issuer
// (and audience, when configured) have been verified against the team's JWKS.
// There is deliberately no `?email=` or hard-coded fallback: port 8080 is
// reachable on the LAN, so any unverified identity source is spoofable.
//
// Env:
//   CF_TEAM_DOMAIN   e.g. "myteam.cloudflareaccess.com"           (required)
//   CF_ACCESS_AUD    AUD tag(s) of the Access app(s), comma separated (strongly recommended)
//   ADMIN_EMAILS     comma separated list of admin login emails   (required for admin)
//   NODE_ENV=development + DEV_EMAIL=you@example.com  -> local dev bypass only

const { createRemoteJWKSet, jwtVerify } = require('jose');

const norm = (s) => String(s || '').trim().toLowerCase();

function loadConfig(env = process.env) {
    const team = String(env.CF_TEAM_DOMAIN || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
    return {
        team,
        // one AUD per Access application; several apps may front this server (cinema. + streamio.)
        aud: String(env.CF_ACCESS_AUD || '').split(',').map((x) => x.trim()).filter(Boolean),
        admins: String(env.ADMIN_EMAILS || '')
            .split(',')
            .map(norm)
            .filter(Boolean),
        devEmail: env.NODE_ENV === 'development' ? norm(env.DEV_EMAIL) : '',
    };
}

function cookieValue(header, name) {
    if (!header) return '';
    for (const part of String(header).split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return '';
}

function createAuth({ db, env = process.env, jwks } = {}) {
    const cfg = loadConfig(env);
    const keySet = jwks || (cfg.team ? createRemoteJWKSet(new URL(`https://${cfg.team}/cdn-cgi/access/certs`)) : null);
    const isAdminEmail = (email) => cfg.admins.includes(norm(email));

    if (!cfg.team && !cfg.devEmail) {
        console.error('[Auth] CF_TEAM_DOMAIN is not set: every /api request will be rejected (503). Set CF_TEAM_DOMAIN, CF_ACCESS_AUD and ADMIN_EMAILS.');
    } else if (cfg.team && !cfg.aud.length) {
        console.warn('[Auth] CF_ACCESS_AUD is not set: JWT audience is not being checked.');
    }
    if (cfg.team && !cfg.admins.length) {
        console.warn('[Auth] ADMIN_EMAILS is empty: nobody will have admin access.');
    }

    // Resolves to a verified lowercase email, or null. Never throws.
    async function verifiedEmail(req) {
        if (cfg.devEmail) return cfg.devEmail;
        if (!keySet) return null;
        const token = req.headers['cf-access-jwt-assertion'] || cookieValue(req.headers.cookie, 'CF_Authorization');
        if (!token) return null;
        try {
            const opts = { issuer: `https://${cfg.team}` };
            if (cfg.aud.length) opts.audience = cfg.aud;
            const { payload } = await jwtVerify(token, keySet, opts);
            return payload && payload.email ? norm(payload.email) : null;
        } catch (e) {
            return null;
        }
    }

    async function requireLogin(req, res, next) {
        if (!keySet && !cfg.devEmail) {
            return res.status(503).json({ error: 'auth_not_configured' });
        }
        const email = await verifiedEmail(req);
        if (!email) return res.status(401).json({ error: 'unauthorized' });
        try {
            const row = db ? db.touchLogin(email) : null;
            if (row && row.disabled) return res.status(403).json({ error: 'login_disabled' });
        } catch (e) {
            console.error('[Auth] touchLogin failed:', e.message);
        }
        req.login = { email, isAdmin: isAdminEmail(email) };
        next();
    }

    function requireAdmin(req, res, next) {
        if (!req.login || !req.login.isAdmin) return res.status(403).json({ error: 'admin_only' });
        next();
    }

    return { requireLogin, requireAdmin, verifiedEmail, isAdminEmail, config: cfg };
}

module.exports = { createAuth, loadConfig };
