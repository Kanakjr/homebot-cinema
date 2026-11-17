// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { Button } = require('stremio/components');
const { useServices } = require('stremio/services');
const SeekBar = require('./SeekBar');
const VolumeSlider = require('./VolumeSlider');
const styles = require('./styles');
const { useBinaryState, usePlatform } = require('stremio/common');
const { PluginSlot } = require('stremio/plugins');
const { t } = require('i18next');

const Skip10BackIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4.5A7.5 7.5 0 1 0 19.5 12" />
        <polyline points="12 1 12 5 8 5" />
        <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7.5" fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif">10</text>
    </svg>
);

Skip10BackIcon.propTypes = {
    className: PropTypes.string,
};

const Skip10ForwardIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4.5A7.5 7.5 0 1 1 4.5 12" />
        <polyline points="12 1 12 5 16 5" />
        <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7.5" fontWeight="700" fontFamily="system-ui, -apple-system, sans-serif">10</text>
    </svg>
);

Skip10ForwardIcon.propTypes = {
    className: PropTypes.string,
};

const ControlBar = React.forwardRef(({
    className,
    paused,
    time,
    duration,
    buffered,
    volume,
    muted,
    playbackSpeed,
    subtitlesTracks,
    audioTracks,
    metaItem,
    nextVideo,
    stream,
    fullscreen,
    onToggleFullscreen,
    onPlayRequested,
    onPauseRequested,
    onNextVideoRequested,
    onMuteRequested,
    onUnmuteRequested,
    onVolumeChangeRequested,
    onSeekRequested,
    onToggleSubtitlesMenu,
    onToggleAudioMenu,
    onToggleSpeedMenu,
    onToggleSideDrawer,
    onToggleOptionsMenu,
    shellCastSupported,
    onToggleCastDevicesMenu,
    live,
    liveTiming,
    seekable,
    buffering,
    onTouchEnd,
    markers, // HomeBot: intro/credits marks for the seek bar (slot playerOverlays)
    ...props
}, ref) => {
    const { chromecast } = useServices();
    const platform = usePlatform();
    const [chromecastServiceActive, setChromecastServiceActive] = React.useState(() => chromecast.active);
    const [buttonsMenuOpen, , , toggleButtonsMenu] = useBinaryState(false);
    const onSubtitlesButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.subtitlesMenuClosePrevented = true;
    }, []);
    const onAudioButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.audioMenuClosePrevented = true;
    }, []);
    const onSpeedButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.speedMenuClosePrevented = true;
    }, []);
    const onVideosButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.videosMenuClosePrevented = true;
    }, []);
    const onOptionsButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.optionsMenuClosePrevented = true;
    }, []);
    const onCastDevicesButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.castDevicesMenuClosePrevented = true;
    }, []);
    const onPlayPauseButtonClick = React.useCallback(() => {
        if (paused) {
            if (typeof onPlayRequested === 'function') {
                onPlayRequested();
            }
        } else {
            if (typeof onPauseRequested === 'function') {
                onPauseRequested();
            }
        }
    }, [paused, onPlayRequested, onPauseRequested]);
    const onRewind10Click = React.useCallback(() => {
        if (typeof onSeekRequested === 'function') {
            onSeekRequested(Math.max(0, (time || 0) - 10000));
        }
    }, [onSeekRequested, time]);
    const onForward10Click = React.useCallback(() => {
        if (typeof onSeekRequested === 'function') {
            onSeekRequested(Math.min(duration || 0, (time || 0) + 10000));
        }
    }, [onSeekRequested, time, duration]);
    const onNextVideoButtonClick = React.useCallback(() => {
        if (nextVideo !== null && typeof onNextVideoRequested === 'function') {
            onNextVideoRequested();
        }
    }, [nextVideo, onNextVideoRequested]);
    const onMuteButtonClick = React.useCallback(() => {
        if (muted) {
            if (typeof onUnmuteRequested === 'function') {
                onUnmuteRequested();
            }
        } else {
            if (typeof onMuteRequested === 'function') {
                onMuteRequested();
            }
        }
    }, [muted, onMuteRequested, onUnmuteRequested]);
    const castButtonDisabled = platform.shell.active ? !shellCastSupported : !chromecastServiceActive;
    const onChromecastButtonClick = React.useCallback(() => {
        if (platform.shell.active) {
            if (shellCastSupported && typeof onToggleCastDevicesMenu === 'function') {
                onToggleCastDevicesMenu();
            }
            return;
        }
        if (castButtonDisabled) {
            return;
        }
        chromecast.transport.requestSession();
    }, [castButtonDisabled, platform.shell.active, shellCastSupported, onToggleCastDevicesMenu]);
    React.useEffect(() => {
        const onStateChanged = () => {
            setChromecastServiceActive(chromecast.active);
        };
        chromecast.on('stateChanged', onStateChanged);
        return () => {
            chromecast.off('stateChanged', onStateChanged);
        };
    }, []);
    return (
        <div ref={ref} {...props} onTouchStart={props.onMouseOver} onTouchMove={props.onMouseMove} onTouchEnd={onTouchEnd} className={classnames(className, styles['control-bar-container'])}>
            <SeekBar
                className={styles['seek-bar']}
                time={time}
                duration={duration}
                buffered={buffered}
                onSeekRequested={onSeekRequested}
                playbackSpeed={playbackSpeed}
                live={live}
                liveTiming={liveTiming}
                paused={paused}
                onPlayRequested={onPlayRequested}
                seekable={seekable}
                buffering={buffering}
                markers={markers}
            />
            <div className={styles['control-bar-buttons-container']}>
                <Button
                    className={classnames(styles['control-bar-button'], { 'disabled': typeof paused !== 'boolean' })}
                    role="button"
                    aria-label={paused ? t('PLAYER_PLAY') : t('PLAYER_PAUSE')}
                    title={paused ? `${t('PLAYER_PLAY')} (Space)` : `${t('PLAYER_PAUSE')} (Space)`}
                    tabIndex={-1}
                    onClick={onPlayPauseButtonClick}
                >
                    <Icon className={styles['icon']} name={typeof paused !== 'boolean' || paused ? 'play' : 'pause'} />
                </Button>
                <Button
                    className={classnames(styles['control-bar-button'], { 'disabled': !seekable })}
                    role="button"
                    aria-label="Rewind 10 seconds"
                    title="Rewind 10 seconds (Left Arrow)"
                    tabIndex={-1}
                    onClick={onRewind10Click}
                >
                    <Skip10BackIcon className={styles['icon']} />
                </Button>
                <Button
                    className={classnames(styles['control-bar-button'], { 'disabled': !seekable })}
                    role="button"
                    aria-label="Fast forward 10 seconds"
                    title="Fast forward 10 seconds (Right Arrow)"
                    tabIndex={-1}
                    onClick={onForward10Click}
                >
                    <Skip10ForwardIcon className={styles['icon']} />
                </Button>
                {
                    nextVideo !== null ?
                        <Button
                            className={classnames(styles['control-bar-button'])}
                            role="button"
                            aria-label={t('PLAYER_NEXT_VIDEO') || 'Next Video'}
                            title={`${t('PLAYER_NEXT_VIDEO') || 'Next Video'} (N)`}
                            tabIndex={-1}
                            onClick={onNextVideoButtonClick}
                        >
                            <Icon className={styles['icon']} name={'next'} />
                        </Button>
                        :
                        null
                }
                <Button
                    className={classnames(styles['control-bar-button'], { 'disabled': typeof muted !== 'boolean' })}
                    role="button"
                    aria-label={muted ? t('PLAYER_UNMUTE') : t('PLAYER_MUTE')}
                    title={muted ? `${t('PLAYER_UNMUTE')} (M)` : `${t('PLAYER_MUTE')} (M)`}
                    tabIndex={-1}
                    onClick={onMuteButtonClick}
                >
                    <Icon
                        className={styles['icon']}
                        name={
                            (typeof muted === 'boolean' && muted) ? 'volume-mute' :
                                (volume === null || isNaN(volume)) ? 'volume-off' :
                                    volume === 0 ? 'volume-mute' :
                                        volume < 30 ? 'volume-low' :
                                            volume < 70 ? 'volume-medium' :
                                                'volume-high'
                        }
                    />
                </Button>
                {
                    !platform.isMobile ?
                        <VolumeSlider
                            className={styles['volume-slider']}
                            volume={volume}
                            muted={muted}
                            onVolumeChangeRequested={onVolumeChangeRequested}
                        />
                        : null
                }
                <div className={styles['spacing']} />
                <Button
                    className={styles['control-bar-buttons-menu-button']}
                    role="button"
                    aria-label="Toggle Controls Menu"
                    title="Controls"
                    onClick={toggleButtonsMenu}
                >
                    <Icon className={styles['icon']} name={'more-vertical'} />
                </Button>
                <div className={classnames(styles['control-bar-buttons-menu-container'], { 'open': buttonsMenuOpen })}>
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': !Array.isArray(subtitlesTracks) || subtitlesTracks.length === 0 })}
                        role="button"
                        aria-label={t('SUBTITLES') || 'Subtitles'}
                        title={`${t('SUBTITLES') || 'Subtitles'} (S)`}
                        tabIndex={-1}
                        onMouseDown={onSubtitlesButtonMouseDown}
                        onClick={onToggleSubtitlesMenu}
                    >
                        <Icon className={styles['icon']} name={'subtitles'} />
                    </Button>
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': !Array.isArray(audioTracks) || audioTracks.length === 0 })}
                        role="button"
                        aria-label={t('AUDIO_TRACKS') || 'Audio Tracks'}
                        title={`${t('AUDIO_TRACKS') || 'Audio Tracks'} (A)`}
                        tabIndex={-1}
                        onMouseDown={onAudioButtonMouseDown}
                        onClick={onToggleAudioMenu}
                    >
                        <Icon className={styles['icon']} name={'audio-tracks'} />
                    </Button>
                    {
                        metaItem?.content?.videos?.length > 0 ?
                            <Button
                                className={styles['control-bar-button']}
                                role="button"
                                aria-label={t('EPISODES') || 'Episodes'}
                                title={`${t('EPISODES') || 'Episodes'} (E)`}
                                tabIndex={-1}
                                onMouseDown={onVideosButtonMouseDown}
                                onClick={onToggleSideDrawer}
                            >
                                <Icon className={styles['icon']} name={'episodes'} />
                            </Button>
                            :
                            null
                    }
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': playbackSpeed === null })}
                        role="button"
                        aria-label="Playback Speed"
                        title={`Playback Speed (${playbackSpeed || 1}x)`}
                        tabIndex={-1}
                        onMouseDown={onSpeedButtonMouseDown}
                        onClick={onToggleSpeedMenu}
                    >
                        <Icon className={styles['icon']} name={'speed'} />
                    </Button>
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': castButtonDisabled })}
                        role="button"
                        aria-label="Cast to Device"
                        title="Cast to Device"
                        tabIndex={-1}
                        onMouseDown={onCastDevicesButtonMouseDown}
                        onClick={onChromecastButtonClick}
                    >
                        <Icon className={styles['icon']} name={'cast'} />
                    </Button>
                    {
                        typeof onToggleFullscreen === 'function' ?
                            <Button
                                className={styles['control-bar-button']}
                                role="button"
                                aria-label={fullscreen ? 'Exit Full Screen' : 'Full Screen'}
                                title={fullscreen ? 'Exit Full Screen (F)' : 'Full Screen (F)'}
                                tabIndex={-1}
                                onClick={onToggleFullscreen}
                            >
                                <Icon className={styles['icon']} name={fullscreen ? 'minimize' : 'maximize'} />
                            </Button>
                            :
                            null
                    }
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': !stream })}
                        role="button"
                        aria-label="More Options"
                        title="More Options"
                        tabIndex={-1}
                        onMouseDown={onOptionsButtonMouseDown}
                        onClick={onToggleOptionsMenu}
                    >
                        <Icon className={styles['icon']} name={'more-horizontal'} />
                    </Button>
                    {/* HomeBot: player controls slot (MetalFX 4K AI upscaler button, ...) */}
                    <PluginSlot name={'playerControls'} stream={stream} />
                </div>
            </div>
        </div>
    );
});

