// Copyright (C) 2017-2026 HomeBot Cinema
// SSO Isolation & Universal Addons Management

const defaultAddons = require('./defaultAddons.json');
const profileManager = require('./profileManager');
const { applyTheme } = require('./theme');
// Same origin as the page: the server proxies /settings, /hlsv2, /<infohash>/... to the streaming container.
// (A hard-coded other hostname has no Cloudflare session on cinema.* and fails with a CORS/redirect error.)
const DEFAULT_STREAMING_URL = `${window.location.origin}/`;

const USER_SCOPED_KEYS = new Set([
    'library',
    'library_recent',
    'profile',
    'search_history',
    'notifications',
    'dismissed_events'
]);

// Every field stremio-core requires in a stored profile. A profile missing any of them makes the core fail with
// "Serialization error: missing field ..." and the app shows "Something went wrong" (this is what broke every
// profile except the first one used in a browser: the core's one-time migration repairs only the first).
const DEFAULT_SETTINGS = {
    interfaceLanguage: 'eng',
    interfaceScale: 90, // DEFAULT_INTERFACE_SCALE (see interfaceScaleOptions.js)
    hideSpoilers: false,
    gamepadSupport: false,
    streamingServerUrl: DEFAULT_STREAMING_URL,
    playerType: null,
    bingeWatching: true,
    playInBackground: true,
    hardwareDecoding: true,
    gpuVideoProcessing: false,
    videoMode: null,
    frameRateMatchingStrategy: 'Disabled',
    nextVideoNotificationDuration: 35000,
    audioPassthrough: false,
    audioLanguage: 'eng',
    secondaryAudioLanguage: null,
    subtitlesLanguage: 'eng',
    secondarySubtitlesLanguage: null,
    subtitlesAutoSelect: true,
    subtitlesSize: 100,
    subtitlesFont: 'Roboto',
    subtitlesBold: false,
    subtitlesOffset: 5,
    subtitlesTextColor: '#FFFFFFFF',
    subtitlesBackgroundColor: '#00000000',
    subtitlesOutlineColor: '#000000',
    subtitlesOpacity: 100,
    assSubtitlesStyling: false,
    escExitFullscreen: true,
    seekTimeDuration: 10000,
    seekShortTimeDuration: 3000,
    pauseOnMinimize: false,
    quitOnClose: true,
    surroundSound: false,
    streamingServerWarningDismissed: null,
    serverInForeground: false,
    sendCrashReports: false,
    discordRpcEnabled: false
};
// names used by older versions of this file / the core; unknown to the current core
const LEGACY_SETTINGS = ['playInExternalPlayer', 'autoFrameRateMatching'];

let originalGetItem = null;
let originalSetItem = null;
let originalRemoveItem = null;
let syncTimer = null;
let isInitialized = false;

function setupStorageInterceptors() {
    if (originalGetItem) return;

    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function (key) {
        if (window.ssoScope && USER_SCOPED_KEYS.has(key)) {
            const scopedKey = `${key}:${window.ssoScope}`;
            return originalGetItem.call(this, scopedKey);
        }
        return originalGetItem.call(this, key);
    };

    Storage.prototype.setItem = function (key, value) {
        if (window.ssoScope && USER_SCOPED_KEYS.has(key)) {
            const scopedKey = `${key}:${window.ssoScope}`;
            originalSetItem.call(this, scopedKey, value);
            if (key === 'library' || key === 'library_recent') {
                scheduleLibrarySyncToServer();
            }
            return;
        }
        originalSetItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function (key) {
        if (window.ssoScope && USER_SCOPED_KEYS.has(key)) {
            const scopedKey = `${key}:${window.ssoScope}`;
            originalRemoveItem.call(this, scopedKey);
            if (key === 'library' || key === 'library_recent') {
                scheduleLibrarySyncToServer();
            }
            return;
        }
        originalRemoveItem.call(this, key);
    };
}

function readScopedBuckets() {
    const rawLib = originalGetItem.call(window.localStorage, `library:${window.ssoScope}`);
    const rawRecent = originalGetItem.call(window.localStorage, `library_recent:${window.ssoScope}`);
    return {
        library: rawLib ? JSON.parse(rawLib) : null,
        library_recent: rawRecent ? JSON.parse(rawRecent) : null
    };
}

function postLibrary(keepalive) {
    return fetch('/api/sync/library', {
        method: 'POST',
        credentials: 'same-origin',
        headers: profileManager.profileHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(readScopedBuckets()),
        keepalive
    });
}

function flushSyncToServer() {
    if (!window.ssoScope || !originalGetItem) return;
    try {
        // keepalive fetch (unlike sendBeacon) can carry the profile headers
        postLibrary(true).catch(() => { /* best effort on unload */ });
    } catch (e) {
        console.error('[HomeBot Cinema] Failed to flush sync:', e);
    }
}

function scheduleLibrarySyncToServer() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        if (!window.ssoScope || !originalGetItem) return;
        try {
            await postLibrary(false);
        } catch (e) {
            console.error('[HomeBot Cinema] Error syncing library to backend:', e);
        }
    }, 1200);
}

