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

// English fallback, so a language without the key still gets a readable label
const label = (key, defaultValue) => t(key, { defaultValue });

const Skip10BackIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 512 512">
        <path fill="currentColor" d="m256.6 78.1 27.01-26.7c1.25-1.23 2.26-2.69 2.94-4.31a13.5 13.5 0 0 0 1.02-5.14c0-1.75-.35-3.51-1.02-5.13-.68-1.62-1.69-3.08-2.94-4.31-2.58-2.51-6.01-3.9-9.6-3.9-3.6 0-7.04 1.39-9.6 3.9l-51.5 50.8a13.1 13.1 0 0 0-2.95 4.31 13.4 13.4 0 0 0-1.03 5.13c0 1.76.35 3.51 1.03 5.14.69 1.62 1.68 3.09 2.95 4.31l51.5 50.81c2.56 2.49 6 3.89 9.6 3.89 3.59 0 7.02-1.4 9.6-3.89 1.25-1.23 2.26-2.7 2.94-4.32a13.4 13.4 0 0 0 0-10.26c-.68-1.62-1.69-3.09-2.94-4.32L256.7 107.5c86 .4 155.91 70.5 155.91 156.6 0 86.4-70.31 156.7-156.7 156.7-86.41 0-156.71-70.3-156.71-156.7 0-3.93-1.56-7.69-4.33-10.46a14.78 14.78 0 0 0-10.47-4.34c-3.93 0-7.68 1.56-10.46 4.34a14.76 14.76 0 0 0-4.34 10.46c0 102.71 83.5 186.21 186.21 186.21 102.7 0 186.19-83.5 186.19-186.21.2-102.3-82.99-185.6-185.4-186" />
        <path fill="currentColor" d="M187.5 236.3c1.61-1.29 4.61-4.1 8.8-8.3l-.4 12.5-.19 11.4v69.4H221V201.4h-20.8l-38.59 30.7 12.2 15.2z" />
        <path fill="currentColor" fillRule="evenodd" d="M288 201c23 0 38 18 38 45v30c0 27-15 45-38 45s-38-18-38-45v-30c0-27 15-45 38-45zm0 24c-11 0-16 10-16 23v26c0 13 5 23 16 23s16-10 16-23v-26c0-13-5-23-16-23z" />
    </svg>
);

Skip10BackIcon.propTypes = {
    className: PropTypes.string,
};

