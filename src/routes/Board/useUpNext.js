// Copyright (C) 2017-2026 HomeBot Cinema
// Continue watching: per title, resume (with time left) or "next up" after the furthest episode watched (server/upnext.js).

const React = require('react');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');

const useUpNext = (items) => {
    const [state, setState] = React.useState({ key: null, byId: new Map() });
    const itemsRef = React.useRef(items);
    itemsRef.current = items;
    // refetch when the row changes: other titles, other episodes or more progress
    const key = (items || []).map((i) => `${i._id}@${(i.state && i.state.videoId) || ''}@${Math.round(i.progress || 0)}`).join(',');
    React.useEffect(() => {
        const ids = (itemsRef.current || []).map((i) => i._id).filter((id) => /^tt\d+$/.test(id || ''));
        if (!ids.length) return undefined;
        let alive = true;
        api('GET', `/api/upnext/continue?ids=${encodeURIComponent(ids.join(','))}`, undefined, pm.profileHeaders())
            .then((r) => { if (alive) setState({ key, byId: new Map(((r && r.items) || []).map((s) => [s.id, s])) }); })
            .catch(() => null);
        return () => { alive = false; };
    }, [key]);
    return state.byId;
};

module.exports = useUpNext;
