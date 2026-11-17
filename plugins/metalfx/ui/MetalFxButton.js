// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": Player control button (rendered in playerControls slot, bottom right).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button } = require('stremio/components');
const { useMetalFx } = require('./useMetalFx');
const styles = require('./MetalFxButton.less');

const MetalFxButton = ({ stream }) => {
    const { isNativeMac, active, menuOpen, toggleMenu, streamAnalysis } = useMetalFx(stream);

    if (!isNativeMac) return null;

    const onClick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        toggleMenu();
    };

    const onMouseDown = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
    };

    return (
        <Button
            data-metalfx-btn="1"
            className={classnames(styles['metalfx-control-btn'], {
                [styles['active']]: active,
                [styles['menu-open']]: menuOpen,
                [styles['native-4k']]: streamAnalysis.isNative4K,
            })}
            title={
                streamAnalysis.isNative4K
                    ? 'Stream is native 4K UHD. Click to view diagnostics.'
                    : `Apple MetalFX 4K AI Upscaler: ${active ? 'ON' : 'OFF'} (Click to configure & view stats)`
            }
            tabIndex={-1}
            onMouseDown={onMouseDown}
            onClick={onClick}
        >
            <div className={styles['badge-container']}>
                <span className={styles['label-4k']}>4K</span>
                <span className={classnames(styles['label-ai'], { [styles['active']]: active })}>AI</span>
            </div>
            {active ? <span className={styles['active-dot']} /> : null}
        </Button>
    );
};

MetalFxButton.propTypes = {
    stream: PropTypes.object,
};

module.exports = MetalFxButton;
