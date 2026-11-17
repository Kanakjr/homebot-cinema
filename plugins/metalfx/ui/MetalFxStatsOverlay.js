// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx": Interactive settings & live telemetry overlay panel.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useMetalFx } = require('./useMetalFx');
const styles = require('./MetalFxStatsOverlay.less');

const stop = (e) => {
    if (e && e.stopPropagation) {
        e.stopPropagation();
    }
};

const getFormatTier = (width, height) => {
    if (width >= 3800 || height >= 2000) return '4K UHD';
    if (width >= 2500 || height >= 1400) return '1440p QHD';
    if (width >= 1900 || height >= 780) return '1080p FHD';
    if (width >= 1200 || height >= 700) return '720p HD';
    return height ? `${height}p` : 'Native';
};

const MetalFxStatsOverlay = ({ stream, controlsHidden, menusOpen }) => {
    const {
        isNativeMac,
        active,
        toggle,
        menuOpen,
        closeMenu,
        telemetry,
    } = useMetalFx(stream);

    const cardRef = React.useRef(null);

    // Close menu when clicking outside or pressing Escape
    React.useEffect(() => {
        if (!menuOpen) return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeMenu();
            }
        };
        const onPointerDown = (e) => {
            if (cardRef.current && !cardRef.current.contains(e.target)) {
                if (e.target && e.target.closest && e.target.closest('[data-metalfx-btn]')) {
                    return;
                }
                closeMenu();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [menuOpen, closeMenu]);

    if (!isNativeMac || !menuOpen || menusOpen) {
        return null;
    }

    const onSwitchClick = (e) => {
        stop(e);
        toggle();
    };

    const onCloseClick = (e) => {
        stop(e);
        closeMenu();
    };

    return (
        <div
            ref={cardRef}
            className={classnames(styles['metalfx-overlay-layer'], {
                [styles['hidden']]: controlsHidden,
            })}
            onMouseDown={stop}
            onClick={stop}
            onDoubleClick={stop}
            onTouchEnd={stop}
        >
            <div className={styles['overlay-card']}>
                {/* Header */}
                <div className={styles['card-header']}>
                    <div className={styles['header-title-group']}>
                        <div className={styles['chip-4k']}>4K AI</div>
                        <span className={styles['title-text']}>Apple MetalFX Upscaler</span>
                        <span className={styles['chip-native']}>macOS Native</span>
                    </div>
                    <button
                        type="button"
                        className={styles['close-btn']}
                        onClick={onCloseClick}
                        title="Close panel (Esc)"
                    >
                        ✕
                    </button>
                </div>

                {/* Primary Toggle Switch */}
                <div className={styles['toggle-card']} onClick={onSwitchClick}>
                    <div className={styles['toggle-text-area']}>
                        <div className={styles['toggle-main-label']}>4K AI Super-Resolution</div>
                        <div className={styles['toggle-sub-label']}>
                            {active
                                ? 'Apple Silicon GPU neural edge-preserving upscaling is active.'
                                : 'Standard native playback. Original video plays directly without extra scaling.'}
                        </div>
                    </div>
                    <div
                        className={classnames(styles['ios-switch'], {
                            [styles['switch-active']]: active,
                        })}
                        role="switch"
                        aria-checked={active}
                    >
                        <span className={styles['switch-handle']} />
                    </div>
                </div>

                {/* Live Diagnostics & Telemetry */}
                <div className={styles['diagnostics-container']}>
                    <div className={styles['diagnostics-heading']}>
                        <span>Live GPU Telemetry & Verification</span>
                        <span className={styles['heading-tag']}>Real-Time</span>
                    </div>

                    <div className={styles['stats-grid']}>
                        <div className={styles['stat-cell']}>
                            <div className={styles['stat-label']}>Input Stream</div>
                            <div className={styles['stat-value']}>
                                {telemetry.inWidth} × {telemetry.inHeight}
                            </div>
                            <div className={styles['stat-footnote']}>
                                {getFormatTier(telemetry.inWidth, telemetry.inHeight)} Native File
                            </div>
                        </div>

                        <div className={styles['stat-cell']}>
                            <div className={styles['stat-label']}>Render Target</div>
                            <div className={styles['stat-value']}>
                                {telemetry.outWidth} × {telemetry.outHeight}
                            </div>
                            <div className={styles['stat-footnote']}>
                                {active
                                    ? `${getFormatTier(telemetry.outWidth, telemetry.outHeight)} (MetalFX AI Upscaled)`
                                    : 'Native Display Direct'}
                            </div>
                        </div>

                        <div className={styles['stat-cell']}>
                            <div className={styles['stat-label']}>Upscaler Engine</div>
                            <div className={classnames(styles['stat-value'], styles['engine-accent'])}>
                                {active ? 'MTLFXSpatialScaler' : 'libmpv Native Direct'}
                            </div>
                            <div className={styles['stat-footnote']}>
                                {active ? 'Apple Silicon Neural' : 'Untouched Pipeline'}
                            </div>
                        </div>

                        <div className={styles['stat-cell']}>
                            <div className={styles['stat-label']}>GPU Frame Time</div>
                            <div className={styles['stat-value']}>
                                {active && telemetry.lastGpuTimeMs > 0
                                    ? `${telemetry.lastGpuTimeMs.toFixed(2)} ms`
                                    : '0.00 ms (Direct)'}
                            </div>
                            <div className={styles['stat-footnote']}>
                                {active ? 'Zero CPU Overhead' : 'Direct Play'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer status bar */}
                <div className={styles['card-footer']}>
                    <span
                        className={classnames(styles['status-indicator-dot'], {
                            [styles['active']]: active,
                        })}
                    />
                    <span className={styles['status-caption']}>
                        {active
                            ? `Status: Apple MetalFX AI Active (${getFormatTier(telemetry.inWidth, telemetry.inHeight)} → ${getFormatTier(telemetry.outWidth, telemetry.outHeight)} Neural Upscale)`
                            : 'Status: Native Playback (MetalFX Bypassed, 100% Original File)'}
                    </span>
                </div>
            </div>
        </div>
    );
};

MetalFxStatsOverlay.propTypes = {
    stream: PropTypes.object,
    controlsHidden: PropTypes.bool,
    menusOpen: PropTypes.bool,
};

module.exports = MetalFxStatsOverlay;
