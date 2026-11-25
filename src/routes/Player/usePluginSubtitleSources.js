// Copyright (C) 2017-2026 HomeBot Cinema
// HomeBot: subtitle sources contributed by plugins (slot subtitleSources), e.g. AI subtitles generated live. They are
// never on by default: the viewer picks one in the subtitles menu, and picking a real track or OFF turns it off again.
// Each source is { id, label, description?, available?(stream) }; the selected id reaches overlays as `subtitleSource`.

const React = require('react');
const { slot } = require('../../plugins/host');

const streamKeyOf = (stream) => (stream ? (stream.infoHash ? `${stream.infoHash}:${stream.fileIdx}` : (stream.url || stream.ytId || '')) : '');

/** The sources a stream can use (pure; exported for tests). */
function availableSources(list, stream) {
    return (list || []).filter((s) => {
        try {
            return typeof s.available !== 'function' || !!s.available(stream);
        } catch (_) {
            return false;
        }
    }).map(({ id, label, description }) => ({ id, label: label || id, description: description || null }));
}

function usePluginSubtitleSources({ stream, subtitlesOn, onSubtitlesTrackSelected, onExtraSubtitlesTrackSelected }) {
    const sources = React.useMemo(() => availableSources(slot('subtitleSources'), stream), [stream]);
    const [selected, setSelected] = React.useState(null);

    // a new stream starts without one; a real subtitle track (chosen by the viewer or the player) replaces it
    const streamKey = streamKeyOf(stream);
    React.useEffect(() => { setSelected(null); }, [streamKey]);
    React.useEffect(() => { if (subtitlesOn) setSelected(null); }, [subtitlesOn]);

    const select = React.useCallback((id) => {
        if (id && sources.some((s) => s.id === id)) {
            if (typeof onSubtitlesTrackSelected === 'function') onSubtitlesTrackSelected(null);
            if (typeof onExtraSubtitlesTrackSelected === 'function') onExtraSubtitlesTrackSelected(null);
            setSelected(id);
        } else {
            setSelected(null);
        }
    }, [sources, onSubtitlesTrackSelected, onExtraSubtitlesTrackSelected]);

    return {
        sources,
        selected: sources.some((s) => s.id === selected) ? selected : null,
        select,
    };
}

module.exports = { usePluginSubtitleSources, availableSources };
