// Copyright (C) 2017-2026 HomeBot Cinema
// Per-profile Home rows: hide, reorder and drop duplicate rows. Stored in localStorage under the active profile id.

const KEY_PREFIX = 'homebot_home_rows:';

// a row is identified by its addon and catalog id, so it survives title and language changes
const rowKey = (catalog) => {
    const c = catalog || {};
    const dl = c.deepLinks && c.deepLinks.discover;
    if (dl) return String(dl);
    return [c.addon && c.addon.transportUrl, c.id, c.type].filter(Boolean).join('|');
};

const emptyPrefs = () => ({ hidden: [], order: [] });

const load = (profileId) => {
    try {
        const raw = window.localStorage.getItem(KEY_PREFIX + (profileId || 'default'));
        const parsed = raw ? JSON.parse(raw) : null;
        return {
            hidden: Array.isArray(parsed && parsed.hidden) ? parsed.hidden : [],
            order: Array.isArray(parsed && parsed.order) ? parsed.order : [],
        };
    } catch (_) {
        return emptyPrefs();
    }
};

const save = (profileId, prefs) => {
    try {
        window.localStorage.setItem(KEY_PREFIX + (profileId || 'default'), JSON.stringify(prefs));
    } catch (_) {
        // storage unavailable: the choice lasts until reload
    }
};

// rows: [{ catalog, index }]. Returns the rows to show (deduped, ordered, minus hidden); `all` ignores hidden.
const applyRowPrefs = (rows, prefs, { includeHidden = false } = {}) => {
    const seen = new Set();
    const unique = rows.filter(({ catalog }) => {
        const key = rowKey(catalog);
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const pos = (row) => {
        const i = prefs.order.indexOf(rowKey(row.catalog));
        return i === -1 ? Infinity : i;
    };
    const ordered = unique
        .map((row, n) => ({ row, n }))
        .sort((a, b) => (pos(a.row) - pos(b.row)) || (a.n - b.n) || 0)
        .map(({ row }) => row);
    return includeHidden ? ordered : ordered.filter(({ catalog }) => !prefs.hidden.includes(rowKey(catalog)));
};

const toggleHidden = (prefs, key) => ({
    ...prefs,
    hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key],
});

// move `key` one step up (-1) or down (1) within the current visible order
const move = (prefs, keys, key, delta) => {
    const list = keys.slice();
    const i = list.indexOf(key);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= list.length) return prefs;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...prefs, order: list };
};

module.exports = { rowKey, load, save, applyRowPrefs, toggleHidden, move, emptyPrefs };
