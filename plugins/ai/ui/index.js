// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "ai" (UI): the sparkle button in the top bar and the chat drawer. Server side: plugins/ai/server.

const React = require('react');

module.exports = {
    navButtons: [{ id: 'copilot', order: 10, Component: React.lazy(() => import('./CopilotButton')) }],
    appOverlays: [{ id: 'copilot', Component: React.lazy(() => import('./Copilot')) }],
};
