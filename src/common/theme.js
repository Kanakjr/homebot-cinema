// Copyright (C) 2017-2026 HomeBot Cinema
// Per-profile appearance: accent colour, AMOLED black, poster size, corner radius.
// Stored in the profile's server-side settings; applied as CSS variables on <html>.

const ACCENTS = {
    amber: { label: 'Amber', color: '#F27A24', secondary: '#FFD700' },
    gold: { label: 'Gold', color: '#F5B027', secondary: '#FFE08A' },
    jade: { label: 'Jade', color: '#2DD4A0', secondary: '#A7F3D0' },
    rosegold: { label: 'Rose gold', color: '#E58BA8', secondary: '#F9C6D6' },
    arctic: { label: 'Arctic blue', color: '#4DA3FF', secondary: '#A5D0FF' },
    graphite: { label: 'Graphite', color: '#A1A1AA', secondary: '#D4D4D8' },
    crimson: { label: 'Crimson', color: '#E5383B', secondary: '#FF9AA2' },
    ocean: { label: 'Ocean', color: '#1E78D6', secondary: '#7DB8F5' },
    violet: { label: 'Violet', color: '#9B30D0', secondary: '#D8A8F0' },
    emerald: { label: 'Emerald', color: '#3FA34D', secondary: '#9BE0A5' },
    rose: { label: 'Rose', color: '#E91E63', secondary: '#F8A1C0' },
    white: { label: 'White', color: '#F4F4F5', secondary: '#FFFFFF' }
};
const DEFAULT_ACCENT = 'amber';

const DEFAULT_SETTINGS = { amoled: true, posterSize: 100, cornerRadius: 12 };

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : '242, 122, 36';
}

function applyTheme(profile) {
    const root = document.documentElement;
    const settings = { ...DEFAULT_SETTINGS, ...((profile && profile.settings) || {}) };
    const accent = ACCENTS[profile && profile.accent] || ACCENTS[DEFAULT_ACCENT];
    root.style.setProperty('--primary-accent-color', accent.color);
    root.style.setProperty('--secondary-accent-color', accent.secondary);
    root.style.setProperty('--outer-glow', `0px 0px 15px rgba(${hexToRgb(accent.color)}, 0.35)`);
    root.style.setProperty('--primary-background-color', settings.amoled ? '#000000' : '#0a0d12');
    root.style.setProperty('--secondary-background-color', settings.amoled ? '#0e0e10' : '#161b22');
    root.style.setProperty('--modal-background-color', settings.amoled ? '#0e0e10' : '#0d1117');
    root.style.setProperty('--border-radius', `${Math.min(28, Math.max(0, Number(settings.cornerRadius) || 0)) / 16}rem`);
    root.style.setProperty('--poster-scale', String(Math.min(160, Math.max(70, Number(settings.posterSize) || 100)) / 100));
}

module.exports = { ACCENTS, DEFAULT_ACCENT, DEFAULT_SETTINGS, applyTheme };
