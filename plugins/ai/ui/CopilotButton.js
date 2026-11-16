// Copyright (C) 2017-2026 HomeBot Cinema
// The sparkle button in the top bar (slot "navButtons"). Hidden until the copilot is set up, except for admins (who can set it up).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button } = require('stremio/components');
const { useCopilot } = require('./copilotState');

const CopilotButton = ({ className, iconClassName }) => {
    const copilot = useCopilot();
    if (!copilot.available) return null;
    return (
        <Button className={classnames(className, { active: copilot.open })} title={'Copilot'} aria-label={'Copilot'} aria-pressed={copilot.open} tabIndex={-1} onClick={copilot.toggle}>
            <svg className={iconClassName} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 1.8L7.5 17.5l-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z" />
            </svg>
        </Button>
    );
};
CopilotButton.propTypes = { className: PropTypes.string, iconClassName: PropTypes.string };

module.exports = CopilotButton;
