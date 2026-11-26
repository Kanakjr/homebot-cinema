// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault" (UI): the unlock token lives in memory only. A reload, Lock, or the server's auto-lock (any 401
// "vault_locked") forgets it, and the passcode screen shows again.

const { api } = require('stremio/common/serverApi');

let token = null;
let lastActivity = 0;
const listeners = new Set();

function setToken(t) {
    token = t || null;
    lastActivity = Date.now();
    listeners.forEach((fn) => fn(token));
}

const getToken = () => token;
const touch = () => { lastActivity = Date.now(); };
const idleFor = () => Date.now() - lastActivity;

function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** api() with the unlock token; a "vault_locked" answer forgets the token. */
async function vaultApi(method, url, body) {
    try {
        touch();
        return await api(method, url, body, token ? { 'X-Vault-Token': token } : undefined);
    } catch (e) {
        if (e.status === 401 && e.message === 'vault_locked') setToken(null);
        throw e;
    }
}

async function lock() {
    const t = token;
    setToken(null);
    if (t) {
        try {
            await api('POST', '/api/vault/lock', {}, { 'X-Vault-Token': t });
        } catch (_) {
            // locked locally anyway; the server's session expires on its own
        }
    }
}

async function fetchThumbUrl(id, signal) {
    const res = await fetch(`/api/vault/thumb/${Number(id)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: token ? { 'X-Vault-Token': token } : undefined,
        signal,
    });
    if (res.status === 401) {
        try {
            const err = await res.json();
            if (err && err.error === 'vault_locked') setToken(null);
        } catch (_) { /* ignore */ }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
}

module.exports = { setToken, getToken, touch, idleFor, subscribe, vaultApi, lock, fetchThumbUrl };
