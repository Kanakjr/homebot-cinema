// Copyright (C) 2017-2026 HomeBot Cinema
// Live updates over a single multiplexed /api/events SSE stream per origin across tabs.
// Uses BroadcastChannel + navigator.locks (or localStorage lease on non-HTTPS LAN origins) so N open
// tabs share 1 persistent HTTP/1.1 connection without exhausting the browser connection pool.

const React = require('react');

const DEFAULT_TYPES = ['downloads', 'library', 'sentinel'];
const CHANNEL_NAME = 'cinema_sse_v1';
const LOCK_NAME = 'cinema_sse_v1_leader';
const LEADER_KEY = 'cinema_sse_leader_v1';
const LEASE_MS = 6000;
const RENEW_MS = 2000;

const TAB_ID = 'tab_' + Math.random().toString(36).slice(2, 10);

const listeners = new Set(); // { wanted, fn }
const watchedTypes = new Set(DEFAULT_TYPES);
const attachedTypes = new Set();
const ownParams = new Map();
const peerParams = new Map(); // tabId -> { key: val }

let source = null;
let sourceUrl = '';
let connected = false;
let isLeaderTab = false;
let leaderStarted = false;
let channel = null;
let connectTimer = null;
let leaseTimer = null;
let followerTimer = null;
let releaseLock = null;
let unloadBound = false;

function notify(type, data) {
    listeners.forEach((entry) => {
        if (type === '_status') {
            entry.fn('_status', connected);
        } else if (entry.wanted.has(type)) {
            entry.fn(type, data);
        }
    });
}

function paramsToObject(map) {
    const out = {};
    for (const [k, v] of map.entries()) {
        if (v !== null && v !== undefined && v !== '') out[k] = String(v);
    }
    return out;
}

function buildEventsUrl() {
    const merged = new Map();
    const addMap = (obj) => {
        for (const [k, v] of Object.entries(obj)) {
            if (!v) continue;
            if (!merged.has(k)) merged.set(k, new Set());
            merged.get(k).add(String(v));
        }
    };
    addMap(paramsToObject(ownParams));
    for (const p of peerParams.values()) addMap(p);
    if (merged.size === 0) return '/api/events';
    const qs = Array.from(merged.keys()).sort().map((k) => {
        const vals = Array.from(merged.get(k)).sort().join(',');
        return `${encodeURIComponent(k)}=${encodeURIComponent(vals)}`;
    }).join('&');
    return qs ? `/api/events?${qs}` : '/api/events';
}

function broadcastMessage(msg) {
    if (!channel) return;
    try { channel.postMessage({ ...msg, from: TAB_ID }); } catch (_) { /* channel closed */ }
}

function setConnected(val) {
    const next = !!val;
    if (connected === next) return;
    connected = next;
    notify('_status', connected);
    if (isLeaderTab) broadcastMessage({ kind: 'status', connected });
}

function attachTypeOnSource(type) {
    if (!source || attachedTypes.has(type)) return;
    attachedTypes.add(type);
    source.addEventListener(type, (e) => {
        let data = null;
        try {
            data = JSON.parse(e.data);
        } catch (_) {
            // hint without a body
        }
        notify(type, data);
        broadcastMessage({ kind: 'event', type, data });
    });
}

function closeSource() {
    if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
    }
    if (source) {
        try { source.close(); } catch (_) { /* ignore */ }
        source = null;
    }
    sourceUrl = '';
    attachedTypes.clear();
}

function connectNow() {
    connectTimer = null;
    if (!isLeaderTab || typeof window === 'undefined' || typeof window.EventSource !== 'function') return;
    const nextUrl = buildEventsUrl();
    if (source && sourceUrl === nextUrl && source.readyState !== 2) {
        watchedTypes.forEach(attachTypeOnSource);
        return;
    }
    closeSource();
    sourceUrl = nextUrl;
    source = new window.EventSource(nextUrl, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    watchedTypes.forEach(attachTypeOnSource);
}

function scheduleConnect() {
    if (!isLeaderTab || typeof window === 'undefined' || typeof window.EventSource !== 'function') return;
    if (connectTimer) return;
    connectTimer = setTimeout(connectNow, 0);
}

function writeLease() {
    try {
        window.localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, exp: Date.now() + LEASE_MS }));
    } catch (_) { /* ignore storage restrictions */ }
}

