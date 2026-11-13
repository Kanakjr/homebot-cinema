// Copyright (C) 2017-2026 HomeBot Cinema
// Tiny shared state for the AI copilot: is the drawer open, and is the copilot set up on the server.
// The ✨ button (nav bar) and the drawer (App) both read it, so they stay in step without prop drilling.

const React = require('react');
const { api, isAdmin } = require('./serverApi');

const OPEN_KEY = 'homebot_copilot_open';

const readOpen = () => {
    try {
        return window.localStorage.getItem(OPEN_KEY) === '1';
    } catch (_) {
        return false;
    }
};

let state = { open: readOpen(), loaded: false, configured: false };
let statusRequested = false;
const listeners = new Set();

const emit = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
};

const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

const loadStatus = () => {
    if (statusRequested) return;
    statusRequested = true;
    api('GET', '/api/ai/status')
        .then((s) => emit({ loaded: true, configured: !!(s && s.configured) }))
        .catch(() => emit({ loaded: true, configured: false }));
};

const setOpen = (open) => {
    try {
        window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch (_) {
        // storage unavailable: the drawer just does not remember its state
    }
    emit({ open: !!open });
};
const toggle = () => setOpen(!state.open);

/** { open, setOpen, toggle, loaded, configured, available }. `available`: show the ✨ button (set up, or an admin who can set it up). */
const useCopilot = () => {
    const snapshot = React.useSyncExternalStore(subscribe, () => state);
    React.useEffect(loadStatus, []);
    return { ...snapshot, setOpen, toggle, available: snapshot.loaded && (snapshot.configured || isAdmin()) };
};

module.exports = { useCopilot, setOpen, toggle };
