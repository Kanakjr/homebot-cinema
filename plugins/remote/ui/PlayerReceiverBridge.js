// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Player bridge mounted in playerOverlays.
// Exposes direct player control (seek, playNext) to the ReceiverBridge and
// reports high-precision playback progress to the server so remotes stay in sync.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');
const {
    getState,
    registerPlayerBridge,
    unregisterPlayerBridge,
} = require('./remoteState');

const REPORT_INTERVAL_MS = 5000;

const PlayerReceiverBridge = (props) => {
    const {
        title,
        videoId,
        paused,
        seekTo,
        playNext,
    } = props;

    const latestProps = React.useRef(props);
    latestProps.current = props;

    // Register active player callbacks for direct control
    React.useEffect(() => {
        registerPlayerBridge({
            seekTo: (ms) => {
                if (typeof seekTo === 'function') seekTo(ms);
            },
            playNext: () => {
                if (typeof playNext === 'function') playNext();
            },
            onPlay: () => {
                const video = document.querySelector('video');
                if (video) video.play();
            },
            onPause: () => {
                const video = document.querySelector('video');
                if (video) video.pause();
            },
        });

        return () => {
            unregisterPlayerBridge();
        };
    }, [seekTo, playNext]);

    // Report playback state to server
    const reportState = React.useCallback(() => {
        const s = getState();
        if (!s.isReceiverEnabled || !s.deviceId) return;
        const p = latestProps.current;
        if (p.live) return;

        const video = typeof document !== 'undefined' ? document.querySelector('video') : null;
        const volume = video ? Math.round(video.volume * 100) : 100;
        const muted = video ? video.muted : false;

        const body = {
            targetId: s.deviceId,
            state: p.paused ? 'paused' : 'playing',
            nowPlaying: {
                title: p.title || '',
                showName: p.showName || '',
                type: p.type || null,
                metaId: p.metaId || null,
                videoId: p.videoId || null,
                poster: p.poster || '',
                streamUrl: p.streamUrl || '',
                timeMs: Number.isFinite(p.timeMs) ? Math.round(p.timeMs) : 0,
                durationMs: Number.isFinite(p.durationMs) ? Math.round(p.durationMs) : 0,
                paused: !!p.paused,
                volume,
                muted,
            },
        };

        api('POST', '/api/remote/target/state', body, pm.profileHeaders()).catch(() => undefined);
    }, []);

    // Report on play/pause and time changes
    React.useEffect(() => {
        reportState();
    }, [reportState, paused, videoId, title]);

    // Interval heartbeat while playing
    React.useEffect(() => {
        const timer = setInterval(reportState, REPORT_INTERVAL_MS);
        return () => {
            clearInterval(timer);
            // Report idle on player exit
            const s = getState();
            if (s.isReceiverEnabled && s.deviceId) {
                api('POST', '/api/remote/target/state', {
                    targetId: s.deviceId,
                    state: 'idle',
                    nowPlaying: null,
                }, pm.profileHeaders()).catch(() => undefined);
            }
        };
    }, [reportState]);

    return null;
};

PlayerReceiverBridge.propTypes = {
    title: PropTypes.string,
    showName: PropTypes.string,
    type: PropTypes.string,
    metaId: PropTypes.string,
    videoId: PropTypes.string,
    poster: PropTypes.string,
    streamUrl: PropTypes.string,
    timeMs: PropTypes.number,
    durationMs: PropTypes.number,
    paused: PropTypes.bool,
    live: PropTypes.bool,
    seekTo: PropTypes.func,
    playNext: PropTypes.func,
};

module.exports = PlayerReceiverBridge;
