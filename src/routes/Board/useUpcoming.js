// Copyright (C) 2017-2026 HomeBot Cinema
// The Upcoming row: episodes of this profile's shows airing in the next two weeks (server/upnext.js).

const React = require('react');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');

const useUpcoming = (refreshKey) => {
    const [items, setItems] = React.useState([]);
    React.useEffect(() => {
        let alive = true;
        api('GET', '/api/upnext/upcoming', undefined, pm.profileHeaders())
            .then((r) => { if (alive) setItems(((r && r.items) || []).map((i) => ({ ...i, posterShape: 'landscape' }))); })
            .catch(() => null);
        return () => { alive = false; };
    }, [refreshKey]);
    return items;
};

module.exports = useUpcoming;
