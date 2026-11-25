// Plugin "livesubs" (UI): pure helpers shared by the overlay and the menu item.

/** The source the server can read: a torrent (infoHash + fileIdx) or a library file (lf_<id>), else null. */
function sourceOf(stream, streamUrl) {
    if (stream && typeof stream.infoHash === 'string' && /^[a-f0-9]{40}$/i.test(stream.infoHash)) {
        return { infoHash: stream.infoHash.toLowerCase(), fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : undefined };
    }
    const m = /\/api\/downloads\/stream\/(lf_\d{1,12})(?:$|[/?#])/.exec(String(streamUrl || (stream && stream.url) || ''));
    return m ? { file: m[1] } : null;
}

const sourceKey = (src) => (src ? (src.file || `${src.infoHash}:${src.fileIdx === undefined ? '' : src.fileIdx}`) : null);

/** The cue on screen at time t (seconds), or null. */
function cueAt(cues, t) {
    let hit = null;
    for (const c of cues) {
        if (c.start > t) break;
        if (t < c.end) hit = c;
    }
    return hit;
}

/** Merge a window of cues from the server into what we hold (sorted, unique by start+text). */
function mergeWindow(held, incoming) {
    const map = new Map();
    for (const c of held.concat(incoming)) map.set(`${c.start}|${c.text}`, c);
    return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

/** A jump of more than `slack` seconds from where playback should be: a seek. */
const isSeek = (prevT, prevAt, t, at, paused, slack = 4) => {
    if (prevT === null) return false;
    const expected = paused ? prevT : prevT + (at - prevAt) / 1000;
    return Math.abs(t - expected) > slack;
};

module.exports = { sourceOf, sourceKey, cueAt, mergeWindow, isSeek };
