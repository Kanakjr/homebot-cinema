// Copyright (C) 2017-2026 HomeBot Cinema
// The HomeBot Cinema mark (a house with a play button cut out of it) and the name next to it.
// Source of truth for the design: assets/brand/glyph.svg (built by scripts/brand/build.js).

const React = require('react');
const PropTypes = require('prop-types');
const styles = require('./styles');

const BrandMark = ({ size = 32, className, glow = false }) => {
    // a unique id per instance, so several marks on one page never share (or lose) each other's gradient and mask
    const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 512 512"
            fill="none"
            role="img"
            aria-label="HomeBot Cinema"
            style={glow ? { filter: 'drop-shadow(0 4px 14px rgba(242, 122, 36, 0.35))' } : undefined}
        >
            <defs>
                <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#FFD25A" />
                    <stop offset="1" stopColor="#F27A24" />
                </linearGradient>
                <mask id={`m${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
                    <rect width="512" height="512" fill="#fff" />
                    <path d="M232 268 L232 360 L318 314 Z" fill="#000" stroke="#000" strokeWidth="22" strokeLinejoin="round" />
                </mask>
            </defs>
            <path d="M256 86 L420 230 V414 H92 V230 Z" fill={`url(#g${uid})`} stroke={`url(#g${uid})`} strokeWidth="30" strokeLinejoin="round" mask={`url(#m${uid})`} />
        </svg>
    );
};
BrandMark.propTypes = { size: PropTypes.number, className: PropTypes.string, glow: PropTypes.bool };

// mark + "HomeBot Cinema"
const BrandLockup = ({ size = 40, className }) => (
    <div className={`${styles['lockup']} ${className || ''}`}>
        <BrandMark size={size} />
        <span className={styles['name']} style={{ fontSize: `${Math.round(size * 0.5)}px` }}>HomeBot <span className={styles['name-light']}>Cinema</span></span>
    </div>
);
BrandLockup.propTypes = { size: PropTypes.number, className: PropTypes.string };

module.exports = BrandMark;
module.exports.BrandMark = BrandMark;
module.exports.BrandLockup = BrandLockup;
