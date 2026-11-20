// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Slide-over Cast & Remote Control Sheet mounted in appOverlays.

const React = require('react');
const classnames = require('classnames');
const { useRemoteState } = require('./remoteState');
const { formatTime } = require('./logic');
const styles = require('./styles.less');

const RemoteSheet = () => {
    const {
        isSheetOpen,
        closeSheet,
        selectedTargetId,
        selectTarget,
        disconnectTarget,
        targets,
        remoteNowPlaying,
        sendCommand,
        toastMessage,
        connectedControllers,
    } = useRemoteState();

    const selectedTarget = selectedTargetId ? targets.find((t) => t.id === selectedTargetId) : null;
    const isPlaying = remoteNowPlaying && !remoteNowPlaying.paused;

    const [scrubTime, setScrubTime] = React.useState(null);
    const currentTime = scrubTime !== null ? scrubTime : (remoteNowPlaying ? remoteNowPlaying.timeMs : 0);
    const duration = remoteNowPlaying ? remoteNowPlaying.durationMs : 0;

    const handleSeekChange = (e) => {
        setScrubTime(Number(e.target.value));
    };

    const handleSeekCommit = () => {
        if (scrubTime !== null) {
            sendCommand('seek', { timeMs: scrubTime });
            setScrubTime(null);
        }
    };

    const handleVolumeChange = (e) => {
        sendCommand('setVolume', { volume: Number(e.target.value) });
    };

    const handleKey = (keyName) => {
        sendCommand('key', { key: keyName });
    };

    if (!isSheetOpen) return null;

    return (
        <div className={styles['sheet-container']}>
            {/* Scrim backdrop */}
            <div className={styles['sheet-scrim']} onClick={closeSheet} />

            {/* Slide-over panel */}
            <div className={styles['sheet-panel']}>
                {/* Header */}
                <div className={styles['sheet-head']}>
                    <div className={styles['sheet-head-title']}>
                        <svg className={styles['sheet-head-icon']} viewBox="0 0 24 24" fill="currentColor">
                            <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                        </svg>
                        <span>Remote & Cast</span>
                    </div>
                    <button type="button" className={styles['sheet-close-btn']} onClick={closeSheet} title="Close">
                        &times;
                    </button>
                </div>

                {/* Toast notice inside sheet */}
                {toastMessage ? (
                    <div className={styles['sheet-toast']}>{toastMessage}</div>
                ) : null}

                <div className={styles['sheet-body']}>
                    {/* Active incoming remotes controlling this screen */}
                    {connectedControllers && connectedControllers.length > 0 ? (
                        <div className={styles['section']}>
                            <div className={styles['section-label']}>Remotes Controlling This Screen</div>
                            <div className={styles['device-list']}>
                                {connectedControllers.map((c) => (
                                    <div key={c.id} className={classnames(styles['device-card'], styles['active'])}>
                                        <div className={styles['device-icon']}>📱</div>
                                        <div className={styles['device-info']}>
                                            <div className={styles['device-name']}>{c.name}</div>
                                            <div className={styles['device-sub']}>{c.device} · Active Controller</div>
                                        </div>
                                        <span className={styles['device-badge-active']}>Controlling</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {/* 1. Device Picker Section */}
                    <div className={styles['section']}>
                        <div className={styles['section-label']}>Target Screens</div>
                        <div className={styles['device-list']}>
                            {/* Option: This Device */}
                            <div
                                className={classnames(styles['device-card'], { [styles['active']]: !selectedTargetId })}
                                onClick={() => disconnectTarget()}
                            >
                                <div className={styles['device-icon']}>📱</div>
                                <div className={styles['device-info']}>
                                    <div className={styles['device-name']}>This Device</div>
                                    <div className={styles['device-sub']}>Local playback</div>
                                </div>
                                {!selectedTargetId ? (
                                    <span className={styles['device-badge-active']}>Selected</span>
                                ) : null}
                            </div>

                            {/* Remote target screens */}
                            {targets.map((t) => {
                                const isCurrent = t.id === selectedTargetId;
                                const isPlayingHere = t.state === 'playing' && t.nowPlaying;
                                return (
                                    <div
                                        key={t.id}
                                        className={classnames(styles['device-card'], { [styles['active']]: isCurrent })}
                                        onClick={() => selectTarget(t.id)}
                                    >
                                        <div className={styles['device-icon']}>{t.isDesktop ? '🖥️' : '📺'}</div>
                                        <div className={styles['device-info']}>
                                            <div className={styles['device-name']}>{t.name}</div>
                                            <div className={styles['device-sub']}>
                                                {isPlayingHere ? (
                                                    <span className={styles['playing-indicator']}>
                                                        Playing: {t.nowPlaying.title}
                                                    </span>
                                                ) : (
                                                    <span>{t.device} · {t.online ? 'Online' : 'Idle'}</span>
                                                )}
                                            </div>
                                        </div>
                                        {isCurrent ? (
                                            <span className={styles['device-badge-active']}>Connected</span>
                                        ) : (
                                            <button type="button" className={styles['device-cast-btn']}>
                                                Cast
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Controls Section (visible when a target is connected) */}
                    {selectedTarget ? (
                        <>
                            {/* Now Playing card */}
                            {remoteNowPlaying ? (
                                <div className={styles['section']}>
                                    <div className={styles['section-label']}>Now Playing on {selectedTarget.name}</div>
                                    <div className={styles['now-playing-card']}>
                                        <div className={styles['np-top']}>
                                            {remoteNowPlaying.poster ? (
                                                <img className={styles['np-poster']} src={remoteNowPlaying.poster} alt="" />
                                            ) : null}
                                            <div className={styles['np-meta']}>
                                                <div className={styles['np-title']}>
                                                    {remoteNowPlaying.showName
                                                        ? `${remoteNowPlaying.showName} - ${remoteNowPlaying.title}`
                                                        : remoteNowPlaying.title || 'Playing Media'}
                                                </div>
                                                <div className={styles['np-time']}>
                                                    {formatTime(currentTime)} / {formatTime(duration)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Seek slider */}
                                        {duration > 0 ? (
                                            <div className={styles['np-seek']}>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max={duration}
                                                    value={currentTime}
                                                    onChange={handleSeekChange}
                                                    onMouseUp={handleSeekCommit}
                                                    onTouchEnd={handleSeekCommit}
                                                    className={styles['seek-slider']}
                                                />
                                            </div>
                                        ) : null}

                                        {/* Media playback transport buttons */}
                                        <div className={styles['transport-row']}>
                                            <button
                                                type="button"
                                                className={styles['ctrl-btn']}
                                                title="Rewind 10s"
                                                onClick={() => sendCommand('seek', { deltaSec: -10 })}
                                            >
                                                <svg viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                                                </svg>
                                            </button>

                                            <button
                                                type="button"
                                                className={classnames(styles['ctrl-btn'], styles['ctrl-play'])}
                                                title={isPlaying ? 'Pause' : 'Play'}
                                                onClick={() => sendCommand(isPlaying ? 'pause' : 'resume')}
                                            >
                                                {isPlaying ? (
                                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                                    </svg>
                                                ) : (
                                                    <svg viewBox="0 0 24 24" fill="currentColor">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                )}
                                            </button>

                                            <button
                                                type="button"
                                                className={styles['ctrl-btn']}
                                                title="Forward 10s"
                                                onClick={() => sendCommand('seek', { deltaSec: 10 })}
                                            >
                                                <svg viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                                                </svg>
                                            </button>

                                            <button
                                                type="button"
                                                className={styles['ctrl-btn']}
                                                title="Next Episode"
                                                onClick={() => sendCommand('next')}
                                            >
                                                <svg viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                                </svg>
                                            </button>
                                        </div>

                                        {/* Volume slider */}
                                        <div className={styles['volume-row']}>
                                            <button
                                                type="button"
                                                className={styles['vol-mute-btn']}
                                                title="Mute toggle"
                                                onClick={() => sendCommand('mute', { muted: !remoteNowPlaying.muted })}
                                            >
                                                <svg viewBox="0 0 24 24" fill="currentColor">
                                                    {remoteNowPlaying.muted ? (
                                                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                                                    ) : (
                                                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                                                    )}
                                                </svg>
                                            </button>
                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={remoteNowPlaying.volume !== undefined ? remoteNowPlaying.volume : 100}
                                                onChange={handleVolumeChange}
                                                className={styles['volume-slider']}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            {/* Virtual D-Pad section */}
                            <div className={styles['section']}>
                                <div className={styles['section-label']}>Navigation Controller</div>
                                <div className={styles['dpad-container']}>
                                    <div className={styles['dpad']}>
                                        <button
                                            type="button"
                                            className={classnames(styles['dpad-btn'], styles['dpad-up'])}
                                            onClick={() => handleKey('ArrowUp')}
                                            title="Up"
                                        >
                                            ▲
                                        </button>
                                        <div className={styles['dpad-middle']}>
                                            <button
                                                type="button"
                                                className={classnames(styles['dpad-btn'], styles['dpad-left'])}
                                                onClick={() => handleKey('ArrowLeft')}
                                                title="Left"
                                            >
                                                ◀
                                            </button>
                                            <button
                                                type="button"
                                                className={classnames(styles['dpad-btn'], styles['dpad-ok'])}
                                                onClick={() => handleKey('Enter')}
                                                title="OK / Select"
                                            >
                                                OK
                                            </button>
                                            <button
                                                type="button"
                                                className={classnames(styles['dpad-btn'], styles['dpad-right'])}
                                                onClick={() => handleKey('ArrowRight')}
                                                title="Right"
                                            >
                                                ▶
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            className={classnames(styles['dpad-btn'], styles['dpad-down'])}
                                            onClick={() => handleKey('ArrowDown')}
                                            title="Down"
                                        >
                                            ▼
                                        </button>
                                    </div>

                                    {/* Action row under D-pad */}
                                    <div className={styles['dpad-actions']}>
                                        <button
                                            type="button"
                                            className={styles['aux-btn']}
                                            onClick={() => handleKey('Escape')}
                                            title="Back"
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="button"
                                            className={styles['aux-btn']}
                                            onClick={() => sendCommand('navigate', { path: '#/' })}
                                            title="Home"
                                        >
                                            Home
                                        </button>
                                        <button
                                            type="button"
                                            className={styles['aux-btn']}
                                            onClick={() => handleKey('KeyF')}
                                            title="Fullscreen"
                                        >
                                            Full
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Full remote route button */}
                            <div className={styles['full-remote-link-row']}>
                                <a
                                    href="#/remote"
                                    className={styles['full-remote-btn']}
                                    onClick={closeSheet}
                                >
                                    Open Full Screen Remote Page
                                </a>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

module.exports = RemoteSheet;
