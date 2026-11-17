// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": Player overlay showing the Apple MetalFX 4K AI Upscaler status and toggle pill.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useMetalFx } = require('./useMetalFx');
const styles = require('./MetalFxOverlay.less');

const stop = (event) => {
    if (event) {
        event.stopPropagation();
    }
};

const MetalFxOverlay = ({ stream, controlsHidden, menusOpen }) => {
    const { isNativeMac, active, toggle, streamAnalysis } = useMetalFx(stream);

    // Only display when running on native macOS desktop app
    if (!isNativeMac) return null;

    // Hide when modal menus or settings are open
    if (menusOpen) return null;

    const onToggleClick = (event) => {
        stop(event);
        toggle();
    };

    return (
        <div
            className={classnames(styles['metalfx-container'], {
                [styles['hidden']]: controlsHidden,
            })}
            onMouseDown={stop}
            onClick={stop}
            onDoubleClick={stop}
            onTouchEnd={stop}
        >
            {streamAnalysis.isNative4K ? (
                <div
                    className={classnames(styles['metalfx-pill'], styles['native-4k'])}
                    title="Stream is native 4K UHD. MetalFX upscaling is automatically bypassed."
                >
                    <span className={styles['badge']}>4K</span>
                    <span className={styles['indicator']}>NATIVE</span>
                </div>
            ) : streamAnalysis.canUpscale ? (
                <button
                    type="button"
                    className={classnames(styles['metalfx-pill'], {
                        [styles['active']]: active,
                    })}
                    onClick={onToggleClick}
                    title={`Apple MetalFX 4K AI Upscaling: ${
                        active
                            ? 'ON (1080p -> 4K UHD Neural Upscale). Click to disable.'
                            : 'OFF. Click to enable 4K AI Upscaling.'
                    }`}
                >
                    <span className={styles['badge']}>4K AI</span>
                    <span className={styles['indicator']}>{active ? 'ON' : 'OFF'}</span>
                </button>
            ) : null}
        </div>
    );
};

MetalFxOverlay.propTypes = {
    stream: PropTypes.object,
    controlsHidden: PropTypes.bool,
    menusOpen: PropTypes.bool,
};

module.exports = MetalFxOverlay;
