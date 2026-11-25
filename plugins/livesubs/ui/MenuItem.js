// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "livesubs": the player "More" menu entry, On / Off. ("Translate to English" waits for a model that can:
// large-v3-turbo ignores Whisper's translate task.)

const React = require('react');
const PropTypes = require('prop-types');
const L = require('./logic');
const store = require('./store');

const LABELS = { off: 'Off', on: 'On' };
const NEXT = { off: 'on', on: 'off' };

const LiveSubsMenuItem = ({ stream, Option, closeMenu }) => {
    const mode = store.useMode();
    if (!Option || !L.sourceOf(stream, null)) return null;
    const onClick = () => {
        store.setMode(NEXT[mode]);
        if (typeof closeMenu === 'function') closeMenu();
    };
    return <Option icon={'subtitles'} label={`AI subtitles · ${LABELS[mode]}`} onClick={onClick} />;
};

LiveSubsMenuItem.propTypes = {
    stream: PropTypes.object,
    Option: PropTypes.elementType,
    closeMenu: PropTypes.func,
};

module.exports = LiveSubsMenuItem;
