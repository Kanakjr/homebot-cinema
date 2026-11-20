// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Pure formatting and state logic (no React, tested by test/remote.spec.js).

function formatTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function calculateProgress(timeMs, durationMs) {
    if (!Number.isFinite(timeMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
        return 0;
    }
    return Math.min(100, Math.max(0, (timeMs / durationMs) * 100));
}

function detectDeviceName(ua = '', isMacShell = false) {
    const isDesktop = isMacShell || /Tauri|libmpv/i.test(ua);
    const isMac = isMacShell || /Mac OS X|Macintosh/.test(ua);

    if (isDesktop && isMac) return 'Mac Mini (Desktop App)';
    if (isDesktop) return 'Desktop App';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android Phone' : 'Android Tablet';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (isMac) return 'Mac Browser';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Cinema Screen';
}

function formatDisplayTitle(title, showName) {
    if (showName && title) return `${showName} - ${title}`;
    return title || showName || 'Playing Media';
}

function parsePlayerPath(input) {
    if (!input) return null;
    if (typeof input === 'string') {
        return input.startsWith('#') ? input : `#${input}`;
    }
    if (input.stream && input.stream.deepLinks && input.stream.deepLinks.player) {
        return input.stream.deepLinks.player;
    }
    return null;
}

const KEY_CODES = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Enter: 13,
    Escape: 27,
    Backspace: 8,
    Space: 32,
    KeyF: 70,
    KeyJ: 74,
    KeyL: 76,
    KeyN: 78,
};

module.exports = {
    formatTime,
    calculateProgress,
    detectDeviceName,
    formatDisplayTitle,
    parsePlayerPath,
    KEY_CODES,
};
