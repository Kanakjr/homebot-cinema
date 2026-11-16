// Copyright (C) 2017-2025 Smart code 203358507

import React from 'react';
import routes from 'stremio/routes';
import { PLAYER_PATH, META_DETAILS_PATH, LEGACY_META_DETAILS_PATH } from './getBackFallback';
import { onPluginsLoaded, slot, renderPlugin } from 'stremio/plugins';

const routerPaths = [
    {
        path: '/intro',
        view: 1,
        element: <routes.Intro />,
    },
    {
        path: '/discover/:transportUrl?/:type?/:catalogId?',
        view: 1,
        element: <routes.Discover />,
    },
    {
        path: '/library/:type?',
        view: 1,
        element: <routes.Library />,
    },
    {
        path: '/downloads',
        view: 1,
        element: <routes.Downloads />,
    },
    {
        path: '/admin',
        view: 1,
        element: <routes.Admin />,
    },
    {
        path: '/server/:id?',
        view: 1,
        element: <routes.ServerLibrary />,
    },
    {
        path: '/calendar/:year?/:month?',
        view: 1,
        element: <routes.Calendar />,
    },
    {
        path: '/continuewatching/:type?',
        view: 1,
        element: <routes.Library />,
    },
    {
        path: '/search',
        view: 1,
        element: <routes.Search />,
    },
    {
        path: META_DETAILS_PATH,
        view: 2,
        element: <routes.MetaDetails />,
    },
    {
        path: LEGACY_META_DETAILS_PATH,
        view: 2,
        element: <routes.MetaDetails />,
    },
    {
        path: '/addons/:type?/:transportUrl?/:catalogId?',
        view: 3,
        element: <routes.Addons />,
    },
    {
        path: '/settings',
        view: 3,
        element: <routes.Settings />,
    },
    {
        path: PLAYER_PATH,
        view: 4,
        element: <routes.Player />,
    },
    {
        path: '/',
        view: 0,
        element: <routes.Board />,
    },
    {
        path: '*',
        view: 1,
        element: <routes.NotFound />,
    },
];

// Plugin routes (slot "routes", e.g. /find) go in before the catch-all once the active plugin list is known (boot waits for it).
onPluginsLoaded(() => {
    const extra = slot('routes').map((r: any) => ({
        path: r.path,
        view: Math.min(3, Math.max(1, Number(r.view) || 1)),
        element: renderPlugin(r, 'routes', {}),
    }));
    routerPaths.splice(routerPaths.length - 1, 0, ...extra);
});

export default routerPaths;
