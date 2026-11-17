// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": pure helpers for the Watch stats page (tested by test/stats.spec.js).

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// the server's grid is indexed by JS weekday (0 = Sunday); the page shows Monday first
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "45 min", "3.5 h", "120 h". */
function hours(ms) {
    const min = Math.round((Number(ms) || 0) / 60000);
    if (min < 60) return `${min} min`;
    const h = min / 60;
    return `${h >= 100 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

/** A round axis maximum at or above v (1, 2, 5 x 10^n). */
function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
}

/** Bars for the per-day chart: x, y, width and height inside a w x h plot, with a 2px gap between bars. */
function dailyBars(perDay, w, h) {
    const n = perDay.length || 1;
    const max = niceMax(Math.max(...perDay.map((d) => d.watchedMs / 3600000), 0));
    const slot = w / n;
    const bw = Math.max(1, slot - 2);
    return {
        max,
        bars: perDay.map((d, i) => {
            const v = d.watchedMs / 3600000;
            const bh = v > 0 ? Math.max(2, (v / max) * h) : 0;
            return { ...d, x: i * slot + 1, y: h - bh, w: bw, h: bh };
        }),
    };
}

/** Rows of the hour x weekday grid (Monday first) with a 0-4 intensity level per cell. */
function heatRows(grid) {
    const max = Math.max(0, ...grid.flat());
    return WEEKDAY_ORDER.map((wd, i) => ({
        label: WEEKDAYS[i],
        cells: (grid[wd] || []).map((ms, hour) => ({ hour, ms, level: ms > 0 && max > 0 ? Math.max(1, Math.ceil((ms / max) * 4)) : 0 })),
    }));
}

/** Share of the total for horizontal bars. */
const share = (items) => {
    const total = items.reduce((a, b) => a + b.watchedMs, 0);
    return items.map((it) => ({ ...it, pct: total > 0 ? Math.round((it.watchedMs / total) * 100) : 0 }));
};

/** Short date label for an ISO day: "17 Nov". */
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "S1 E2" for episodes. */
const episodeTag = (row) => (row && row.season !== null && row.season !== undefined && row.episode !== null && row.episode !== undefined ? `S${row.season} E${row.episode}` : null);

module.exports = { WEEKDAYS, hours, niceMax, dailyBars, heatRows, share, dayLabel, episodeTag };
