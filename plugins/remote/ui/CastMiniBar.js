// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Floating Cast Mini-Player bar mounted in appOverlays.
// Shown on mobile/desktop when connected to a remote screen that is currently playing.

const React = require('react');
const { useRemoteState } = require('./remoteState');
const { formatTime } = require('./logic');
const styles = require('./styles.less');

const CastMiniBar = () => {
    const {
        selectedTargetId,
        targets,
        remoteNowPlaying,
        sendCommand,
        openSheet,
    } = useRemoteState();

    const [currentHash, setCurrentHash] = React.useState(
        typeof window !== 'undefined' ? window.location.hash : ''
    );

    React.useEffect(() => {
        const onHash = () => setCurrentHash(window.location.hash);
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);

    // Don't show mini-bar if user is on the full remote route or local player
    const isFullRemote = currentHash === '#/remote' || currentHash.startsWith('#/remote');
    const isLocalPlayer = currentHash.startsWith('#/player/');

    if (!selectedTargetId || !remoteNowPlaying || isFullRemote || isLocalPlayer) {
        return null;
    }

    const target = targets.find((t) => t.id === selectedTargetId);
    const targetName = target ? target.name : 'Remote Screen';

    const {
        title,
        showName,
        poster,
        timeMs = 0,
        durationMs = 0,
        paused = false,
    } = remoteNowPlaying;

    const displayTitle = showName ? `${showName} - ${title}` : title || 'Playing Media';
    const progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, (timeMs / durationMs) * 100)) : 0;

    const handleTogglePause = (e) => {
        e.stopPropagation();
        sendCommand(paused ? 'resume' : 'pause');
    };

    const handleRewind = (e) => {
        e.stopPropagation();
        sendCommand('seek', { deltaSec: -10 });
    };

    const handleForward = (e) => {
        e.stopPropagation();
        sendCommand('seek', { deltaSec: 10 });
    };

    return (
        <div className={styles['minibar']} onClick={openSheet} role="button" tabIndex={0}>
            {/* Progress track */}
            <div className={styles['minibar-progress-track']}>
                <div
                    className={styles['minibar-progress-fill']}
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            <div className={styles['minibar-content']}>
                {poster ? (
                    <img className={styles['minibar-poster']} src={poster} alt="" />
                ) : (
                    <div className={styles['minibar-poster-placeholder']}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                        </svg>
                    </div>
                )}

                <div className={styles['minibar-info']}>
                    <div className={styles['minibar-title']}>{displayTitle}</div>
                    <div className={styles['minibar-sub']}>
                        <span className={styles['minibar-cast-badge']}>Cast</span>
                        <span>{targetName} · {formatTime(timeMs)} / {formatTime(durationMs)}</span>
                    </div>
                </div>

                <div className={styles['minibar-actions']}>
                    <button
                        type="button"
                        className={styles['minibar-btn']}
                        title="Rewind 10s"
                        onClick={handleRewind}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                        </svg>
                    </button>

                    <button
                        type="button"
                        className={`${styles['minibar-btn']} ${styles['minibar-btn-play']}`}
                        title={paused ? 'Play' : 'Pause'}
                        onClick={handleTogglePause}
                    >
                        {paused ? (
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                            </svg>
                        )}
                    </button>

                    <button
                        type="button"
                        className={styles['minibar-btn']}
                        title="Forward 10s"
                        onClick={handleForward}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

module.exports = CastMiniBar;
