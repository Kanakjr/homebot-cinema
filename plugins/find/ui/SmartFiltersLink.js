// Copyright (C) 2017-2026 HomeBot Cinema
// "Smart filters" link in the Discover header (slot "discoverActions"). Discover passes its own pill style as className.

const React = require('react');
const PropTypes = require('prop-types');

const SmartFiltersLink = ({ className }) => (
    <a className={className} href="#/find" title="Filter by rating, genre, streaming service and more">✨ Smart filters</a>
);
SmartFiltersLink.propTypes = { className: PropTypes.string };

module.exports = SmartFiltersLink;
