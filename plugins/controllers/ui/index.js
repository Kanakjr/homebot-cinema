// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "controllers" (UI): Game controllers Settings section and connect/battery toasts.

const React = require('react');

module.exports = {
    settingsSections: [{ id: 'controllers', label: 'Controllers', Component: React.lazy(() => import('./Settings')) }],
    appOverlays: [{ id: 'controllers-toasts', Component: React.lazy(() => import('./Toasts')) }],
};
