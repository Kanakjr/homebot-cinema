// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": the Watch stats button in the top bar (slot navButtons).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button } = require('stremio/components');

const StatsButton = ({ className, iconClassName }) => {
    const active = typeof window !== 'undefined' && /^#\/stats/.test(window.location.hash);
    return (
        <Button className={classnames(className, { active })} title={'Watch stats'} aria-label={'Watch stats'} tabIndex={-1} href={'#/stats'}>
            <svg className={iconClassName} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4 20V10h3v10H4zm6.5 0V4h3v16h-3zM17 20v-7h3v7h-3z" />
            </svg>
        </Button>
    );
};
StatsButton.propTypes = { className: PropTypes.string, iconClassName: PropTypes.string };

module.exports = StatsButton;
