// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Cast section mounted in metaDetailsSections.
// Shows casting status and quick-cast action right on the title page.

const React = require('react');
const PropTypes = require('prop-types');
const { useRemoteState } = require('./remoteState');
const styles = require('./styles.less');

const MetaDetailsCast = () => {
    const {
        selectedTargetId,
        selectTarget,
        targets,
        openSheet,
    } = useRemoteState();

    const selectedTarget = selectedTargetId ? targets.find((t) => t.id === selectedTargetId) : null;
    const desktopTarget = targets.find((t) => t.isDesktop && t.online);

    if (selectedTarget) {
        return (
            <div className={styles['meta-cast-box']}>
                <div className={styles['meta-cast-info']}>
                    <svg className={styles['meta-cast-icon']} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                    </svg>
                    <div>
                        <div className={styles['meta-cast-title']}>
                            Ready to Cast to <strong>{selectedTarget.name}</strong>
                        </div>
                        <div className={styles['meta-cast-sub']}>
                            Tap any stream below to start playback on your TV screen.
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className={styles['meta-cast-btn']}
                    onClick={openSheet}
                >
                    Change Screen
                </button>
            </div>
        );
    }

    if (desktopTarget) {
        return (
            <div className={styles['meta-cast-box']}>
                <div className={styles['meta-cast-info']}>
                    <svg className={styles['meta-cast-icon']} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                    </svg>
                    <div>
                        <div className={styles['meta-cast-title']}>
                            {desktopTarget.name} is available
                        </div>
                        <div className={styles['meta-cast-sub']}>
                            Push playback to your Mac Mini with one click.
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    className={styles['meta-cast-btn']}
                    onClick={() => selectTarget(desktopTarget.id)}
                >
                    Cast to {desktopTarget.name}
                </button>
            </div>
        );
    }

    return null;
};

MetaDetailsCast.propTypes = {
    type: PropTypes.string,
    id: PropTypes.string,
    videoId: PropTypes.string,
    meta: PropTypes.object,
};

module.exports = MetaDetailsCast;
