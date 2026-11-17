// Copyright (C) 2017-2026 HomeBot Cinema
// Per-profile appearance: accent colour, AMOLED black, poster size, corner radius.
// Stored in the profile's server-side settings; applied as CSS variables on <html>.

// Core palette: the brand colours. More accents come from plugins (slot "accents", e.g. plugins/themes).
const ACCENTS = {
    amber: { label: 'Amber', color: '#F27A24', secondary: '#FFD700' },
    gold: { label: 'Gold', color: '#F5B027', secondary: '#FFE08A' },
};
const DEFAULT_ACCENT = 'amber';

const DEFAULT_SETTINGS = { amoled: true, posterSize: 100, cornerRadius: 12 };

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '242, 122, 36';
}

// WCAG relative luminance and contrast ratio of two #rrggbb colours
function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).split(',').map((v) => {
        const c = Number(v) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}
/** Text/icon colour for something drawn on an accent fill: black or white, whichever contrasts more. */
function accentForeground(accent) {
    return contrastRatio(accent, '#000000') >= contrastRatio(accent, '#FFFFFF') ? '#000000' : '#FFFFFF';
}
/** Toggle thumb on an accent track: white, unless the accent is so light that a white thumb disappears. */
function accentThumb(accent) {
    return contrastRatio(accent, '#FFFFFF') >= 1.6 ? '#FFFFFF' : '#000000';
}

/** Core accents plus those of active plugins: { key: { label, color, secondary } } */
function getAccents() {
    const out = { ...ACCENTS };
    try {
        const { slot } = require('stremio/plugins/host');
        slot('accents').forEach((a) => {
            if (a && a.key && !out[a.key] && /^#[0-9a-f]{6}$/i.test(a.color || '')) out[a.key] = { label: a.label || a.key, color: a.color, secondary: a.secondary || a.color };
        });
    } catch (_) { /* plugins not loaded (tests): core palette only */ }
    return out;
}

function applyTheme(profile) {
    const root = document.documentElement;
    const settings = { ...DEFAULT_SETTINGS, ...((profile && profile.settings) || {}) };
    const accent = getAccents()[profile && profile.accent] || ACCENTS[DEFAULT_ACCENT];
    root.style.setProperty('--primary-accent-color', accent.color);
    // One accent everywhere: toggles, selected items, primary buttons (secondary) and active chips (quaternary) used to
    // get their own yellow/gold shades. `accent.secondary` stays in the data for plugins but no longer paints the UI.
    root.style.setProperty('--secondary-accent-color', accent.color);
    root.style.setProperty('--quaternary-accent-color', accent.color);
    root.style.setProperty('--primary-accent-rgb', hexToRgb(accent.color));
    root.style.setProperty('--accent-foreground-color', accentForeground(accent.color));
    root.style.setProperty('--accent-thumb-color', accentThumb(accent.color));
    root.style.setProperty('--outer-glow', `0px 0px 15px rgba(${hexToRgb(accent.color)}, 0.35)`);
    root.style.setProperty('--primary-background-color', settings.amoled ? '#000000' : '#0a0d12');
    root.style.setProperty('--secondary-background-color', settings.amoled ? '#0e0e10' : '#161b22');
    root.style.setProperty('--modal-background-color', settings.amoled ? '#0e0e10' : '#0d1117');
    root.style.setProperty('--border-radius', `${Math.min(28, Math.max(0, Number(settings.cornerRadius) || 0)) / 16}rem`);
    root.style.setProperty('--poster-scale', String(Math.min(160, Math.max(70, Number(settings.posterSize) || 100)) / 100));
}

module.exports = { ACCENTS, DEFAULT_ACCENT, DEFAULT_SETTINGS, applyTheme, getAccents, contrastRatio, accentForeground, accentThumb };
