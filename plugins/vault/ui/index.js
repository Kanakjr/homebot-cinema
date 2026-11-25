// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault" (UI): the Locked folder. Its tile at the end of Server library (slot serverLibraryTiles), the #/vault page
// (passcode, then folders and videos), and the private resume point in the player (slot playerOverlays).

const React = require('react');

module.exports = {
    routes: [{ path: '/vault', view: 1, Component: React.lazy(() => import('./VaultRoute')) }],
    serverLibraryTiles: [{ id: 'vault', Component: React.lazy(() => import('./VaultTile')) }],
    playerOverlays: [{ id: 'vault-resume', Component: React.lazy(() => import('./ResumeOverlay')) }],
};