function mergeBuckets(localBucket, remoteBucket) {
    if (!localBucket && !remoteBucket) return { uid: null, items: {} };
    if (!localBucket) return remoteBucket;
    if (!remoteBucket) return localBucket;

    const merged = {
        uid: localBucket.uid || remoteBucket.uid || null,
        items: { ...(remoteBucket.items || {}), ...(localBucket.items || {}) }
    };

    // If both contain same item, pick one with more recent mtime
    const localItems = localBucket.items || {};
    const remoteItems = remoteBucket.items || {};
    for (const key of Object.keys(localItems)) {
        if (remoteItems[key]) {
            const localMtime = new Date(localItems[key].mtime || 0).getTime();
            const remoteMtime = new Date(remoteItems[key].mtime || 0).getTime();
            if (remoteMtime > localMtime) {
                merged.items[key] = remoteItems[key];
            }
        }
    }
    return merged;
}

async function initSSOManager(identity) {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Identity (verified by the server from the Cloudflare Access token) + active household profile.
    //    index.js resolves the profile first (picker screen) and passes it in.
    const { me, profile: activeProfile } = identity;
    const email = me.email;
    const scope = `p${activeProfile.id}`;
    window.ssoUserEmail = email;
    window.ssoIsAdmin = !!me.isAdmin;
    window.ssoProfile = activeProfile;
    window.ssoScope = scope;
    applyTheme(activeProfile);
    // eslint-disable-next-line no-console
    console.info('[HomeBot Cinema] Active login / profile:', email, '/', activeProfile.name);

    // 2. Fetch universal addons from backend
    let universalAddons = defaultAddons;
    try {
        const addonsRes = await fetch(`/api/addons?_ts=${Date.now()}`, {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        if (addonsRes.ok) {
            const addonsData = await addonsRes.json();
            if (Array.isArray(addonsData) && addonsData.length > 0) {
                universalAddons = addonsData;
            }
        }
    } catch (e) {
        console.warn('[HomeBot Cinema] Could not fetch universal addons from backend:', e);
    }
    window.universalAddons = universalAddons;

    // 3. Setup prototype interceptors so all subsequent localStorage calls are user-scoped
    setupStorageInterceptors();

    // 4. Fetch user library from backend & merge with local storage
    try {
        const libRes = await fetch(`/api/sync/library?_ts=${Date.now()}`, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: profileManager.profileHeaders()
        });
        if (libRes.ok) {
            const libData = await libRes.json();
            if (libData) {
                const rawLocalLib = originalGetItem.call(window.localStorage, `library:${scope}`);
                const rawLocalRecent = originalGetItem.call(window.localStorage, `library_recent:${scope}`);
                const localLib = rawLocalLib ? JSON.parse(rawLocalLib) : null;
                const localRecent = rawLocalRecent ? JSON.parse(rawLocalRecent) : null;

                const mergedLib = mergeBuckets(localLib, libData.library);
                const mergedRecent = mergeBuckets(localRecent, libData.library_recent);

                originalSetItem.call(window.localStorage, `library:${scope}`, JSON.stringify(mergedLib));
                originalSetItem.call(window.localStorage, `library_recent:${scope}`, JSON.stringify(mergedRecent));
            }
        }
    } catch (e) {
        console.error('[HomeBot Cinema] Failed to load remote library:', e);
    }

    // 5. Initialize or synchronize user's profile with universal addons & streaming server URL
    try {
        const rawProfile = originalGetItem.call(window.localStorage, `profile:${scope}`);
        let profile = null;
        if (rawProfile) {
            try {
                profile = JSON.parse(rawProfile);
            } catch (_) { /* keep going with what we have */ }
        }

        if (!profile) {
            profile = { auth: null, addons: universalAddons, addonsLocked: false, settings: { ...DEFAULT_SETTINGS } };
        } else {
            // self-heal a profile stored by an older build: fill every missing required field, drop unknown ones
            profile.settings = { ...DEFAULT_SETTINGS, ...(profile.settings || {}) };
            for (const k of LEGACY_SETTINGS) delete profile.settings[k];
            if (typeof profile.addonsLocked !== 'boolean') profile.addonsLocked = false;
            profile.settings.streamingServerUrl = DEFAULT_STREAMING_URL;
            profile.addons = universalAddons;
        }

        originalSetItem.call(window.localStorage, `profile:${scope}`, JSON.stringify(profile));

        // Enforce streaming server URLs bucket globally
        const rawUrls = originalGetItem.call(window.localStorage, 'streaming_server_urls');
        let bucket = { uid: null, items: {} };
        if (rawUrls) {
            try {
                const parsed = JSON.parse(rawUrls);
                if (parsed && typeof parsed.items === 'object' && !Array.isArray(parsed.items)) {
                    bucket = parsed;
                }
            } catch (_) { /* keep going with what we have */ }
        }
        for (const k of Object.keys(bucket.items || {})) {
            if (k.includes('127.0.0.1') || k.includes('localhost')) delete bucket.items[k];
        }
        bucket.items = bucket.items || {};
        bucket.items[DEFAULT_STREAMING_URL] = bucket.items[DEFAULT_STREAMING_URL] || new Date().toISOString();
        originalSetItem.call(window.localStorage, 'streaming_server_urls', JSON.stringify(bucket));
    } catch (e) {
        console.error('[HomeBot Cinema] Failed to initialize profile & server URL:', e);
    }

    // 6. Listen for unload / background to flush pending sync
    window.addEventListener('beforeunload', flushSyncToServer);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSyncToServer();
    });
}

module.exports = {
    initSSOManager,
    flushSyncToServer,
    DEFAULT_STREAMING_URL
};
