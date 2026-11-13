// Copyright (C) 2017-2026 HomeBot Cinema
// "New on your server" for the active profile: titles added since the profile last opened the server library.
// One shared store per tab (the nav bar remounts on every page); refreshed by live 'library' events.

const React = require('react');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');
const useServerEvents = require('stremio/common/useServerEvents');

const KEY = 'lastSeenLibraryAt';
const subscribers = new Set();
let state = { items: [], lastSeen: null, loaded: false };
let inflight = null;

const activeProfile = () => (typeof window !== 'undefined' ? window.ssoProfile || null : null);
const set = (patch) => {
    state = { ...state, ...patch };
    subscribers.forEach((fn) => fn(state));
};
const saveSeen = (iso) => {
    const p = activeProfile();
    if (!p) return Promise.resolve();
    p.settings = { ...(p.settings || {}), [KEY]: iso };
    return pm.updateProfile(p.id, { settings: { [KEY]: iso } }, pm.profileHeaders()).catch(() => null);
};

function refresh() {
    if (inflight) return inflight;
    const p = activeProfile();
    if (!p) return Promise.resolve();
    let lastSeen = p.settings && p.settings[KEY];
    if (!lastSeen) {
        // first time for this profile: start counting from now instead of flagging the whole library as new
        lastSeen = new Date().toISOString();
        saveSeen(lastSeen);
    }
    inflight = api('GET', '/api/library?sort=recent&limit=30')
        .then((d) => set({ items: (d && d.items) || [], lastSeen, loaded: true }))
        .catch(() => set({ loaded: true }))
        .finally(() => { inflight = null; });
    return inflight;
}

// titles whose newest file arrived after lastSeen
const newTitles = (s) => (s.lastSeen ? s.items.filter((i) => i.lastAdded && i.lastAdded > s.lastSeen) : []);

function markSeen() {
    const iso = new Date().toISOString();
    set({ lastSeen: iso });
    return saveSeen(iso);
}

function useNewOnServer() {
    const [s, setS] = React.useState(state);
    React.useEffect(() => {
        subscribers.add(setS);
        if (!state.loaded) refresh();
        return () => { subscribers.delete(setS); };
    }, []);
    useServerEvents(['library'], refresh);
    return React.useMemo(() => newTitles(s), [s]);
}

module.exports = { useNewOnServer, markSeen, refresh, newTitles };
