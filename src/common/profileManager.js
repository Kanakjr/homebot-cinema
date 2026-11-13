// Copyright (C) 2017-2026 HomeBot Cinema
// Household profile helpers: server API + remembered active profile.
//
// The active profile is stored under a key that is NOT user-scoped (see ssoManager USER_SCOPED_KEYS),
// either in localStorage ("use this profile next time") or sessionStorage (ask again next visit).

const STORE_KEY = 'homebot_active_profile';

function readStored() {
    for (const store of [window.localStorage, window.sessionStorage]) {
        try {
            const raw = store.getItem(STORE_KEY);
            if (raw) return { ...JSON.parse(raw), remembered: store === window.localStorage };
        } catch (_) {
            // storage unavailable or corrupt: treat as nothing stored
        }
    }
    return null;
}

function storeActive({ id, token }, remember) {
    clearActive();
    try {
        (remember ? window.localStorage : window.sessionStorage).setItem(STORE_KEY, JSON.stringify({ id, token: token || null }));
    } catch (_) {
        // storage unavailable: the picker will simply show again next time
    }
}

function clearActive() {
    for (const store of [window.localStorage, window.sessionStorage]) {
        try {
            store.removeItem(STORE_KEY);
        } catch (_) {
            // ignore
        }
    }
}

function profileHeaders(extra = {}) {
    const stored = readStored();
    const headers = { ...extra };
    if (stored && stored.id) {
        headers['X-Profile-Id'] = String(stored.id);
        if (stored.token) headers['X-Profile-Token'] = stored.token;
    }
    return headers;
}

async function api(method, url, body, headers = {}) {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let json = null;
    try {
        json = await res.json();
    } catch (_) {
        // empty or non-JSON body
    }
    if (!res.ok) {
        const err = new Error((json && json.error) || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = json;
        throw err;
    }
    return json;
}

// the deployment's own links (sign-out, optional dashboard) arrive with /api/me, so no hostname is hardcoded in the UI
const fetchMe = async () => {
    const me = await api('GET', '/api/me');
    window.ssoLinks = { signOutUrl: me.signOutUrl || null, dashboardUrl: me.dashboardUrl || null };
    return me;
};
const fetchProfiles = () => api('GET', '/api/profiles');
const fetchAvatars = () => api('GET', '/api/avatars');
const unlockProfile = (id, pin) => api('POST', `/api/profiles/${id}/unlock`, { pin });
const createProfile = (data) => api('POST', '/api/profiles', data);
const updateProfile = (id, data, headers) => api('PATCH', `/api/profiles/${id}`, data, headers);
const deleteProfile = (id) => api('DELETE', `/api/profiles/${id}`);
const setPin = (id, pin, currentPin, headers) => api('POST', `/api/profiles/${id}/pin`, { pin, currentPin }, headers);
const removePin = (id, currentPin) => api('POST', `/api/profiles/${id}/pin/remove`, { currentPin });
const uploadAvatar = (dataUrl) => api('POST', '/api/avatars', { dataUrl });

// Returns the stored profile if it still exists and (when PIN-protected) the saved token still unlocks it.
async function resolveStoredProfile(profiles) {
    const stored = readStored();
    if (!stored) return null;
    const profile = profiles.find((p) => p.id === stored.id);
    if (!profile) return null;
    try {
        await api('GET', '/api/sync/settings', undefined, profileHeaders());
        return profile;
    } catch (_) {
        return null;
    }
}

// Forget the active profile and reload, which shows the picker again.
function switchProfile() {
    clearActive();
    window.location.reload();
}

const signOutUrl = () => (window.ssoLinks && window.ssoLinks.signOutUrl) || '/cdn-cgi/access/logout';
const dashboardUrl = () => (window.ssoLinks && window.ssoLinks.dashboardUrl) || null;

module.exports = {
    readStored,
    storeActive,
    clearActive,
    profileHeaders,
    fetchMe,
    fetchProfiles,
    fetchAvatars,
    unlockProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    setPin,
    removePin,
    uploadAvatar,
    resolveStoredProfile,
    switchProfile,
    signOutUrl,
    dashboardUrl
};
