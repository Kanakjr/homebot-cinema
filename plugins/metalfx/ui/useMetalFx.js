// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": Hook managing Apple MetalFX 4K AI Upscaler state, stream analysis, telemetry, and overlay menu.

const { useState, useEffect, useCallback, useMemo } = require('react');
const { analyzeStream } = require('./logic');

let commonModule = null;
try {
    commonModule = require('stremio/common');
} catch (e) {
    void e;
}
const usePlatform = (commonModule && commonModule.usePlatform) || (() => ({ shell: null }));

// Shared overlay menu state across playerMenuItems and playerOverlays
let s_menuOpen = false;
const s_menuListeners = new Set();
function setMenuOpenGlobal(val) {
    s_menuOpen = typeof val === 'function' ? val(s_menuOpen) : !!val;
    s_menuListeners.forEach((fn) => {
        try {
            fn(s_menuOpen);
        } catch (_) {
            void 0;
        }
    });
}

function useMetalFx(stream) {
    const platform = usePlatform();
    const isNativeMac = useMemo(() => {
        return !!(
            (typeof window !== 'undefined' && window.__TAURI__) ||
            (typeof window !== 'undefined' && window.chrome?.webview) ||
            (platform && platform.shell && platform.shell.active)
        );
    }, [platform]);

    const [active, setActive] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            const saved = localStorage.getItem('cinema_metalfx_enabled');
            return saved !== null ? saved === 'true' : false;
        } catch (e) {
            void e;
            return false;
        }
    });

    const [menuOpen, setMenuOpen] = useState(s_menuOpen);
    useEffect(() => {
        s_menuListeners.add(setMenuOpen);
        return () => { s_menuListeners.delete(setMenuOpen); };
    }, []);

    const toggleMenu = useCallback(() => setMenuOpenGlobal((prev) => !prev), []);
    const closeMenu = useCallback(() => setMenuOpenGlobal(false), []);

    const [telemetry, setTelemetry] = useState({
        inWidth: 1920,
        inHeight: 1080,
        outWidth: 3840,
        outHeight: 2160,
        lastGpuTimeMs: 0.0,
        active: false,
    });

    const streamAnalysis = useMemo(() => analyzeStream(stream), [stream]);

    // Synchronize initial state to native layer on mount
    useEffect(() => {
        if (!isNativeMac) return;
        if (platform?.shell?.send) {
            platform.shell.send('metalfx-set-upscale', active);
            platform.shell.send('metalfx-get-status');
        }
    }, [isNativeMac, active, platform]);

    // Poll live telemetry while menu is open or active
    useEffect(() => {
        if (!isNativeMac || !platform?.shell?.send) return;
        platform.shell.send('metalfx-get-status');
        if (menuOpen) {
            const interval = setInterval(() => {
                platform.shell.send('metalfx-get-status');
            }, 1000);
            return () => clearInterval(interval);
        }
    }, [isNativeMac, platform, menuOpen, active]);

    // Listen for state and telemetry events from native shell
    useEffect(() => {
        if (!platform?.shell?.on) return;
        const onGpuChanged = (data) => {
            if (data && typeof data.enabled === 'boolean') {
                setActive(data.enabled);
            }
        };
        const onStatusChanged = (status) => {
            if (status) {
                setTelemetry({
                    inWidth: status.in_width || 1920,
                    inHeight: status.in_height || 1080,
                    outWidth: status.out_width || 3840,
                    outHeight: status.out_height || 2160,
                    lastGpuTimeMs: status.last_gpu_time_ms || 0.0,
                    active: !!status.metalfx_active,
                });
            }
        };

        platform.shell.on('gpu-video-processing-changed', onGpuChanged);
        platform.shell.on('metalfx-status-changed', onStatusChanged);

        return () => {
            if (platform?.shell?.off) {
                platform.shell.off('gpu-video-processing-changed', onGpuChanged);
                platform.shell.off('metalfx-status-changed', onStatusChanged);
            }
        };
    }, [platform]);

    const toggle = useCallback((forced) => {
        const next = typeof forced === 'boolean' ? forced : !active;
        setActive(next);
        try {
            localStorage.setItem('cinema_metalfx_enabled', next ? 'true' : 'false');
        } catch (e) {
            void e;
        }

        if (typeof window !== 'undefined' && window.__TAURI__?.invoke) {
            window.__TAURI__.invoke('metalfx_toggle', { enable: next }).catch((e) => {
                void e;
            });
        }

        if (platform?.shell?.send) {
            platform.shell.send('metalfx-set-upscale', next);
            platform.shell.send('mpv-set-gpu-video-processing', next);
            platform.shell.send('metalfx-get-status');
        } else if (typeof window !== 'undefined' && window.chrome?.webview?.postMessage) {
            try {
                window.chrome.webview.postMessage(JSON.stringify({
                    id: 0,
                    type: 6,
                    args: ['metalfx-set-upscale', next],
                }));
            } catch (e) {
                void e;
            }
        }
    }, [active, platform]);

    return {
        isNativeMac,
        active,
        toggle,
        streamAnalysis,
        telemetry,
        menuOpen,
        toggleMenu,
        closeMenu,
    };
}

module.exports = { useMetalFx, analyzeStream };
