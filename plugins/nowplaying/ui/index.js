// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying" (UI): the heartbeat in the player (slot playerOverlays), Admin > Now playing and Admin > Watch stats
// (slot adminTabs), and the Watch stats page (#/stats) with its button in the top bar.

const React = require('react');

module.exports = {
    playerOverlays: [{ id: 'nowplaying', Component: React.lazy(() => import('./Reporter')) }],
    adminTabs: [
        { id: 'nowplaying', label: 'Now playing', order: 10, Component: React.lazy(() => import('./NowPlaying')) },
        { id: 'stats', label: 'Watch stats', order: 11, Component: React.lazy(() => import('./AdminStats')) },
    ],
    routes: [{ path: '/stats', view: 1, Component: React.lazy(() => import('./StatsRoute')) }],
    navButtons: [{ id: 'stats', order: 20, Component: React.lazy(() => import('./StatsButton')) }],
};
