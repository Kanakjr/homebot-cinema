// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Central state manager for Cast & Remote Control.
// Manages device registration, target discovery, SSE connections, and command dispatching.

const React = require('react');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');
const useServerEvents = require('stremio/common/useServerEvents');

const DEVICE_ID_KEY = 'cinema_remote_device_id';
const DEVICE_NAME_KEY = 'cinema_remote_device_name';
const TARGET_ID_KEY = 'cinema_remote_target_id';
const RECEIVER_ENABLED_KEY = 'cinema_remote_receiver_enabled';

function getOrGenerateDeviceId() {
    try {
        let id = window.localStorage.getItem(DEVICE_ID_KEY);
        if (!id || !/^[a-zA-Z0-9:_-]{6,64}$/.test(id)) {
            id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            window.localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch (_) {
        return 'dev_' + Math.random().toString(36).slice(2, 10);
    }
}

function detectDevice() {
    if (typeof window === 'undefined') {
        return { name: 'Cinema Screen', isDesktop: false, isMac: false };
    }
    const isMacOsShell = typeof document !== 'undefined' &&
        document.documentElement &&
        document.documentElement.dataset &&
        document.documentElement.dataset.shell === 'macos';
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isDesktop = isMacOsShell || /Tauri|libmpv/i.test(ua);
    const isMac = isMacOsShell || /Mac OS X|Macintosh/.test(ua);

    let defaultName = 'Cinema Screen';
    if (isDesktop && isMac) {
        defaultName = 'Mac Mini (Desktop App)';
    } else if (isDesktop) {
        defaultName = 'Desktop App';
    } else if (/Android/.test(ua)) {
        defaultName = /Mobile/.test(ua) ? 'Android Phone' : 'Android Tablet';
    } else if (/iPhone/.test(ua)) {
        defaultName = 'iPhone';
    } else if (/iPad/.test(ua)) {
        defaultName = 'iPad';
    } else if (isMac) {
        defaultName = 'Mac Browser';
    } else if (/Windows/.test(ua)) {
        defaultName = 'Windows PC';
    }

    return { name: defaultName, isDesktop, isMac };
}

function getSavedDeviceName(detectedDefault) {
    try {
        const saved = window.localStorage.getItem(DEVICE_NAME_KEY);
        if (saved && saved.trim().length > 0) return saved.trim().slice(0, 60);
    } catch (_) { /* ignore */ }
    return detectedDefault;
}

function getSavedReceiverEnabled() {
    try {
        const saved = window.localStorage.getItem(RECEIVER_ENABLED_KEY);
        if (saved !== null) return saved === '1';
    } catch (_) { /* ignore */ }
    // Default to true for desktop app and normal screens
    return true;
}

function getSavedTargetId() {
    try {
        return window.localStorage.getItem(TARGET_ID_KEY) || null;
    } catch (_) {
        return null;
    }
}

const detected = detectDevice();
const deviceId = getOrGenerateDeviceId();
const initialDeviceName = getSavedDeviceName(detected.name);
const initialReceiverEnabled = getSavedReceiverEnabled(detected.isDesktop);
const initialTargetId = getSavedTargetId();

let state = {
    deviceId,
    deviceName: initialDeviceName,
    isDesktop: detected.isDesktop,
    isReceiverEnabled: initialReceiverEnabled,
    selectedTargetId: initialTargetId,
    targets: [],
    remoteNowPlaying: null,
    isSheetOpen: false,
    toastMessage: null,
    isTargetConnected: false,
    connectedControllers: [],
};

const listeners = new Set();
let controllerSubscribed = false;
let pollTimer = null;
let toastTimer = null;
let activePlayerControls = null; // Registered by PlayerReceiverBridge

function emit(patch) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
}

function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function showToast(msg, durationMs = 3000) {
    if (toastTimer) clearTimeout(toastTimer);
    emit({ toastMessage: msg });
    toastTimer = setTimeout(() => {
        emit({ toastMessage: null });
        toastTimer = null;
    }, durationMs);
}

// 1. Fetch targets list from server
async function refreshTargets() {
    try {
        const data = await api('GET', '/api/remote/targets', undefined, pm.profileHeaders());
        if (data && Array.isArray(data.targets)) {
            const list = data.targets;
            let currentTargetNp = state.remoteNowPlaying;
            let currentTargetConnected = false;

            if (state.selectedTargetId) {
                const found = list.find((t) => t.id === state.selectedTargetId);
                if (found) {
                    currentTargetConnected = found.online;
                    currentTargetNp = found.nowPlaying || null;
                } else {
                    currentTargetConnected = false;
                }
            }

            emit({
                targets: list,
                remoteNowPlaying: currentTargetNp,
                isTargetConnected: currentTargetConnected,
            });
        }
    } catch (_) {
        // network error / offline
    }
}

// 2. Controller SSE updates (shared over /api/events via useServerEvents)
function initControllerEvents() {
    if (controllerSubscribed) return;
    controllerSubscribed = true;
    useServerEvents.subscribe(['targets'], (_type, data) => {
        if (data && Array.isArray(data.targets)) {
            const list = data.targets;
            let currentTargetNp = state.remoteNowPlaying;
            let currentTargetConnected = false;

            if (state.selectedTargetId) {
                const found = list.find((t) => t.id === state.selectedTargetId);
                if (found) {
                    currentTargetConnected = found.online;
                    currentTargetNp = found.nowPlaying || null;
                } else {
                    currentTargetConnected = false;
                }
            }

            emit({
                targets: list,
                remoteNowPlaying: currentTargetNp,
                isTargetConnected: currentTargetConnected,
            });
        }
    });
}

// 3. Register THIS screen with server if receiver is enabled
async function registerCurrentDevice() {
    if (!state.isReceiverEnabled) return;
    try {
        await api('POST', '/api/remote/target/register', {
            targetId: state.deviceId,
            name: state.deviceName,
            device: detected.isDesktop ? 'Desktop app on macOS' : (detected.name || 'Web Browser'),
            isDesktop: state.isDesktop,
        }, pm.profileHeaders());
    } catch (_) { /* ignore */ }
}

// 4. Select / connect to a target screen
function selectTarget(targetId) {
    const prevTargetId = state.selectedTargetId;
    if (prevTargetId && prevTargetId !== targetId) {
        api('POST', `/api/remote/targets/${encodeURIComponent(prevTargetId)}/disconnect`, {
            controllerId: state.deviceId,
        }, pm.profileHeaders()).catch(() => undefined);
    }
    if (targetId) {
        api('POST', `/api/remote/targets/${encodeURIComponent(targetId)}/connect`, {
            controllerId: state.deviceId,
            controllerName: state.deviceName,
            device: detected.name,
        }, pm.profileHeaders()).catch(() => undefined);
    }

    try {
        if (targetId) {
            window.localStorage.setItem(TARGET_ID_KEY, targetId);
        } else {
            window.localStorage.removeItem(TARGET_ID_KEY);
        }
    } catch (_) { /* ignore */ }

    let np = null;
    let connected = false;
    if (targetId) {
        const found = state.targets.find((t) => t.id === targetId);
        if (found) {
            np = found.nowPlaying || null;
            connected = found.online;
            showToast(`Connected to ${found.name}`);
        }
    } else {
        showToast('Switched to local playback');
    }

    emit({
        selectedTargetId: targetId,
        remoteNowPlaying: np,
        isTargetConnected: connected,
    });
}

function disconnectTarget() {
    selectTarget(null);
}

function setConnectedControllers(controllers) {
    emit({ connectedControllers: Array.isArray(controllers) ? controllers : [] });
}

// 5. Send command to currently selected target
async function sendCommand(action, payload = {}) {
    const targetId = state.selectedTargetId;
    if (!targetId) {
        return { ok: false, error: 'no_target_selected' };
    }
    try {
        const res = await api('POST', `/api/remote/targets/${encodeURIComponent(targetId)}/command`, {
            action,
            payload,
            fromName: state.deviceName,
        }, pm.profileHeaders());
        return res;
    } catch (err) {
        showToast(`Command failed: ${err.message || 'offline'}`);
        return { ok: false, error: err.message };
    }
}

// 6. Push media playback to the selected target
async function pushPlay(playData) {
    if (!state.selectedTargetId) {
        return false;
    }
    const target = state.targets.find((t) => t.id === state.selectedTargetId);
    const targetName = target ? target.name : 'Target Screen';

    const payload = typeof playData === 'string' ? { path: playData } : playData;
    const res = await sendCommand('play', payload);
    if (res && res.ok) {
        showToast(`Playing on ${targetName}`);
        emit({ isSheetOpen: false });
        return true;
    }
    return false;
}

// 7. Change device name
function setDeviceName(newName) {
    const name = (newName || '').trim().slice(0, 60);
    if (!name) return;
    try {
        window.localStorage.setItem(DEVICE_NAME_KEY, name);
    } catch (_) { /* ignore */ }
    emit({ deviceName: name });
    registerCurrentDevice();
}

// 8. Toggle receiver enabled
function setReceiverEnabled(enabled) {
    const val = !!enabled;
    try {
        window.localStorage.setItem(RECEIVER_ENABLED_KEY, val ? '1' : '0');
    } catch (_) { /* ignore */ }
    emit({ isReceiverEnabled: val });
    if (val) {
        registerCurrentDevice();
    } else if (state.deviceId) {
        api('DELETE', `/api/remote/targets/${encodeURIComponent(state.deviceId)}`, undefined, pm.profileHeaders()).catch(() => undefined);
    }
}

// 9. Sheet UI controls
const toggleSheet = () => emit({ isSheetOpen: !state.isSheetOpen });
const openSheet = () => emit({ isSheetOpen: true });
const closeSheet = () => emit({ isSheetOpen: false });

// 10. Hook for components to access state
function useRemoteState() {
    const snapshot = React.useSyncExternalStore(subscribe, () => state);

    React.useEffect(() => {
        registerCurrentDevice();
        refreshTargets();
        initControllerEvents();

        // Fallback polling every 8s only while shared SSE is disconnected
        if (!pollTimer) {
            pollTimer = setInterval(() => {
                if (!useServerEvents.isLive() && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
                    refreshTargets();
                }
            }, 8000);
        }
    }, []);

    return {
        ...snapshot,
        selectTarget,
        disconnectTarget,
        sendCommand,
        pushPlay,
        setDeviceName,
        setReceiverEnabled,
        toggleSheet,
        openSheet,
        closeSheet,
        refreshTargets,
        showToast,
        setConnectedControllers,
    };
}

// Register player controls (from PlayerReceiverBridge)
function registerPlayerBridge(controls) {
    activePlayerControls = controls;
}
function unregisterPlayerBridge() {
    activePlayerControls = null;
}
function getPlayerBridge() {
    return activePlayerControls;
}

module.exports = {
    useRemoteState,
    selectTarget,
    disconnectTarget,
    sendCommand,
    pushPlay,
    setDeviceName,
    setReceiverEnabled,
    toggleSheet,
    openSheet,
    closeSheet,
    showToast,
    refreshTargets,
    registerCurrentDevice,
    registerPlayerBridge,
    unregisterPlayerBridge,
    getPlayerBridge,
    setConnectedControllers,
    getDeviceId: () => state.deviceId,
    getState: () => state,
};
