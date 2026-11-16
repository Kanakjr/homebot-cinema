// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "skip" (UI): the skip button in the player (slot playerOverlays) and Settings > Skip intro (per profile).

const React = require('react');

module.exports = {
    playerOverlays: [{ id: 'skip', Component: React.lazy(() => import('./SkipOverlay')) }],
    settingsSections: [{ id: 'skip', label: 'Skip intro', Component: React.lazy(() => import('./Settings')) }],
};
