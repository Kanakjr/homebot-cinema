// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Dedicated TV Remote Page (route #/remote).
// Optimized for mobile phones (e.g. Android) to control the Mac Mini from the couch.

const React = require('react');
const classnames = require('classnames');
const { useRemoteState } = require('./remoteState');
const { formatTime } = require('./logic');
const styles = require('./styles.less');

const RemoteRoute = () => {
    const {
        deviceId,
        selectedTargetId,
        selectTarget,
        disconnectTarget,
        targets,
        remoteNowPlaying,
        sendCommand,
        toastMessage,
    } = useRemoteState();

    const [searchQuery, setSearchQuery] = React.useState('');
    const [scrubTime, setScrubTime] = React.useState(null);

    const remoteTargets = React.useMemo(() => {
        const filtered = (targets || []).filter((t) => t && t.id && t.id !== deviceId);
        // Deduplicate stale targets sharing the same name & device, keeping the online / most recently updated entry
        const byKey = new Map();
        for (const t of filtered) {
            const key = `${t.name}::${t.device || ''}`;
            const prev = byKey.get(key);
            if (!prev || (!prev.online && t.online) || String(t.updatedAt || '') > String(prev.updatedAt || '')) {
                byKey.set(key, t);
            }
        }
        return Array.from(byKey.values());
    }, [targets, deviceId]);

    const selectedTarget = selectedTargetId ? targets.find((t) => t.id === selectedTargetId) : null;
    const isPlaying = remoteNowPlaying && !remoteNowPlaying.paused;

    const currentTime = scrubTime !== null ? scrubTime : (remoteNowPlaying ? remoteNowPlaying.timeMs : 0);
    const duration = remoteNowPlaying ? remoteNowPlaying.durationMs : 0;

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            sendCommand('search', { query: searchQuery.trim() });
            setSearchQuery('');
        }
    };

    const handleSeekChange = (e) => {
        setScrubTime(Number(e.target.value));
    };

    const handleSeekCommit = () => {
        if (scrubTime !== null) {
            sendCommand('seek', { timeMs: scrubTime });
            setScrubTime(null);
        }
    };

    const handleVolumeStep = (delta) => {
        const cur = remoteNowPlaying && typeof remoteNowPlaying.volume === 'number' ? remoteNowPlaying.volume : 100;
        const next = Math.max(0, Math.min(100, cur + delta));
        sendCommand('setVolume', { volume: next });
    };

    const handleKey = (keyName) => {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try { navigator.vibrate(20); } catch (_) { /* ignore */ }
        }
        sendCommand('key', { key: keyName });
    };

    return (
        <div className={styles['remote-page']}>
            <div className={styles['remote-container']}>
                {/* Header with back nav & target selection */}
                <div className={styles['remote-header']}>
                    <div className={styles['remote-title-wrap']}>
                        <a href="#/" className={styles['remote-back-btn']} title="Back to Home">← Home</a>
                        <h1 className={styles['remote-page-title']}>Cinema Remote</h1>
                        <span className={styles['remote-badge']}>Live</span>
                    </div>

                    <div className={styles['target-selector-wrap']}>
                        <select
                            className={styles['target-select']}
                            value={selectedTargetId || ''}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val) selectTarget(val);
                                else disconnectTarget();
                            }}
                        >
                            <option value="">📱 This Device (Local)</option>
                            {remoteTargets.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.isDesktop ? '🖥️' : '📺'} {t.name} {t.online ? '(Online)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {toastMessage ? (
                    <div className={styles['remote-toast-banner']}>{toastMessage}</div>
                ) : null}

                {!selectedTarget ? (
                    <div className={styles['no-target-box']}>
                        <div className={styles['no-target-icon']}>📡</div>
                        <div className={styles['no-target-title']}>No Screen Connected</div>
                        <div className={styles['no-target-desc']}>
                            Select your Mac Mini or TV screen above to search and control playback remotely.
                        </div>
                        {remoteTargets.length > 0 ? (
                            <div className={styles['target-quick-pick']}>
                                {remoteTargets.map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        className={styles['quick-pick-btn']}
                                        onClick={() => selectTarget(t.id)}
                                    >
                                        Connect to {t.name}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <>
                        {/* Remote Search Bar */}
                        <form className={styles['search-form']} onSubmit={handleSearchSubmit}>
                            <input
                                type="text"
                                className={styles['search-input']}
                                placeholder={`Search on ${selectedTarget.name}...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <button type="submit" className={styles['search-btn']} title="Search">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                </svg>
                            </button>
                        </form>

                        {/* Now Playing Showcase Card */}
                        {remoteNowPlaying ? (
                            <div className={styles['showcase-card']}>
                                <div className={styles['showcase-top']}>
                                    {remoteNowPlaying.poster ? (
                                        <img className={styles['showcase-poster']} src={remoteNowPlaying.poster} alt="" />
                                    ) : null}
                                    <div className={styles['showcase-meta']}>
                                        <div className={styles['showcase-title']}>
                                            {remoteNowPlaying.showName
                                                ? `${remoteNowPlaying.showName} - ${remoteNowPlaying.title}`
                                                : remoteNowPlaying.title || 'Playing Media'}
                                        </div>
                                        <div className={styles['showcase-time']}>
                                            {formatTime(currentTime)} / {formatTime(duration)}
                                        </div>
                                    </div>
                                </div>

                                {duration > 0 ? (
                                    <div className={styles['showcase-seek']}>
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

                                <div className={styles['showcase-transport']}>
                                    <button
                                        type="button"
                                        className={styles['showcase-btn']}
                                        title="Rewind 10s"
                                        onClick={() => sendCommand('seek', { deltaSec: -10 })}
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                                        </svg>
                                    </button>

                                    <button
                                        type="button"
                                        className={classnames(styles['showcase-btn'], styles['showcase-play-btn'])}
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
                                        className={styles['showcase-btn']}
                                        title="Forward 10s"
                                        onClick={() => sendCommand('seek', { deltaSec: 10 })}
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8zm-1.1 11h-.8v-3.3l-.9.3v-.6l1.2-.4h.5V16zm3.3-1.6c0 .4-.1.7-.2.9s-.4.3-.7.3-.5-.1-.7-.3-.2-.5-.2-.9v-1.1c0-.4.1-.7.2-.9s.4-.3.7-.3.5.1.7.3.2.5.2.9v1.1zm-.8-1.2c0-.2 0-.4-.1-.5s-.1-.1-.2-.1-.2 0-.2.1-.1.3-.1.5v1.3c0 .2 0 .4.1.5s.1.1.2.1.2 0 .2-.1.1-.3.1-.5v-1.3z" />
                                        </svg>
                                    </button>

                                    <button
                                        type="button"
                                        className={styles['showcase-btn']}
                                        title="Next Episode"
                                        onClick={() => sendCommand('next')}
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {/* Virtual Directional Pad */}
                        <div className={styles['dpad-showcase']}>
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

                        {/* Volume controls */}
                        <div className={styles['volume-box']}>
                            <button
                                type="button"
                                className={styles['vol-step-btn']}
                                onClick={() => handleVolumeStep(-5)}
                                title="Volume Down"
                            >
                                -
                            </button>
                            <button
                                type="button"
                                className={styles['vol-mute-btn']}
                                onClick={() => sendCommand('mute', { muted: !(remoteNowPlaying && remoteNowPlaying.muted) })}
                                title="Mute"
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                                </svg>
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={remoteNowPlaying && remoteNowPlaying.volume !== undefined ? remoteNowPlaying.volume : 100}
                                onChange={(e) => sendCommand('setVolume', { volume: Number(e.target.value) })}
                                className={styles['volume-slider']}
                            />
                            <button
                                type="button"
                                className={styles['vol-step-btn']}
                                onClick={() => handleVolumeStep(5)}
                                title="Volume Up"
                            >
                                +
                            </button>
                        </div>

                        {/* Quick Launch Pills */}
                        <div className={styles['quick-links-row']}>
                            <button
                                type="button"
                                className={styles['quick-link-pill']}
                                onClick={() => sendCommand('navigate', { path: '#/discover/movie' })}
                            >
                                🎬 Movies
                            </button>
                            <button
                                type="button"
                                className={styles['quick-link-pill']}
                                onClick={() => sendCommand('navigate', { path: '#/discover/series' })}
                            >
                                📺 Series
                            </button>
                            <button
                                type="button"
                                className={styles['quick-link-pill']}
                                onClick={() => sendCommand('navigate', { path: '#/server-library' })}
                            >
                                💾 Library
                            </button>
                            <button
                                type="button"
                                className={styles['quick-link-pill']}
                                onClick={() => sendCommand('navigate', { path: '#/downloads' })}
                            >
                                📥 Downloads
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

module.exports = RemoteRoute;
