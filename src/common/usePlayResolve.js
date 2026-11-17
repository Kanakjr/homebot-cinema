// Copyright (C) 2017-2026 HomeBot Cinema
// Hook to resolve and trigger 1-click playback for movies and series (local files direct, quality-ranked streams via addon).

const React = require('react');
const { useNavigate } = require('react-router');
const { useCore } = require('stremio/core');
const { api, playServerFile, serverPlayerPath } = require('./serverApi');
const pm = require('./profileManager');

function usePlayResolve() {
    const navigate = useNavigate();
    const core = useCore();
    const [resolving, setResolving] = React.useState(false);

    const play = React.useCallback(async ({ id, type, videoId, season, episode, fallbackHref }) => {
        if (!id || !type) return false;
        setResolving(true);
        try {
            const params = new URLSearchParams({ id, type });
            if (videoId) params.set('videoId', videoId);
            if (season !== null && season !== undefined) params.set('season', season);
            if (episode !== null && episode !== undefined) params.set('episode', episode);

            const res = await api('GET', `/api/play/resolve?${params.toString()}`, undefined, pm.profileHeaders());
            if (res && res.action === 'play') {
                if (res.source === 'local' && res.streamId) {
                    await playServerFile(core, navigate, res.streamId, res.title, {
                        type: res.type,
                        imdbId: res.id,
                        season: res.season,
                        episode: res.episode,
                    });
                    return true;
                }
                if (res.source === 'stream' && res.stream) {
                    const encoded = await core.transport.encodeStream(res.stream);
                    if (typeof encoded === 'string') {
                        navigate(serverPlayerPath(encoded, {
                            type: res.type,
                            imdbId: res.id,
                            season: res.season,
                            episode: res.episode,
                        }));
                        return true;
                    }
                }
            }

            // Fallback: navigate to details / streams view
            const target = fallbackHref || (res && res.videoId ? `#/detail/${type}/${id}/${res.videoId}` : `#/detail/${type}/${id}`);
            if (target.startsWith('#')) {
                window.location.hash = target;
            } else {
                navigate(target);
            }
            return false;
        } catch (e) {
            console.error('[PlayResolve] Failed to resolve play:', e);
            if (fallbackHref) {
                if (fallbackHref.startsWith('#')) window.location.hash = fallbackHref;
                else navigate(fallbackHref);
            }
            return false;
        } finally {
            setResolving(false);
        }
    }, [core, navigate]);

    return { play, resolving };
}

module.exports = usePlayResolve;
