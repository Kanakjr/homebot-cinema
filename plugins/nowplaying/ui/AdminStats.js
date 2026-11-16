// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": Admin > Watch stats (slot adminTabs): the stats page with the profile picker, inside Admin.

const React = require('react');
const PropTypes = require('prop-types');
const StatsPage = require('./StatsPage');

const AdminStats = ({ onError }) => <StatsPage embedded={true} onError={onError} />;
AdminStats.propTypes = { onError: PropTypes.func };

module.exports = AdminStats;