function readLease() {
    try {
        const raw = window.localStorage.getItem(LEADER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function clearOwnLease() {
    try {
        const cur = readLease();
        if (cur && cur.id === TAB_ID) window.localStorage.removeItem(LEADER_KEY);
    } catch (_) { /* ignore */ }
}

function becomeLeader(useLease) {
    if (isLeaderTab) return;
    isLeaderTab = true;
    if (followerTimer) {
        clearInterval(followerTimer);
        followerTimer = null;
    }
    if (useLease) {
        writeLease();
        leaseTimer = setInterval(writeLease, RENEW_MS);
    }
    scheduleConnect();
}

function resignLeader() {
    const wasLeader = isLeaderTab;
    isLeaderTab = false;
    if (leaseTimer) {
        clearInterval(leaseTimer);
        leaseTimer = null;
    }
    closeSource();
    clearOwnLease();
    if (wasLeader) {
        broadcastMessage({ kind: 'resign' });
    }
    if (releaseLock) {
        const rel = releaseLock;
        releaseLock = null;
        try { rel(); } catch (_) { /* ignore */ }
    }
}

function tryClaimLeaseFallback() {
    if (isLeaderTab || !leaderStarted) return;
    const cur = readLease();
    if (cur && cur.id !== TAB_ID && Number(cur.exp) > Date.now()) return;
    writeLease();
    const verify = readLease();
    if (!verify || verify.id === TAB_ID) becomeLeader(true);
}

function startLeadership() {
    if (leaderStarted || typeof window === 'undefined' || typeof window.EventSource !== 'function') return;
    leaderStarted = true;

    if (!unloadBound) {
        unloadBound = true;
        const onUnload = () => {
            broadcastMessage({ kind: 'bye' });
            resignLeader();
        };
        window.addEventListener('pagehide', onUnload);
        window.addEventListener('beforeunload', onUnload);
    }

    if (typeof window.BroadcastChannel === 'function') {
        try {
            channel = new window.BroadcastChannel(CHANNEL_NAME);
            channel.onmessage = (ev) => {
                const msg = ev && ev.data;
                if (!msg || msg.from === TAB_ID) return;
                if (msg.kind === 'hello') {
                    if (Array.isArray(msg.types)) {
                        msg.types.forEach((t) => watchedTypes.add(t));
                    }
                    if (msg.params && typeof msg.params === 'object') {
                        peerParams.set(msg.from, msg.params);
                    }
                    if (isLeaderTab) {
                        broadcastMessage({ kind: 'status', connected });
                        scheduleConnect();
                    }
                } else if (msg.kind === 'bye') {
                    if (peerParams.delete(msg.from) && isLeaderTab) scheduleConnect();
                } else if (msg.kind === 'watch' && Array.isArray(msg.types)) {
                    msg.types.forEach((t) => watchedTypes.add(t));
                    if (isLeaderTab) watchedTypes.forEach(attachTypeOnSource);
                } else if (msg.kind === 'params' && msg.params && typeof msg.params === 'object') {
                    peerParams.set(msg.from, msg.params);
                    if (isLeaderTab) scheduleConnect();
                } else if (msg.kind === 'event' && !isLeaderTab) {
                    notify(msg.type, msg.data);
                } else if (msg.kind === 'status' && !isLeaderTab) {
                    setConnected(msg.connected);
                } else if (msg.kind === 'resign' && !isLeaderTab && !releaseLock) {
                    setTimeout(tryClaimLeaseFallback, 15 + Math.floor(Math.random() * 60));
                }
            };
            broadcastMessage({ kind: 'hello', types: Array.from(watchedTypes), params: paramsToObject(ownParams) });
        } catch (_) {
            channel = null;
        }
    }

    const hasLocks = typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function';
    if (channel && hasLocks) {
        try {
            navigator.locks.request(LOCK_NAME, () => new Promise((resolve) => {
                if (!leaderStarted) {
                    resolve();
                    return;
                }
                releaseLock = resolve;
                becomeLeader(false);
            })).catch(() => becomeLeader(false));
            return;
        } catch (_) {
            // Fall through to lease fallback
        }
    }

    if (channel && typeof window.localStorage !== 'undefined') {
        tryClaimLeaseFallback();
        if (!isLeaderTab) {
            followerTimer = setInterval(tryClaimLeaseFallback, 2500);
        }
        return;
    }

    becomeLeader(false);
}

function registerTypes(types) {
    let added = false;
    for (const type of types) {
        if (!watchedTypes.has(type)) {
            watchedTypes.add(type);
            added = true;
        }
    }
    if (added) {
        if (isLeaderTab) watchedTypes.forEach(attachTypeOnSource);
        else broadcastMessage({ kind: 'watch', types: Array.from(watchedTypes) });
    }
}

function subscribeServerEvents(types, onEvent) {
    const list = Array.isArray(types) ? types.filter(Boolean) : [types].filter(Boolean);
    registerTypes(list);
    startLeadership();
    const entry = { wanted: new Set(list), fn: onEvent };
    listeners.add(entry);
    return () => {
        listeners.delete(entry);
    };
}

function setServerEventParam(key, value) {
    if (!key) return;
    const prev = ownParams.get(key);
    const next = value !== null && value !== undefined && value !== '' ? String(value) : undefined;
    if (prev === next) return;
    if (next === undefined) ownParams.delete(key);
    else ownParams.set(key, next);
    if (isLeaderTab) scheduleConnect();
    else broadcastMessage({ kind: 'params', params: paramsToObject(ownParams) });
}

// onEvent(type, data) runs for the listed event types, and as onEvent('poll') every fallbackMs while disconnected.
function useServerEvents(types, onEvent, { fallbackMs = 0, enabled = true } = {}) {
    const handler = React.useRef(onEvent);
    handler.current = onEvent;
    const key = types.join(',');
    const [live, setLive] = React.useState(connected);

    React.useEffect(() => {
        if (!enabled) return undefined;
        const wanted = key.split(',').filter(Boolean);
        setLive(connected);
        return subscribeServerEvents(wanted, (type, data) => {
            if (type === '_status') setLive(!!data);
            else handler.current(type, data);
        });
    }, [key, enabled]);

    React.useEffect(() => {
        if (!enabled || live || !fallbackMs) return undefined;
        const t = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                handler.current('poll', null);
            }
        }, fallbackMs);
        return () => clearInterval(t);
    }, [enabled, live, fallbackMs]);

    return live;
}

useServerEvents.subscribe = subscribeServerEvents;
useServerEvents.setParam = setServerEventParam;
useServerEvents.isLeader = () => isLeaderTab;
useServerEvents.isLive = () => connected;
useServerEvents._resetForTests = () => {
    leaderStarted = false;
    resignLeader();
    if (followerTimer) {
        clearInterval(followerTimer);
        followerTimer = null;
    }
    if (channel) {
        try { channel.close(); } catch (_) { /* ignore */ }
        channel = null;
    }
    listeners.clear();
    watchedTypes.clear();
    DEFAULT_TYPES.forEach((t) => watchedTypes.add(t));
    ownParams.clear();
    peerParams.clear();
    connected = false;
};

module.exports = useServerEvents;
