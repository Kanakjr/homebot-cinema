// Copyright (C) 2017-2026 HomeBot Cinema
// Boot gate: resolves the active household profile before stremio-core starts.
// Shows the "Who's watching?" screen when there is no valid remembered profile.

const React = require('react');
const ReactDOM = require('react-dom/client');
const pm = require('./profileManager');

// Returns { me, profile } once a profile is active. Rejects only if the server is unreachable.
async function ensureProfile() {
    const [me, profiles] = await Promise.all([pm.fetchMe(), pm.fetchProfiles()]);

    const resumed = await pm.resolveStoredProfile(profiles);
    if (resumed) return { me, profile: resumed };

    const ProfilePicker = require('stremio/components/ProfilePicker');
    const host = document.getElementById('app');
    const root = ReactDOM.createRoot(host);
    return new Promise((resolve) => {
        root.render(React.createElement(ProfilePicker, {
            isAdmin: me.isAdmin,
            onDone: ({ profile, token, remember }) => {
                pm.storeActive({ id: profile.id, token }, remember);
                root.unmount();
                resolve({ me, profile });
            }
        }));
    });
}

module.exports = { ensureProfile };
