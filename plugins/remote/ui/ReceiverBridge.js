// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Receiver bridge mounted in appOverlays.
// Connects to SSE to receive incoming commands on the target screen (e.g. Mac Mini),
// and intercepts stream clicks on controller screens (e.g. Android) to push play directly.

const React = require('react');
const { useToast } = require('stremio/common');
const useServerEvents = require('stremio/common/useServerEvents');
const { useRemoteState, getPlayerBridge, pushPlay, setConnectedControllers } = require('./remoteState');
const { KEY_CODES, parsePlayerPath } = require('./logic');

function dispatchSyntheticKey(keyName, code, keyCode) {
    const activeEl = document.activeElement || document.body;
    const opts = {
        key: keyName,
        code: code || keyName,
        keyCode: keyCode || 0,
        which: keyCode || 0,
        bubbles: true,
        cancelable: true,
        view: window,
    };
    const down = new KeyboardEvent('keydown', opts);
    const up = new KeyboardEvent('keyup', opts);
    const handled = !activeEl.dispatchEvent(down);
    activeEl.dispatchEvent(up);

    if (!handled && (keyName === 'Enter' || keyName === 'Select')) {
        if (activeEl && typeof activeEl.click === 'function' && activeEl !== document.body) {
            activeEl.click();
        }
    }
}