const Skip10ForwardIcon = ({ className }) => (
    <svg className={className} viewBox="0 0 512 512">
        <path fill="currentColor" d="M428.8 249.61c-3.96.01-7.74 1.58-10.54 4.36a14.96 14.96 0 0 0-4.36 10.53c0 87.11-70.81 157.9-157.91 157.9-87.09 0-157.9-70.79-157.9-157.9 0-86.79 70.41-157.4 157.1-157.89l-27.1 26.79a13.3 13.3 0 0 0-2.94 4.36c-.68 1.63-1.03 3.37-1.03 5.14 0 1.78.35 3.52 1.03 5.15a13.3 13.3 0 0 0 2.94 4.36 14.053 14.053 0 0 0 19.41 0l51.9-51.21c1.25-1.23 2.25-2.71 2.94-4.34a13.5 13.5 0 0 0 0-10.3c-.69-1.63-1.69-3.12-2.94-4.36L247.5 31a14.024 14.024 0 0 0-19.41 0 13.36 13.36 0 0 0-3.97 9.5c0 1.77.35 3.53 1.03 5.16s1.68 3.1 2.94 4.34l27.2 26.9c-103.1.4-186.9 84.41-186.9 187.6 0 103.51 84.2 187.61 187.6 187.61 103.41 0 187.7-84.21 187.7-187.7-.01-3.95-1.58-7.71-4.37-10.5-2.8-2.77-6.58-4.31-10.52-4.3" />
        <path fill="currentColor" d="M195.19 252.01v69.89h25.51V201.1h-21.01l-38.9 31 12.3 15.4L187 236.3c3.07-2.61 6.01-5.37 8.8-8.3l-.41 12.6z" />
        <path fill="currentColor" fillRule="evenodd" d="M288 201c23 0 38 18 38 45v30c0 27-15 45-38 45s-38-18-38-45v-30c0-27 15-45 38-45zm0 24c-11 0-16 10-16 23v26c0 13 5 23 16 23s16-10 16-23v-26c0-13-5-23-16-23z" />
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
    statisticsAvailable,
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
    onToggleSpeedMenu,
    onToggleSideDrawer,
    onToggleOptionsMenu,
    onToggleStatisticsMenu,
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
    const onAudioSubtitlesButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.subtitlesMenuClosePrevented = true;
        event.nativeEvent.audioMenuClosePrevented = true;
    }, []);
    const hasSubtitlesOrAudio = (Array.isArray(subtitlesTracks) && subtitlesTracks.length > 0) || (Array.isArray(audioTracks) && audioTracks.length > 0);
    const onSpeedButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.speedMenuClosePrevented = true;
    }, []);
    const onVideosButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.videosMenuClosePrevented = true;
    }, []);
    const onOptionsButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.optionsMenuClosePrevented = true;
    }, []);
    const onStatisticsButtonMouseDown = React.useCallback((event) => {
        event.nativeEvent.statisticsMenuClosePrevented = true;
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
                    aria-label={label('PLAYER_BACK_10', 'Back 10 seconds')}
                    title={`${label('PLAYER_BACK_10', 'Back 10 seconds')} (←)`}
                    tabIndex={-1}
                    onClick={onRewind10Click}
                >
                    <Skip10BackIcon className={styles['icon']} />
                </Button>
                <Button
                    className={classnames(styles['control-bar-button'], { 'disabled': !seekable })}
                    role="button"
                    aria-label={label('PLAYER_FORWARD_10', 'Forward 10 seconds')}
                    title={`${label('PLAYER_FORWARD_10', 'Forward 10 seconds')} (→)`}
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
                            aria-label={label('PLAYER_NEXT_VIDEO', 'Next episode')}
                            title={`${label('PLAYER_NEXT_VIDEO', 'Next episode')} (Shift+N)`}
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
                    aria-label={label('PLAYER_CONTROLS', 'Controls')}
                    title={label('PLAYER_CONTROLS', 'Controls')}
                    onClick={toggleButtonsMenu}
                >
                    <Icon className={styles['icon']} name={'more-vertical'} />
                </Button>
                <div className={classnames(styles['control-bar-buttons-menu-container'], { 'open': buttonsMenuOpen })}>
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': !hasSubtitlesOrAudio })}
                        role="button"
                        aria-label={label('PLAYER_AUDIO_SUBTITLES', 'Audio & subtitles')}
                        title={`${label('PLAYER_AUDIO_SUBTITLES', 'Audio & subtitles')} (S / A)`}
                        tabIndex={-1}
                        onMouseDown={onAudioSubtitlesButtonMouseDown}
                        onClick={onToggleSubtitlesMenu}
                    >
                        <Icon className={styles['icon']} name={'subtitles'} />
                    </Button>
                    {
                        metaItem?.content?.videos?.length > 0 ?
                            <Button
                                className={styles['control-bar-button']}
                                role="button"
                                aria-label={label('PLAYER_EPISODES', 'Episodes')}
                                title={label('PLAYER_EPISODES', 'Episodes')}
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
                        aria-label={label('PLAYER_SPEED', 'Playback speed')}
                        title={`${label('PLAYER_SPEED', 'Playback speed')} · ${playbackSpeed || 1}× (R)`}
                        tabIndex={-1}
                        onMouseDown={onSpeedButtonMouseDown}
                        onClick={onToggleSpeedMenu}
                    >
                        <Icon className={styles['icon']} name={'speed'} />
                    </Button>
                    <Button
                        className={classnames(styles['control-bar-button'], { 'disabled': castButtonDisabled })}
                        role="button"
                        aria-label={label('PLAYER_CAST', 'Cast to device')}
                        title={label('PLAYER_CAST', 'Cast to device')}
                        tabIndex={-1}
                        onMouseDown={onCastDevicesButtonMouseDown}
                        onClick={onChromecastButtonClick}
                    >
                        <Icon className={styles['icon']} name={'cast'} />
                    </Button>
                    {
                        statisticsAvailable &&
                            <Button
                                className={styles['control-bar-button']}
                                role="button"
                                aria-label={label('PLAYER_STATISTICS', 'Network statistics')}
                                title={`${label('PLAYER_STATISTICS', 'Network statistics')} (D)`}
                                tabIndex={-1}
                                onMouseDown={onStatisticsButtonMouseDown}
                                onClick={onToggleStatisticsMenu}
                            >
                                <Icon className={styles['icon']} name={'network'} />
                            </Button>
                    }
                    {
                        typeof onToggleFullscreen === 'function' ?
                            <Button
                                className={styles['control-bar-button']}
                                role="button"
                                aria-label={fullscreen ? label('PLAYER_EXIT_FULLSCREEN', 'Exit full screen') : label('PLAYER_FULLSCREEN', 'Full screen')}
                                title={`${fullscreen ? label('PLAYER_EXIT_FULLSCREEN', 'Exit full screen') : label('PLAYER_FULLSCREEN', 'Full screen')} (F)`}
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
                        aria-label={label('PLAYER_MORE', 'More')}
                        title={label('PLAYER_MORE', 'More')}
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
