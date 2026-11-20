// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": UI slot contributions. See src/plugins/host.js.

const React = require('react');

module.exports = {
    // 1. Dedicated TV Remote route (#/remote)
    routes: [
        {
            path: '/remote',
            view: 2,
            Component: React.lazy(() => import('./RemoteRoute')),
        },
    ],

    // 2. Cast & Remote button in the top navigation bar
    navButtons: [
        {
            id: 'remote-cast-button',
            order: 15,
            Component: React.lazy(() => import('./CastButton')),
        },
    ],

    // 3. Global app overlays: SSE Receiver, Slide-Over Remote Sheet, and Bottom Mini-Player Bar
    appOverlays: [
        {
            id: 'remote-receiver-bridge',
            Component: React.lazy(() => import('./ReceiverBridge')),
        },
        {
            id: 'remote-sheet',
            Component: React.lazy(() => import('./RemoteSheet')),
        },
        {
            id: 'remote-minibar',
            Component: React.lazy(() => import('./CastMiniBar')),
        },
    ],

    // 4. Video player bridge: reports playback progress and provides instant transport controls
    playerOverlays: [
        {
            id: 'remote-player-bridge',
            Component: React.lazy(() => import('./PlayerReceiverBridge')),
        },
    ],

    // 5. Settings > Remote & Cast
    settingsSections: [
        {
            id: 'remote',
            label: 'Remote & Cast',
            Component: React.lazy(() => import('./Settings')),
        },
    ],

    // 6. Title details page: Cast to TV banner and action
    metaDetailsSections: [
        {
            id: 'remote-cast-meta',
            Component: React.lazy(() => import('./MetaDetailsCast')),
        },
    ],
};
