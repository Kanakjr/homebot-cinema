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
    root.style.setProperty('--secondary-accent-color', accent.secondary);
    root.style.setProperty('--outer-glow', `0px 0px 15px rgba(${hexToRgb(accent.color)}, 0.35)`);
    root.style.setProperty('--primary-background-color', settings.amoled ? '#000000' : '#0a0d12');
    root.style.setProperty('--secondary-background-color', settings.amoled ? '#0e0e10' : '#161b22');
    root.style.setProperty('--modal-background-color', settings.amoled ? '#0e0e10' : '#0d1117');
    root.style.setProperty('--border-radius', `${Math.min(28, Math.max(0, Number(settings.cornerRadius) || 0)) / 16}rem`);
    root.style.setProperty('--poster-scale', String(Math.min(160, Math.max(70, Number(settings.posterSize) || 100)) / 100));
}

module.exports = { ACCENTS, DEFAULT_ACCENT, DEFAULT_SETTINGS, applyTheme, getAccents };
