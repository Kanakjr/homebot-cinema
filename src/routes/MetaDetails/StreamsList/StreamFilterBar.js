// Copyright (C) 2017-2026 HomeBot Cinema
// Stream filter bar: search, quality filters with counts, and a "hide CAM" switch.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const styles = require('./StreamFilterBar.less');

const FILTER_PILLS = [
    { id: 'ALL', label: 'All', count: 'all' },
    { id: 'PROFILE', label: 'Fits profile', count: 'profile' },
    { id: 'BEST', label: 'Best' },
    { id: '4K', label: '4K', count: '4k' },
    { id: '1080P', label: '1080p', count: '1080p' },
    { id: '720P', label: '720p', count: '720p' },
    { id: 'HDR', label: 'HDR', count: 'hdr' },
    { id: 'COMPACT', label: 'Under 3 GB', count: 'compact' },
    { id: 'SEEDS', label: 'Well seeded', count: 'seeds' },
];

const SearchIcon = () => (
    <svg className={styles['search-icon']} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="5.5" />
        <path d="M13.2 13.2L17 17" />
    </svg>
);

const StreamFilterBar = ({ activePill, onSelectPill, searchQuery, onSearchChange, hideCam, onToggleHideCam, totalCount, filteredCount, counts, profileName }) => (
    <div className={styles['filter-bar-container']}>
        <div className={styles['top-row']}>
            <label className={styles['search-wrapper']}>
                <SearchIcon />
                <input
                    type="text"
                    className={styles['search-input']}
                    placeholder="Search streams, e.g. Atmos, x265, Hindi"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
                {searchQuery ?
                    <button type="button" className={styles['search-clear']} onClick={() => onSearchChange('')} title="Clear" aria-label="Clear search">×</button>
                    : null}
            </label>
            <button
                type="button"
                role="switch"
                aria-checked={hideCam}
                className={classnames(styles['switch'], { [styles['on']]: hideCam })}
                onClick={onToggleHideCam}
                title="Hide cam and telesync rips"
            >
                <span className={styles['switch-track']}><span className={styles['switch-thumb']} /></span>
                <span>Hide CAM</span>
            </button>
        </div>
        <div className={styles['pills-row']}>
            {FILTER_PILLS.map((pill) => {
                const n = pill.count && counts ? counts[pill.count] : null;
                if (n === 0 && pill.id !== 'ALL') return null;
                if (pill.id === 'PROFILE' && typeof n !== 'number') return null;
                return (
                    <button
                        key={pill.id}
                        type="button"
                        className={classnames(styles['pill'], { [styles['active']]: activePill === pill.id })}
                        onClick={() => onSelectPill(pill.id)}
                    >
                        {pill.id === 'PROFILE' && profileName ? `Fits ${profileName}` : pill.label}
                        {typeof n === 'number' ? <span className={styles['pill-count']}>{n}</span> : null}
                    </button>
                );
            })}
            <span className={styles['showing']}>
                {filteredCount === totalCount ? `${totalCount} streams` : `${filteredCount} of ${totalCount}`}
            </span>
        </div>
    </div>
);

StreamFilterBar.propTypes = {
    activePill: PropTypes.string.isRequired,
    onSelectPill: PropTypes.func.isRequired,
    searchQuery: PropTypes.string.isRequired,
    onSearchChange: PropTypes.func.isRequired,
    hideCam: PropTypes.bool.isRequired,
    onToggleHideCam: PropTypes.func.isRequired,
    totalCount: PropTypes.number.isRequired,
    filteredCount: PropTypes.number.isRequired,
    counts: PropTypes.object,
    profileName: PropTypes.string,
};

module.exports = StreamFilterBar;
