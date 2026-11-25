// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault": sits in the player (slot playerOverlays), renders nothing, and only acts on Locked folder streams.
// It resumes from the private resume point and saves the position every 15 s while playing (every 60 s while paused,
// which also keeps the folder unlocked while a video is open). It authenticates with the grant in the stream URL.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const { parseVaultStream, shouldResume } = require('./logic');

const TICK_MS = 15000;
const PAUSED_EVERY_MS = 60000;

const save = (ref, positionMs, durationMs, keepalive = false) => {
    const body = JSON.stringify({ g: ref.g, positionMs, durationMs });
    const url = `/api/vault/progress/${ref.id}`;
    if (keepalive) {
        return fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => null);
    }
    return api('POST', url, { g: ref.g, positionMs, durationMs }).catch(() => null);
};

const ResumeOverlay = ({ streamUrl, timeMs, durationMs, paused, seekTo }) => {
    const ref = React.useMemo(() => parseVaultStream(streamUrl), [streamUrl]);
    const latest = React.useRef({ timeMs, durationMs, paused });
    latest.current = { timeMs, durationMs, paused };
    const resumed = React.useRef(false);
    const lastSave = React.useRef(0);
    const known = Number.isFinite(durationMs) && durationMs > 0;

    const fileId = ref ? ref.id : null;
    React.useEffect(() => { resumed.current = false; }, [fileId]);

    React.useEffect(() => {
        if (!ref || !known || resumed.current) return;
        resumed.current = true;
        api('GET', `/api/vault/progress/${ref.id}?g=${encodeURIComponent(ref.g)}`)
            .then((r) => {
                const p = r && r.progress ? r.progress.positionMs : null;
                if (shouldResume(p, latest.current.durationMs) && typeof seekTo === 'function') seekTo(p);
            })
            .catch(() => null);
    }, [ref, known, seekTo]);

    React.useEffect(() => {
        if (!ref) return undefined;
        const tick = () => {
            const p = latest.current;
            if (!Number.isFinite(p.timeMs) || !Number.isFinite(p.durationMs) || p.durationMs <= 0) return;
            const now = Date.now();
            if (p.paused && now - lastSave.current < PAUSED_EVERY_MS) return;
            lastSave.current = now;
            save(ref, p.timeMs, p.durationMs);
        };
        const t = setInterval(tick, TICK_MS);
        const onHide = () => {
            const p = latest.current;
            if (Number.isFinite(p.timeMs) && Number.isFinite(p.durationMs)) save(ref, p.timeMs, p.durationMs, true);
        };
        window.addEventListener('pagehide', onHide);
        return () => {
            clearInterval(t);
            window.removeEventListener('pagehide', onHide);
            onHide(); // leaving the player
        };
    }, [ref]);

    return null;
};

ResumeOverlay.propTypes = {
    streamUrl: PropTypes.string,
    timeMs: PropTypes.number,
    durationMs: PropTypes.number,
    paused: PropTypes.bool,
    seekTo: PropTypes.func,
};

module.exports = ResumeOverlay;
