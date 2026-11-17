// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": sits in the player (slot playerOverlays), renders nothing, and tells the server what is playing every
// 15 s and whenever play/pause changes. Transcoding is detected from the HLS requests the page makes to the streaming server.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');
const R = require('./report');

const BEAT_MS = 15000;

const send = (path, body, keepalive = false) => {
    if (keepalive) {
        // survives the tab closing; plain fetch so the profile headers go along (sendBeacon cannot send headers)
        return fetch(path, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: pm.profileHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }).catch(() => null);
    }
    return api('POST', path, body, pm.profileHeaders()).catch(() => null);
};

const Reporter = (props) => {
    const { title, videoId, paused, durationMs, live } = props;
    const latest = React.useRef(props);
    latest.current = props;
    const lastHls = React.useRef(null);
    const session = React.useRef(R.newSessionId());

    // HLS playlists/segments the page fetches: hls.js runs on the page, so they show up as resource timings
    React.useEffect(() => {
        if (typeof PerformanceObserver !== 'function') return undefined;
        const obs = new PerformanceObserver((list) => {
            if (list.getEntries().some((e) => R.isHlsResource(e.name))) lastHls.current = Date.now();
        });
        try { obs.observe({ type: 'resource', buffered: true }); } catch (_) { return undefined; }
        return () => obs.disconnect();
    }, []);

    const beat = React.useCallback(() => {
        const p = latest.current;
        if (p.live || !Number.isFinite(p.durationMs) || p.durationMs <= 0) return;
        send('/api/nowplaying', R.heartbeat({ ...p, name: p.showName, session: session.current, lastHlsAt: lastHls.current, nowMs: Date.now() }));
    }, []);

    // a new title is a new session; the old one ends right away (binge-watching keeps the player mounted)
    React.useEffect(() => {
        const id = R.newSessionId();
        session.current = id;
        return () => { send('/api/nowplaying/stop', { session: id }, true); };
    }, [videoId, title]);

    const loaded = Number.isFinite(durationMs);
    React.useEffect(() => {
        beat();
    }, [beat, paused, videoId, title, loaded, live]);

    React.useEffect(() => {
        const t = setInterval(beat, BEAT_MS);
        const stop = () => send('/api/nowplaying/stop', { session: session.current }, true);
        window.addEventListener('pagehide', stop);
        return () => {
            clearInterval(t);
            window.removeEventListener('pagehide', stop);
        };
    }, [beat]);

    return null;
};

Reporter.propTypes = {
    title: PropTypes.string,
    showName: PropTypes.string,
    type: PropTypes.string,
    metaId: PropTypes.string,
    videoId: PropTypes.string,
    poster: PropTypes.string,
    stream: PropTypes.object,
    timeMs: PropTypes.number,
    durationMs: PropTypes.number,
    paused: PropTypes.bool,
    live: PropTypes.bool,
};

module.exports = Reporter;
