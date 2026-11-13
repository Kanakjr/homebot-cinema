// Copyright (C) 2017-2026 HomeBot Cinema
// Calendar markers from the HomeServer: episodes already on the server, and shows Sentinel auto-downloads.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const { api } = require('stremio/common/serverApi');
const useServerEvents = require('stremio/common/useServerEvents');

type Markers = { onServer: Set<string>, monitored: Set<string> };
type Marker = 'server' | 'auto' | null;

const EMPTY: Markers = { onServer: new Set(), monitored: new Set() };
const ServerMarkersContext = createContext<Markers>(EMPTY);

const useServerMarkersData = (): Markers => {
    const [markers, setMarkers] = useState<Markers>(EMPTY);
    const load = useCallback(() => {
        Promise.all([
            api('GET', '/api/library/episodes').catch(() => null),
            api('GET', '/api/sentinel/monitored').catch(() => null),
        ]).then(([lib, mon]) => {
            const list: any[] = Array.isArray(mon) ? mon : Object.values(mon || {});
            setMarkers({
                onServer: new Set(lib && Array.isArray(lib.episodes) ? lib.episodes : []),
                monitored: new Set(list.filter((m) => m && m.monitored).map((m) => m.imdbId)),
            });
        });
    }, []);
    useEffect(() => { load(); }, [load]);
    useServerEvents(['library', 'sentinel'], load);
    return markers;
};

// "#/detail/series/<metaId>/<videoId>" -> ids
const idsFromLink = (href?: string) => {
    const parts = String(href || '').replace(/^#?\/?/, '').split('/');
    const decode = (s?: string) => {
        try { return decodeURIComponent(s || ''); } catch (_) { return s || ''; }
    };
    return { showId: decode(parts[2]), videoId: decode(parts[3]) };
};

const useEpisodeMarker = (href?: string): Marker => {
    const { onServer, monitored } = useContext(ServerMarkersContext);
    const { showId, videoId } = idsFromLink(href);
    if (videoId && onServer.has(videoId)) return 'server';
    if (showId && monitored.has(showId)) return 'auto';
    return null;
};

const ServerMarkersProvider = ({ children }: { children: React.ReactNode }) => (
    <ServerMarkersContext.Provider value={useServerMarkersData()}>{children}</ServerMarkersContext.Provider>
);

export { ServerMarkersProvider, useEpisodeMarker, idsFromLink };
