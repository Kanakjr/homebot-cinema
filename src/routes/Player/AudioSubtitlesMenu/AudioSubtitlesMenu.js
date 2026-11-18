// Copyright (C) 2017-2026 HomeBot Cinema
// One panel for "Audio & subtitles": the audio tracks on the left, the subtitle menu (languages, variants, settings) next to
// it. It replaces two separate control-bar buttons, as current streaming players do.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: AudioMenu } = require('../AudioMenu');
const SubtitlesMenu = require('../SubtitlesMenu');
const styles = require('./styles');

const AudioSubtitlesMenu = React.forwardRef(({ className, audioTracks, selectedAudioTrackId, onAudioTrackSelected, subtitlesMenuProps }, ref) => {
    const onMouseDown = React.useCallback((event) => {
        // A press inside the panel (a gap, the divider) must not count as an outside click
        event.nativeEvent.audioMenuClosePrevented = true;
        event.nativeEvent.subtitlesMenuClosePrevented = true;
    }, []);
    const hasAudio = Array.isArray(audioTracks) && audioTracks.length > 0;
    return (
        <div ref={ref} className={classnames(className, styles['audio-subtitles-menu'])} onMouseDown={onMouseDown}>
            {
                hasAudio ?
                    <React.Fragment>
                        <AudioMenu
                            className={styles['column']}
                            audioTracks={audioTracks}
                            selectedAudioTrackId={selectedAudioTrackId}
                            onAudioTrackSelected={onAudioTrackSelected}
                        />
                        <div className={styles['divider']} />
                    </React.Fragment>
                    :
                    null
            }
            <SubtitlesMenu className={styles['column']} {...subtitlesMenuProps} />
        </div>
    );
});

AudioSubtitlesMenu.displayName = 'AudioSubtitlesMenu';

AudioSubtitlesMenu.propTypes = {
    className: PropTypes.string,
    audioTracks: PropTypes.array,
    selectedAudioTrackId: PropTypes.string,
    onAudioTrackSelected: PropTypes.func,
    subtitlesMenuProps: PropTypes.object,
};

module.exports = AudioSubtitlesMenu;