ControlBar.propTypes = {
    className: PropTypes.string,
    paused: PropTypes.bool,
    time: PropTypes.number,
    duration: PropTypes.number,
    buffered: PropTypes.number,
    volume: PropTypes.number,
    muted: PropTypes.bool,
    playbackSpeed: PropTypes.number,
    videoScale: PropTypes.string,
    videoScaleLabel: PropTypes.string,
    live: PropTypes.bool,
    liveTiming: PropTypes.object,
    seekable: PropTypes.bool,
    buffering: PropTypes.bool,
    onVideoScaleChanged: PropTypes.func,
    subtitlesTracks: PropTypes.array,
    audioTracks: PropTypes.array,
    metaItem: PropTypes.object,
    nextVideo: PropTypes.object,
    stream: PropTypes.object,
    statisticsAvailable: PropTypes.bool,
    onPlayRequested: PropTypes.func,
    onPauseRequested: PropTypes.func,
    onNextVideoRequested: PropTypes.func,
    onMuteRequested: PropTypes.func,
    onUnmuteRequested: PropTypes.func,
    onVolumeChangeRequested: PropTypes.func,
    onSeekRequested: PropTypes.func,
    onToggleSubtitlesMenu: PropTypes.func,
    onToggleAudioMenu: PropTypes.func,
    onToggleSpeedMenu: PropTypes.func,
    onToggleSideDrawer: PropTypes.func,
    onToggleOptionsMenu: PropTypes.func,
    shellCastSupported: PropTypes.bool,
    onToggleCastDevicesMenu: PropTypes.func,
    fullscreen: PropTypes.bool,
    onToggleFullscreen: PropTypes.func,
    onToggleStatisticsMenu: PropTypes.func,
    onToggleShortcutsModal: PropTypes.func,
    onMouseOver: PropTypes.func,
    onMouseMove: PropTypes.func,
    onTouchEnd: PropTypes.func,
    markers: PropTypes.array, // HomeBot
};

module.exports = ControlBar;
