// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "metalfx" (UI): Apple MetalFX 4K AI Upscaler entry in the player's More menu, stats overlay, and Settings.

const React = require('react');

module.exports = {
    playerMenuItems: [{ id: 'metalfx-item', Component: React.lazy(() => import('./MetalFxMenuItem')) }],
    playerOverlays: [{ id: 'metalfx-stats', Component: React.lazy(() => import('./MetalFxStatsOverlay')) }],
    settingsSections: [{ id: 'metalfx', label: 'MetalFX 4K Upscaler', Component: React.lazy(() => import('./Settings')) }],
};
