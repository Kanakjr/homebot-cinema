// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault" (UI): pure helpers, tested in test/vault.spec.js.

/** 'Trips/2024' -> [{ name: 'Locked folder', path: '' }, { name: 'Trips', path: 'Trips' }, { name: '2024', path: 'Trips/2024' }] */
function crumbs(folder) {
    const parts = String(folder || '').split('/').filter(Boolean);
    return [{ name: 'Locked folder', path: '' }, ...parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))];
}

/** 75000 -> '1:15', 3725000 -> '1:02:05', null -> '' */
function duration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The file id and grant of a Locked folder stream URL, or null for any other stream. */
function parseVaultStream(url) {
    if (typeof url !== 'string' || !url) return null;
    let u;
    try {
        u = new URL(url, 'http://localhost');
    } catch (_) {
        return null;
    }
    const m = /^\/api\/vault\/stream\/(\d+)$/.exec(u.pathname);
    const g = u.searchParams.get('g');
    return m && g ? { id: Number(m[1]), g } : null;
}

/** Resume only a real position: past the first 30 s and before the last 5%. */
function shouldResume(positionMs, durationMs) {
    if (!Number.isFinite(positionMs) || positionMs < 30000) return false;
    return !Number.isFinite(durationMs) || durationMs <= 0 || positionMs < durationMs * 0.95;
}

/** Number pad: a digit appends, 'back' deletes one, 'clear' empties (max 64 characters). */
function padInput(value, key) {
    const v = String(value || '');
    if (key === 'back') return v.slice(0, -1);
    if (key === 'clear') return '';
    if (/^\d$/.test(key) && v.length < 64) return v + key;
    return v;
}

/** Message for an unlock/setup error from the server. */
function passcodeError(e) {
    const data = (e && e.data) || {};
    switch (e && e.message) {
        case 'bad_passcode': return `Wrong passcode. ${data.remaining} ${data.remaining === 1 ? 'try' : 'tries'} left before a 15-minute lock.`;
        case 'locked': return `Too many wrong passcodes. Try again in ${Math.max(1, Math.ceil((data.retryAfterSec || 60) / 60))} min.`;
        case 'passcode_too_short': return 'Use at least 6 characters.';
        case 'passcode_too_long': return 'Use at most 64 characters.';
        case 'passcode_spaces': return 'The passcode cannot start or end with a space.';
        case 'admin_only': return 'Only the admin on the main profile can open the Locked folder.';
        default: return (e && e.message) || 'Something went wrong.';
    }
}

/** A browser plays mp4/m4v/webm itself; the Mac app (mpv) plays everything. */
function canPlayHere({ webPlayable, desktop }) {
    return !!(desktop || webPlayable);
}

function formatDate(ms) {
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

module.exports = { crumbs, duration, parseVaultStream, shouldResume, padInput, passcodeError, canPlayHere, formatDate };
