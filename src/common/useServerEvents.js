// Copyright (C) 2017-2026 HomeBot Cinema
// Live "something changed" hints from /api/events (downloads, library, sentinel). One EventSource per tab,
// shared by every hook. While the stream is down, hooks fall back to polling so pages never go stale.

const React = require('react');

const TYPES = ['downloads', 'library', 'sentinel'];
const listeners = new Set();
let source = null;
let connected = false;

function notify(type, data) {
    listeners.forEach((l) => l(type, data));
}

function ensureSource() {
    if (source || typeof window === 'undefined' || typeof window.EventSource !== 'function') return;
    source = new window.EventSource('/api/events', { withCredentials: true });
    source.onopen = () => {
        connected = true;
        notify('_status');
    };
    source.onerror = () => {
        // the browser reconnects on its own (retry: 5 s); until then hooks poll
        connected = false;
        notify('_status');
    };
    TYPES.forEach((type) => source.addEventListener(type, (e) => {
        let data = null;
        try {
            data = JSON.parse(e.data);
        } catch (_) {
            // hint without a body
        }
        notify(type, data);
    }));
}

// onEvent(type, data) runs for the listed event types, and as onEvent('poll') every fallbackMs while disconnected.
function useServerEvents(types, onEvent, { fallbackMs = 0, enabled = true } = {}) {
    const handler = React.useRef(onEvent);
    handler.current = onEvent;
    const key = types.join(',');
    const [live, setLive] = React.useState(connected);

    React.useEffect(() => {
        if (!enabled) return;
        ensureSource();
        const wanted = key.split(',');
        const l = (type, data) => {
            if (type === '_status') setLive(connected);
            else if (wanted.includes(type)) handler.current(type, data);
        };
        listeners.add(l);
        setLive(connected);
        return () => {
            listeners.delete(l);
        };
    }, [key, enabled]);

    React.useEffect(() => {
        if (!enabled || live || !fallbackMs) return;
        const t = setInterval(() => {
            if (document.visibilityState === 'visible') handler.current('poll', null);
        }, fallbackMs);
        return () => clearInterval(t);
    }, [enabled, live, fallbackMs]);

    return live;
}

module.exports = useServerEvents;
