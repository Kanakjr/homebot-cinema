'use strict';
// Staged actions: the copilot can only STAGE a download or a monitor. Nothing happens until the owner presses Confirm
// (same rule as GrowwTrader's staged orders). Actions live in memory, belong to one login + profile, expire after 10 minutes
// and can be confirmed once.

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const MAX_ACTIONS = 200;
const PENDING = 'PENDING_CONFIRMATION';

const err = (status, code) => Object.assign(new Error(code), { status });

function createStaging({ now = () => Date.now(), ttlMs = TTL_MS } = {}) {
    const actions = new Map();

    const sweep = () => {
        const t = now();
        for (const [id, a] of actions) {
            if (a.status === PENDING && t >= a.expiresAt) a.status = 'EXPIRED';
            // finished or expired actions are kept briefly so the UI can still show their outcome
            if (a.status !== PENDING && a.status !== 'CONFIRMING' && t - a.expiresAt > ttlMs) actions.delete(id);
        }
        while (actions.size > MAX_ACTIONS) actions.delete(actions.keys().next().value);
    };

    /** card: what the UI shows; payload: what Confirm needs (never sent to the browser). */
    function stage({ kind, email, profileId, card, payload }) {
        sweep();
        const id = `AI-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        const a = { id, kind, email, profileId, card, payload, status: PENDING, createdAt: now(), expiresAt: now() + ttlMs, result: null };
        actions.set(id, a);
        return publicView(a);
    }

    const publicView = (a) => ({ id: a.id, kind: a.kind, status: a.status, expiresAt: a.expiresAt, card: a.card, result: a.result });

    function owned(id, { email, profileId }) {
        sweep();
        const a = actions.get(String(id));
        if (!a) throw err(404, 'not_found');
        if (a.email !== email || a.profileId !== profileId) throw err(403, 'not_yours');
        return a;
    }

    /** Claims a pending action for execution (so a double click cannot run it twice). Returns the full action. */
    function claim(id, owner) {
        const a = owned(id, owner);
        if (a.status === 'EXPIRED') throw err(409, 'expired');
        if (a.status !== PENDING) throw err(409, 'not_pending');
        a.status = 'CONFIRMING';
        return a;
    }
    const finish = (a, result) => { a.status = 'CONFIRMED'; a.result = result; return publicView(a); };
    /** The action could not run (for example the downloader is down): it goes back to pending so Confirm can be retried. */
    const release = (a) => { if (a.status === 'CONFIRMING') a.status = PENDING; };

    function cancel(id, owner) {
        const a = owned(id, owner);
        if (a.status !== PENDING) throw err(409, a.status === 'EXPIRED' ? 'expired' : 'not_pending');
        a.status = 'CANCELLED';
        return publicView(a);
    }

    function list(owner) {
        sweep();
        return [...actions.values()].filter((a) => a.email === owner.email && a.profileId === owner.profileId && a.status === PENDING).map(publicView);
    }

    return { stage, claim, finish, release, cancel, list, get: (id, owner) => publicView(owned(id, owner)), TTL_MS: ttlMs };
}

module.exports = { createStaging, PENDING };
