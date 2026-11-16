// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "find" (UI): the #/find page and its link in the Discover header. Server side: plugins/find/server.

const React = require('react');

module.exports = {
    routes: [{ path: '/find', view: 1, Component: React.lazy(() => import('./FindRoute')) }],
    discoverActions: [{ id: 'smart-filters', Component: React.lazy(() => import('./SmartFiltersLink')) }],
};
