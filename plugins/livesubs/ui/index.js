// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "livesubs" (UI): AI subtitles drawn over the player (slot playerOverlays), switched from the "More" menu.

const React = require('react');

module.exports = {
    playerOverlays: [{ id: 'livesubs', Component: React.lazy(() => import('./LiveSubsOverlay')) }],
    playerMenuItems: [{ id: 'livesubs', Component: React.lazy(() => import('./MenuItem')) }],
};
