// Copyright (C) 2017-2026 HomeBot Cinema
// Batched loader & cache for card ratings across the app (Board, Discover, Library).

const React = require('react');
const { api } = require('./serverApi');

const ratingsCache = new Map(); // imdbId -> formatted rating string (e.g. "7.4") or null
const listeners = new Map(); // imdbId -> Set of callbacks
const pendingIds = new Set();
let batchTimeout = null;

const noop = () => {
    // noop
};

function notify(id, rating) {
    const set = listeners.get(id);
    if (set) {
        set.forEach((cb) => {
            try {
                cb(rating);
            } catch (_) {
                // ignore
            }
        });
        listeners.delete(id);
    }
}

function flushBatch() {
    batchTimeout = null;
    if (pendingIds.size === 0) return;

    const ids = Array.from(pendingIds).slice(0, 50);
    ids.forEach((id) => pendingIds.delete(id));

    api('POST', '/api/mdblist/batch', { ids })
        .then((res) => {
            const ratings = res && res.ratings ? res.ratings : {};
            for (const id of ids) {
                const data = ratings[id];
                let formatted = null;
                if (data) {
                    const val = data.imdb?.score ??
                        (typeof data.score === 'number' && data.score > 0 ? data.score / 10 : null) ??
                        (data.tomatoes?.score ? data.tomatoes.score / 10 : null);
                    if (typeof val === 'number' && !isNaN(val) && val > 0) {
                        formatted = val.toFixed(1);
                    }
                }
                ratingsCache.set(id, formatted);
                notify(id, formatted);
            }
            if (pendingIds.size > 0 && !batchTimeout) {
                batchTimeout = setTimeout(flushBatch, 100);
            }
        })
        .catch(() => {
            for (const id of ids) {
                ratingsCache.set(id, null);
                notify(id, null);
            }
        });
}

function requestRating(id, callback) {
    if (!id || !/^tt\d+$/.test(id)) {
        callback(null);
        return noop;
    }
    if (ratingsCache.has(id)) {
        callback(ratingsCache.get(id));
        return noop;
    }

    if (!listeners.has(id)) {
        listeners.set(id, new Set());
    }
    listeners.get(id).add(callback);

    pendingIds.add(id);
    if (!batchTimeout) {
        batchTimeout = setTimeout(flushBatch, 60);
    }

    return () => {
        const set = listeners.get(id);
        if (set) {
            set.delete(callback);
            if (set.size === 0) listeners.delete(id);
        }
    };
}

function useCardRating(itemId, initialRating) {
    const [fetchedRating, setFetchedRating] = React.useState(() => {
        if (initialRating) return initialRating;
        if (itemId && ratingsCache.has(itemId)) return ratingsCache.get(itemId);
        return null;
    });

    React.useEffect(() => {
        if (initialRating) {
            setFetchedRating(initialRating);
            return undefined;
        }
        if (!itemId || !/^tt\d+$/.test(itemId)) return undefined;

        let alive = true;
        const unsubscribe = requestRating(itemId, (val) => {
            if (alive) setFetchedRating(val);
        });

        return () => {
            alive = false;
            unsubscribe();
        };
    }, [itemId, initialRating]);

    return initialRating || fetchedRating;
}

module.exports = { useCardRating, requestRating, ratingsCache };
