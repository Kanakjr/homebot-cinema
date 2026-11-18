// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": entry in the player's More menu (slot playerMenuItems). Opens the upscaler panel (settings + stats).

const React = require('react');
const PropTypes = require('prop-types');
const { useMetalFx } = require('./useMetalFx');

const MetalFxMenuItem = ({ stream, Option, closeMenu }) => {
    const { isNativeMac, active, toggleMenu, streamAnalysis } = useMetalFx(stream);

    const onClick = React.useCallback(() => {
        // The panel stays hidden while another player menu is open, so close the More menu first
        if (typeof closeMenu === 'function') closeMenu();
        toggleMenu();
    }, [closeMenu, toggleMenu]);

    if (!isNativeMac || !Option) return null;

    const state = streamAnalysis.isNative4K ? 'Native 4K' : active ? 'On' : 'Off';
    return <Option icon={'maximize'} label={`4K AI upscaler · ${state}`} onClick={onClick} />;
};

MetalFxMenuItem.propTypes = {
    stream: PropTypes.object,
    Option: PropTypes.elementType,
    closeMenu: PropTypes.func,
};

module.exports = MetalFxMenuItem;
