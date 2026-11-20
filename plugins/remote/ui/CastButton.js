// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Cast button in the top navigation bar (slot navButtons).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button } = require('stremio/components');
const { useRemoteState } = require('./remoteState');

const CastButton = ({ className, iconClassName }) => {
    const {
        selectedTargetId,
        targets,
        connectedControllers,
        toggleSheet,
        isSheetOpen,
    } = useRemoteState();

    const selectedTarget = selectedTargetId ? targets.find((t) => t.id === selectedTargetId) : null;
    const isCastingToOther = !!(selectedTarget && selectedTarget.online);
    const hasIncomingRemotes = connectedControllers && connectedControllers.length > 0;
    const isConnected = isCastingToOther || hasIncomingRemotes;

    let title = 'Cast & Remote Control';
    if (isCastingToOther) {
        title = `Cast: Connected to ${selectedTarget.name}`;
    } else if (hasIncomingRemotes) {
        title = `Remote: ${connectedControllers.length} connected (${connectedControllers[0].name})`;
    }

    return (
        <Button
            className={classnames(className, { active: isSheetOpen || isConnected })}
            title={title}
            aria-label={title}
            aria-pressed={isSheetOpen}
            tabIndex={-1}
            onClick={toggleSheet}
        >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg className={iconClassName} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    {/* Google Cast / Screen Cast Icon */}
                    <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.92-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
                {isConnected ? (
                    <span
                        style={{
                            position: 'absolute',
                            top: -2,
                            right: -2,
                            width: hasIncomingRemotes ? 12 : 7,
                            height: hasIncomingRemotes ? 12 : 7,
                            borderRadius: '50%',
                            backgroundColor: 'var(--primary-accent-color, #23b247)',
                            boxShadow: '0 0 4px var(--primary-accent-color, #23b247)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.6rem',
                            fontWeight: 800,
                            color: '#000',
                        }}
                    >
                        {hasIncomingRemotes ? connectedControllers.length : null}
                    </span>
                ) : null}
            </div>
        </Button>
    );
};

CastButton.propTypes = {
    className: PropTypes.string,
    iconClassName: PropTypes.string,
};

module.exports = CastButton;
