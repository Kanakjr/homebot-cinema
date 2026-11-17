// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx" (UI): Apple MetalFX 4K AI Upscaler button in player controls, stats overlay, and Settings.

const React = require('react');

module.exports = {
    playerControls: [{ id: 'metalfx-btn', Component: React.lazy(() => import('./MetalFxButton')) }],
    playerOverlays: [{ id: 'metalfx-stats', Component: React.lazy(() => import('./MetalFxStatsOverlay')) }],
    settingsSections: [{ id: 'metalfx', label: 'MetalFX 4K Upscaler', Component: React.lazy(() => import('./Settings')) }],
};
