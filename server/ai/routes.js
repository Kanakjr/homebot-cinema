'use strict';
// AI copilot API. Behind the Cloudflare login gate; chat and staged actions also need the active household profile
// (X-Profile-Id, plus the PIN token when the profile has a PIN), the same rule as the per-profile sync routes.

const { queueRelease } = require('../grabber/grab');
const { scopeLabel } = require('../sentinel_state');

const MAX_USER_CHARS = 1000;
const MAX_ASSISTANT_CHARS = 4000;
const MAX_MESSAGES_IN = 60;

/** Sliding-window limiter per login: `perWindow` turns per `windowMs` and `perDay` per day. Memory only. */
function createRateLimit({ perWindow = 30, windowMs = 10 * 60 * 1000, perDay = 200, now = () => Date.now() } = {}) {
    const hits = new Map();
    return function hit(key) {
        const t = now();
        const list = (hits.get(key) || []).filter((x) => t - x < 24 * 3600 * 1000);
        const inWindow = list.filter((x) => t - x < windowMs);
        if (inWindow.length >= perWindow) { hits.set(key, list); return { ok: false, retryAfterSec: Math.max(1, Math.ceil((inWindow[0] + windowMs - t) / 1000)) }; }
        if (list.length >= perDay) { hits.set(key, list); return { ok: false, retryAfterSec: Math.max(60, Math.ceil((list[0] + 24 * 3600 * 1000 - t) / 1000)) }; }
        list.push(t);
        hits.set(key, list);
        if (hits.size > 500) hits.delete(hits.keys().next().value);
        return { ok: true };
    };
}

function cleanMessages(body) {
    const arr = body && body.messages;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > MAX_MESSAGES_IN) return null;
    const out = [];
    for (const m of arr) {
        const role = m && m.role === 'assistant' ? 'assistant' : m && m.role === 'user' ? 'user' : null;
        if (!role || typeof m.content !== 'string') return null;
        const content = m.content.trim().slice(0, role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS);
        if (content) out.push({ role, content });
    }
    const last = out[out.length - 1];
    if (!last || last.role !== 'user') return null;
    if (String(arr[arr.length - 1].content).trim().length > MAX_USER_CHARS) return { tooLong: true };
    return out;
}

function registerAiRoutes(app, { requireProfile, gemini, agent, staging, downloadsManager, sentinel, db, rateLimit = createRateLimit() }) {
    const send = (res, status, body) => { res.set('Cache-Control', 'private, no-store'); return res.status(status).json(body); };
    const fail = (res, e) => {
        const status = e.status || 500;
        if (status >= 500 && status !== 502 && status !== 503) console.error('[AI]', e.message);
        // coded errors are safe to show; anything unexpected is not
        return send(res, status, { error: e.status ? e.message : 'ai_failed' });
    };
    const ownerOf = (req) => ({ email: req.login.email, profileId: req.profile.id });

    app.get('/api/ai/status', (req, res) => send(res, 200, { configured: gemini.configured(), model: req.login.isAdmin ? gemini.model : undefined }));

    app.post('/api/ai/chat', requireProfile, async (req, res) => {
        try {
            const messages = cleanMessages(req.body);
            if (!messages) return send(res, 400, { error: 'invalid_messages' });
            if (messages.tooLong) return send(res, 400, { error: 'message_too_long', max: MAX_USER_CHARS });
            if (!gemini.configured()) return send(res, 200, await agent.chat({ messages, profile: req.profile, login: req.login }));
            const limit = rateLimit(req.login.email);
            if (!limit.ok) { res.set('Retry-After', String(limit.retryAfterSec)); return send(res, 429, { error: 'too_many_requests', retryAfterSec: limit.retryAfterSec }); }
            send(res, 200, await agent.chat({ messages, profile: req.profile, login: req.login }));
        } catch (e) { fail(res, e); }
    });

    app.get('/api/ai/staged', requireProfile, (req, res) => send(res, 200, { staged: staging.list(ownerOf(req)) }));

    app.post('/api/ai/staged/:id/cancel', requireProfile, (req, res) => {
        try { send(res, 200, { success: true, action: staging.cancel(req.params.id, ownerOf(req)) }); } catch (e) { fail(res, e); }
    });

    app.post('/api/ai/staged/:id/confirm', requireProfile, async (req, res) => {
        let action;
        try { action = staging.claim(req.params.id, ownerOf(req)); } catch (e) { return fail(res, e); }
        try {
            let result;
            if (action.kind === 'download') {
                const { picked, profile, meta } = action.payload;
                const record = await queueRelease({ picked, meta, profile, downloadsManager, db, login: req.login, action: 'ai.download' });
                result = { queued: true, downloadId: record && record.id ? record.id : null };
            } else if (action.kind === 'monitor') {
                // staging is checked at stage time, and again here: the login that confirms must be an admin
                if (!req.login.isAdmin) throw Object.assign(new Error('admin_only'), { status: 403 });
                const item = sentinel.addMonitored(action.payload);
                db.audit(req.login.email, null, 'ai.monitor', { imdbId: action.payload.imdbId, scope: item.scope });
                result = { monitored: true, scopeLabel: scopeLabel(item.scope) };
            } else {
                throw Object.assign(new Error('unknown_action'), { status: 400 });
            }
            send(res, 200, { success: true, action: staging.finish(action, result) });
        } catch (e) {
            staging.release(action); // still pending: Confirm can be pressed again
            if (e.body) return send(res, e.status || 422, e.body);
            console.warn('[AI] confirm failed:', e.message);
            if (e.status && e.status < 500) return send(res, e.status, { error: e.message });
            send(res, 502, { error: 'could_not_start', message: 'The downloader did not accept it. Nothing was started; try Confirm again in a moment.' });
        }
    });
}

module.exports = { registerAiRoutes, createRateLimit, cleanMessages };