const ReceiverBridge = () => {
    const toast = useToast();
    const { deviceId, isReceiverEnabled, selectedTargetId, targets } = useRemoteState();
    const commandHandlerRef = React.useRef(null);

    // 1. Target screen SSE receiver (multiplexed onto the single shared /api/events SSE stream)
    React.useEffect(() => {
        if (!isReceiverEnabled || !deviceId) {
            useServerEvents.setParam('targetId', null);
            return undefined;
        }
        useServerEvents.setParam('targetId', deviceId);
        return () => {
            useServerEvents.setParam('targetId', null);
        };
    }, [deviceId, isReceiverEnabled]);

    useServerEvents(['target_info', 'controller_status', 'command'], (type, data) => {
        if (!data) return;
        if (type === 'target_info') {
            if (Array.isArray(data.controllers)) {
                setConnectedControllers(data.controllers);
            }
        } else if (type === 'controller_status') {
            if (Array.isArray(data.controllers)) {
                setConnectedControllers(data.controllers);
            }
            const name = (data.controller && data.controller.name) || 'Remote';
            if (data.action === 'connected') {
                toast.show({
                    type: 'info',
                    title: '📱 Remote Connected',
                    message: `${name} is controlling this screen`,
                    timeout: 3500,
                });
            } else if (data.action === 'disconnected') {
                toast.show({
                    type: 'info',
                    title: '📱 Remote Disconnected',
                    message: `${name} disconnected`,
                    timeout: 3000,
                });
            }
        } else if (type === 'command') {
            if (!data.action) return;
            if (typeof useServerEvents.isLeader === 'function' && !useServerEvents.isLeader()) return;
            if (commandHandlerRef.current) commandHandlerRef.current(data);
        }
    }, { enabled: Boolean(isReceiverEnabled && deviceId) });

    // 2. Handle commands on this target screen
    const handleIncomingCommand = (cmd) => {
        const { action, payload, from } = cmd;
        const bridge = getPlayerBridge();
        const fromName = (from && from.name) || 'Remote';

        switch (action) {
            case 'play': {
                const path = parsePlayerPath((payload && payload.path) || payload);
                if (path) {
                    window.location.hash = path;
                    const title = (payload && (payload.title || payload.showName)) || 'Media';
                    toast.show({
                        type: 'info',
                        title: '📱 Casting Media',
                        message: `Playing ${title} from ${fromName}`,
                        timeout: 4000,
                    });
                }
                break;
            }
            case 'pause': {
                if (bridge && typeof bridge.onPause === 'function') {
                    bridge.onPause();
                } else {
                    const video = document.querySelector('video');
                    if (video) video.pause();
                    else dispatchSyntheticKey('Space', 'Space', KEY_CODES.Space);
                }
                toast.show({
                    type: 'info',
                    title: '⏸️ Paused from Remote',
                    message: fromName,
                    timeout: 2000,
                });
                break;
            }
            case 'resume': {
                if (bridge && typeof bridge.onPlay === 'function') {
                    bridge.onPlay();
                } else {
                    const video = document.querySelector('video');
                    if (video) video.play();
                    else dispatchSyntheticKey('Space', 'Space', KEY_CODES.Space);
                }
                toast.show({
                    type: 'info',
                    title: '▶️ Playing from Remote',
                    message: fromName,
                    timeout: 2000,
                });
                break;
            }
            case 'togglePause': {
                dispatchSyntheticKey('Space', 'Space', KEY_CODES.Space);
                break;
            }
            case 'seek': {
                if (payload && Number.isFinite(payload.timeMs) && bridge && typeof bridge.seekTo === 'function') {
                    bridge.seekTo(payload.timeMs);
                } else if (payload && Number.isFinite(payload.deltaSec)) {
                    if (payload.deltaSec > 0) {
                        dispatchSyntheticKey('ArrowRight', 'ArrowRight', KEY_CODES.ArrowRight);
                    } else {
                        dispatchSyntheticKey('ArrowLeft', 'ArrowLeft', KEY_CODES.ArrowLeft);
                    }
                    toast.show({
                        type: 'info',
                        title: payload.deltaSec > 0 ? '⏩ Seek +10s' : '⏪ Seek -10s',
                        message: fromName,
                        timeout: 1500,
                    });
                }
                break;
            }
            case 'setVolume': {
                const video = document.querySelector('video');
                if (video && payload && typeof payload.volume === 'number') {
                    video.volume = Math.max(0, Math.min(1, payload.volume / 100));
                    toast.show({
                        type: 'info',
                        title: `🔊 Volume: ${payload.volume}%`,
                        message: fromName,
                        timeout: 1500,
                    });
                }
                break;
            }
            case 'mute': {
                const video = document.querySelector('video');
                if (video && payload && typeof payload.muted === 'boolean') {
                    video.muted = payload.muted;
                }
                break;
            }
            case 'next': {
                if (bridge && typeof bridge.playNext === 'function') {
                    bridge.playNext();
                } else {
                    dispatchSyntheticKey('KeyN', 'KeyN', 78);
                }
                break;
            }
            case 'stop': {
                window.location.hash = '#/';
                break;
            }
            case 'navigate': {
                if (payload && payload.path) {
                    const clean = payload.path.startsWith('#') ? payload.path : `#${payload.path}`;
                    window.location.hash = clean;
                }
                break;
            }
            case 'search': {
                if (payload && payload.query) {
                    window.location.hash = `#/search?search=${encodeURIComponent(payload.query)}`;
                    toast.show({
                        type: 'info',
                        title: `🔍 Searching: ${payload.query}`,
                        message: fromName,
                        timeout: 2500,
                    });
                }
                break;
            }
            case 'key': {
                if (payload && payload.key) {
                    const code = payload.code || payload.key;
                    const keyCode = payload.keyCode || KEY_CODES[payload.key] || 0;
                    dispatchSyntheticKey(payload.key, code, keyCode);
                }
                break;
            }
            default:
                break;
        }
    };
    commandHandlerRef.current = handleIncomingCommand;

    // 3. Controller click interception on mobile (push-to-play)
    // When connected to a target screen (e.g. Mac Mini), clicking any stream or player link
    // intercepts navigation and pushes playback to the target screen instead!
    React.useEffect(() => {
        if (!selectedTargetId) return undefined;

        const onCaptureClick = (event) => {
            // Find closest anchor or button with player link
            const anchor = event.target && event.target.closest && event.target.closest('a[href*="/player/"]');
            if (anchor && anchor.getAttribute('href')) {
                const href = anchor.getAttribute('href');
                if (href.startsWith('#/player/') || href.includes('/player/')) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Find title from card if available
                    const card = anchor.closest('[title]');
                    const title = card ? card.getAttribute('title') : '';

                    pushPlay({ path: href, title });
                }
            }
        };

        document.addEventListener('click', onCaptureClick, true);
        return () => {
            document.removeEventListener('click', onCaptureClick, true);
        };
    }, [selectedTargetId, targets]);

    return null;
};

module.exports = ReceiverBridge;
