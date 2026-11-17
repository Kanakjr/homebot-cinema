'use strict';
// Play resolver: finds the right episode/movie to play, checks local files first,
// falls back to the best stream from the stream addon (via quality profile),
// and provides the one-click primary play action button metadata.

const { pickBest } = require('./grabber/quality');

const ID_RE = /^tt\d+$/;

function timeLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const min = Math.round(ms / 60000);
    if (min < 1) return 'Almost done';
    if (min < 60) return `${min} min left`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m left` : `${h}h left`;
}

function parseVideoId(videoId) {
    if (typeof videoId !== 'string') return null;
    const m = /^tt\d+:(\d+):(\d+)$/.exec(videoId);
    return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

function createPlayResolver({ library, upnext, grabberStore, streamAddonUrl, fetchImpl = fetch }) {
    function streamAddonBase() {
        const u = streamAddonUrl || process.env.STREAM_ADDON_URL || '';
        return String(u).trim().replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
    }

    async function resolve({ profileId, id, type, videoId, season, episode }) {
        if (!ID_RE.test(String(id || ''))) {
            throw Object.assign(new Error('invalid_id'), { status: 400 });
        }
        if (type !== 'movie' && type !== 'series') {
            throw Object.assign(new Error('invalid_type'), { status: 400 });
        }

        let targetVideoId = videoId || null;
        let targetSeason = season != null ? Number(season) : null;
        let targetEpisode = episode != null ? Number(episode) : null;
        let mode = 'first';
        let remainingMs = null;

        if (targetVideoId && (targetSeason == null || targetEpisode == null)) {
            const parsed = parseVideoId(targetVideoId);
            if (parsed) {
                targetSeason = parsed.season;
                targetEpisode = parsed.episode;
            }
        }

        // Series: determine episode if not explicitly provided
        if (type === 'series') {
            if (targetSeason == null || targetEpisode == null) {
                const continueItems = upnext ? await upnext.continueFor(profileId, [id]) : [];
                const cont = continueItems && continueItems[0];
                if (cont && cont.mode === 'resume' && cont.videoId) {
                    targetVideoId = cont.videoId;
                    targetSeason = cont.season;
                    targetEpisode = cont.episode;
                    remainingMs = cont.remainingMs;
                    mode = 'resume';
                } else if (cont && (cont.mode === 'next' || cont.mode === 'upcoming') && cont.next) {
                    targetVideoId = cont.next.id;
                    targetSeason = cont.next.season;
                    targetEpisode = cont.next.episode;
                    mode = 'next';
                } else {
                    // Default to S1E1
                    targetSeason = 1;
                    targetEpisode = 1;
                    targetVideoId = `${id}:1:1`;
                    mode = 'first';
                }
            } else if (!targetVideoId) {
                targetVideoId = `${id}:${targetSeason}:${targetEpisode}`;
            }
        } else {
            // Movie
            targetVideoId = id;
            const continueItems = upnext ? await upnext.continueFor(profileId, [id]) : [];
            const cont = continueItems && continueItems[0];
            if (cont && cont.mode === 'resume') {
                remainingMs = cont.remainingMs;
                mode = 'resume';
            }
        }

        // Build human-readable label
        const left = timeLeft(remainingMs);
        let label;
        if (type === 'series') {
            const epTag = `S${targetSeason}E${targetEpisode}`;
            if (mode === 'resume') {
                label = left ? `Resume ${epTag} · ${left}` : `Resume ${epTag}`;
            } else {
                label = `Play ${epTag}`;
            }
        } else {
            label = mode === 'resume' && left ? `Resume · ${left}` : (mode === 'resume' ? 'Resume' : 'Play');
        }

        const baseResult = {
            id,
            type,
            videoId: targetVideoId,
            season: targetSeason,
            episode: targetEpisode,
            label,
            mode,
            remainingMs,
        };

        // 1. Check local library first
        const localItem = library ? library.getByImdb(id) : null;
        if (localItem) {
            if (type === 'movie' && Array.isArray(localItem.files) && localItem.files.length > 0) {
                const file = localItem.files[0];
                return {
                    ...baseResult,
                    action: 'play',
                    source: 'local',
                    streamId: file.streamId,
                    url: `/api/downloads/stream/${encodeURIComponent(file.streamId)}?direct=1`,
                    title: localItem.title || file.name || 'Movie',
                };
            }
            if (type === 'series' && Array.isArray(localItem.seasons)) {
                for (const s of localItem.seasons) {
                    if (Number(s.season) === targetSeason && Array.isArray(s.episodes)) {
                        for (const ep of s.episodes) {
                            if (Number(ep.episode) === targetEpisode && Array.isArray(ep.files) && ep.files.length > 0) {
                                const file = ep.files[0];
                                return {
                                    ...baseResult,
                                    action: 'play',
                                    source: 'local',
                                    streamId: file.streamId,
                                    url: `/api/downloads/stream/${encodeURIComponent(file.streamId)}?direct=1`,
                                    title: `${localItem.title || 'Show'} S${targetSeason}E${targetEpisode}`,
                                };
                            }
                        }
                    }
                }
            }
        }

        // 2. Query stream addon if configured
        const base = streamAddonBase();
        if (base && targetVideoId) {
            try {
                const url = `${base}/stream/${type}/${encodeURIComponent(targetVideoId)}.json`;
                const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
                if (res.ok) {
                    const data = await res.json();
                    const streams = (data && Array.isArray(data.streams)) ? data.streams : [];
                    if (streams.length > 0) {
                        const qualityProfile = grabberStore ? grabberStore.resolve(null) : null;
                        let pickedStream = null;
                        if (qualityProfile && qualityProfile.config) {
                            try {
                                const pick = pickBest(qualityProfile.config, streams, type);
                                if (pick && pick.picked && pick.picked.stream) {
                                    pickedStream = pick.picked.stream;
                                }
                            } catch (_) {}
                        }
                        if (!pickedStream) {
                            pickedStream = streams[0];
                        }
                        if (pickedStream) {
                            return {
                                ...baseResult,
                                action: 'play',
                                source: 'stream',
                                stream: pickedStream,
                            };
                        }
                    }
                }
            } catch (e) {
                // Fetch failed or timed out; fall through to browse
            }
        }

        // 3. Fallback: browse versions
        return {
            ...baseResult,
            action: 'browse',
            source: 'none',
        };
    }

    return { resolve, timeLeft };
}

function registerPlayRoutes(app, { resolver, requireProfile }) {
    app.get('/api/play/resolve', requireProfile, async (req, res) => {
        try {
            const { id, type, videoId, season, episode } = req.query;
            if (!id || !type) return res.status(400).json({ error: 'id_and_type_required' });
            const result = await resolver.resolve({
                profileId: req.profile.id,
                id: String(id),
                type: String(type),
                videoId: videoId ? String(videoId) : undefined,
                season: season != null ? Number(season) : undefined,
                episode: episode != null ? Number(episode) : undefined,
            });
            res.json(result);
        } catch (e) {
            const status = e.status || 500;
            if (status >= 500) console.error('[PlayResolve]', e);
            res.status(status).json({ error: e.message || 'resolve_failed' });
        }
    });
}

module.exports = { createPlayResolver, registerPlayRoutes, timeLeft };
