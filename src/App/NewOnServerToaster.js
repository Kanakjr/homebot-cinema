// Copyright (C) 2017-2026 HomeBot Cinema
// Once per visit: "New on your server: …" when titles arrived since this profile last opened the server library.

const React = require('react');
const { useToast } = require('stremio/common');
const { useNewOnServer } = require('stremio/common/newOnServer');

const NewOnServerToaster = () => {
    const toast = useToast();
    const fresh = useNewOnServer();
    const shown = React.useRef(false);
    React.useEffect(() => {
        if (shown.current || fresh.length === 0) return;
        shown.current = true;
        const names = fresh.slice(0, 3).map((i) => i.title).join(', ');
        toast.show({
            type: 'info',
            title: `New on your server: ${names}${fresh.length > 3 ? ` +${fresh.length - 3} more` : ''}`,
            timeout: 7000
        });
    }, [fresh]);
    return null;
};

module.exports = NewOnServerToaster;
