// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying" (UI): the heartbeat in the player (slot playerOverlays) and Admin > Now playing (slot adminTabs).

const React = require('react');

module.exports = {
    playerOverlays: [{ id: 'nowplaying', Component: React.lazy(() => import('./Reporter')) }],
    adminTabs: [{ id: 'nowplaying', label: 'Now playing', order: 10, Component: React.lazy(() => import('./NowPlaying')) }],
};
