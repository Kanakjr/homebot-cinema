// Copyright (C) 2017-2026 HomeBot Cinema
// Short labels for the home screen: "23m left", "Today", "Tomorrow", "Fri", "21 Nov".

const DAY = 24 * 3600 * 1000;

/** Time left in a title: "1h 5m left", "23m left", "Almost done". */
function timeLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const min = Math.round(ms / 60000);
    if (min < 1) return 'Almost done';
    if (min < 60) return `${min}m left`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m left` : `${h}h left`;
}

const startOfDay = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};

/** When an episode airs, in the viewer's time zone: "Yesterday", "Today", "Tomorrow", a weekday within a week, else "21 Nov". */
function airLabel(iso, now = Date.now()) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return null;
    const days = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
    if (days === -1) return 'Yesterday';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days > 1 && days < 7) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

module.exports = { timeLeft, airLabel };
