// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "themes" (UI only): Settings > Appearance (accent, AMOLED black, corner radius) and ten extra accent colours.

const React = require('react');
const accents = require('./accents');

module.exports = {
    settingsSections: [{ id: 'appearance', label: 'Appearance', Component: React.lazy(() => import('./Appearance')) }],
    accents,
};
