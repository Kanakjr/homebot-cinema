'use strict';
// "Pick the best release and queue it", shared by the Save button (POST /api/grabber/grab) and by the AI copilot,
// whose staged download is only queued when the user presses Confirm (server/ai/).

const { pickBest } = require('./quality');
const { buildMagnet } = require('./magnet');
const { chooseLive } = require('./swarm_probe');

const grabError = (status, body) => Object.assign(new Error(body.error), { status, body });

/**
 * Picks the best release for a quality profile and prefers one whose swarm is alive (listed seeder counts are often stale).
 * Throws a grabError (status 422 with a JSON `body`) when nothing fits or every top release is dead (unless `force`).
 */
async function chooseRelease({ profile, streams, type, probeMany, force = false }) {
    const r = pickBest(profile.config, streams, type);
    if (!r.picked) {
        throw grabError(422, { error: 'no_match', profile: { id: profile.id, name: profile.name }, considered: streams.length, rejectedSummary: r.rejectedSummary });
    }
    let swarm = null;
    if (probeMany) {
        const live = await chooseLive(r, probeMany);
        if (live.picked) {
            r.picked = live.picked;
        } else if (live.allDead && !force) {
            throw grabError(422, {
                error: 'no_live_swarm', profile: { id: profile.id, name: profile.name }, checked: live.checked,
                message: 'None of the best matching releases has working peers right now. Try again later, pick another profile, or save anyway.',
            });
        }
        const h = r.picked.stream.infoHash && live.health[r.picked.stream.infoHash.toLowerCase()];
        swarm = h ? h.verdict : null;
    }
    return { r, swarm, considered: streams.length };
}

/** Queues a picked release in Transmission and records who asked. Returns the download record. */
async function queueRelease({ picked, meta, profile, downloadsManager, db, login, action = 'grab' }) {
    const title = String(meta.title || meta.showTitle || 'Media').slice(0, 200);
    const magnet = buildMagnet(picked.stream, title);
    if (!magnet) throw grabError(422, { error: 'no_magnet', message: 'The best match has no torrent link' });
    const record = await downloadsManager.addDownload({
        magnet, mediaId: meta.mediaId, imdbId: meta.imdbId, title, showTitle: meta.showTitle, type: meta.type,
        season: meta.season || null, episode: meta.episode || null, poster: meta.poster || null, year: meta.year || null,
    });
    db.audit(login.email, null, action, { title, profile: profile.name, release: picked.info.label.slice(0, 120) });
    return record;
}

module.exports = { chooseRelease, queueRelease, grabError };
