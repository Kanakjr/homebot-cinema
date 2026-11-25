// Copyright (C) 2017-2026 HomeBot Cinema
// Boot gate: resolves the active household profile before stremio-core starts.
// Shows the "Who's watching?" screen when there is no valid remembered profile.

const React = require('react');
const ReactDOM = require('react-dom/client');
const pm = require('./profileManager');

// Returns { me, profile } once a profile is active. Rejects only if the server is unreachable.
// /api/me is fetched again once the profile is known: admin depends on the active profile (see profileManager cookies).
async function ensureProfile() {
    pm.syncProfileCookie();
    const [me, profiles] = await Promise.all([pm.fetchMe(), pm.fetchProfiles()]);

    const resumed = await pm.resolveStoredProfile(profiles);
    if (resumed) return { me: await pm.fetchMe().catch(() => me), profile: resumed };
    pm.clearActive();

    const ProfilePicker = require('stremio/components/ProfilePicker');
    const host = document.getElementById('app');
    const root = ReactDOM.createRoot(host);
    return new Promise((resolve) => {
        root.render(React.createElement(ProfilePicker, {
            isAdmin: me.isAdmin,
            onDone: ({ profile, token, remember }) => {
                pm.storeActive({ id: profile.id, token }, remember);
                root.unmount();
                pm.fetchMe().catch(() => ({ ...me, isAdmin: false })).then((fresh) => resolve({ me: fresh, profile }));
            }
        }));
    });
}

module.exports = { ensureProfile };
