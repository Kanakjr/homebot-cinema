// Copyright (C) 2017-2026 HomeBot Cinema
// Quality profiles (Sonarr/Radarr style) on the client: load them, remember which one is selected,
// and turn stremio-core streams into plain objects the grabber API understands.

const React = require('react');
const { api } = require('./serverApi');

const KEY = 'homebot_quality_profile';
let cache = null;
let inflight = null;
const listeners = new Set();

function readSelected() {
    try {
        return Number(window.localStorage.getItem(KEY)) || null;
    } catch (_) {
        return null;
    }
}

async function load(force = false) {
    if (cache && !force) return cache;
    if (!inflight || force) {
        inflight = api('GET', '/api/grabber/profiles').then((d) => {
            cache = d;
            inflight = null;
            listeners.forEach((fn) => fn());
            return d;
        }).catch((e) => {
            inflight = null;
            throw e;
        });
    }
    return inflight;
}

function select(id) {
    try {
        window.localStorage.setItem(KEY, String(id));
    } catch (_) {
        // storage unavailable: the choice just won't be remembered
    }
    listeners.forEach((fn) => fn());
}

// { profiles, selected, select, reload }
function useQualityProfiles() {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    React.useEffect(() => {
        listeners.add(bump);
        load().catch(() => null);
        return () => { listeners.delete(bump); };
    }, []);
    const profiles = cache ? cache.profiles : [];
    const id = readSelected();
    const selected = profiles.find((p) => p.id === id) || profiles.find((p) => p.isDefault) || profiles[0] || null;
    return { profiles, selected, select, reload: () => load(true) };
}

// stremio-core groups streams per addon: [{ addon, content: { type: 'Ready', content: [stream] } }]
const flattenStreams = (groups) => (groups || [])
    .filter((g) => g && g.content && g.content.type === 'Ready')
    .flatMap((g) => g.content.content);

// Only plain, serialisable fields; the server re-validates everything.
const toRawStream = (s) => ({
    name: s.name,
    description: s.description || s.title,
    infoHash: s.infoHash,
    fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : undefined,
    url: typeof s.url === 'string' && s.url.startsWith('magnet:') ? s.url : undefined,
    magnet: s.deepLinks && s.deepLinks.externalPlayer ? s.deepLinks.externalPlayer.magnet : undefined,
    sources: s.sources,
    announce: s.announce,
    seeders: typeof s.seeders === 'number' ? s.seeders : undefined,
    behaviorHints: s.behaviorHints ? { videoSize: s.behaviorHints.videoSize } : undefined
});

module.exports = { useQualityProfiles, flattenStreams, toRawStream, load, select };
