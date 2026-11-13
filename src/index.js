// Copyright (C) 2017-2023 Smart code 203358507

if (typeof process.env.SENTRY_DSN === 'string') {
    const Sentry = require('@sentry/browser');
    Sentry.init({ dsn: process.env.SENTRY_DSN });
}

const Bowser = require('bowser');
const browser = Bowser.parse(window.navigator?.userAgent || '');
if (browser?.platform?.type === 'desktop') {
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', '');
}

const React = require('react');
const ReactDOM = require('react-dom/client');
const { HashRouter } = require('react-router-dom');
const i18n = require('i18next');
const { initReactI18next } = require('react-i18next');
const enUS = require('stremio-translations/en-US.json');
const App = require('./App');
const { default: WebUpdateScreen } = require('./App/WebUpdateScreen');
const { CoreProvider } = require('./core');
const { FileDropProvider, PlatformProvider } = require('./common');
const { initSSOManager } = require('./common/ssoManager');
const { ensureProfile } = require('./common/profileGate');

// only English is bundled; App switches to the profile's language via common/i18nLanguages (loaded on demand)
const translations = { 'en-US': { translation: enUS } };

i18n
    .use(initReactI18next)
    .init({
        resources: translations,
        lng: 'en-US',
        fallbackLng: 'en-US',
        interpolation: {
            escapeValue: false
        }
    });

const appInfo = {
    appVersion: process.env.VERSION,
    shellVersion: null
};

async function startHomeBotCinema() {
    // Purge outdated CacheStorage caches from previous builds
    if (typeof window !== 'undefined' && 'caches' in window) {
        try {
            const cacheKeys = await caches.keys();
            for (const key of cacheKeys) {
                if (process.env.COMMIT_HASH && !key.startsWith('workbox-') && !key.includes(process.env.COMMIT_HASH)) {
                    // eslint-disable-next-line no-console
                    console.log('[HomeBot Cinema] Purging stale cache:', key);
                    await caches.delete(key);
                }
            }
        } catch (_) { /* cache cleanup is optional */ }
    }

    // Resolve the household profile ("Who's watching?") before anything reads per-profile storage,
    // then initialize profile isolation, universal addons and the localStorage interceptors.
    const identity = await ensureProfile();
    await initSSOManager(identity);

    const root = ReactDOM.createRoot(document.getElementById('app'));
    root.render(
        <React.StrictMode>
            <PlatformProvider>
                <CoreProvider appInfo={appInfo}>
                    <FileDropProvider>
                        <HashRouter>
                            <>
                                <WebUpdateScreen />
                                <App />
                            </>
                        </HashRouter>
                    </FileDropProvider>
                </CoreProvider>
            </PlatformProvider>
        </React.StrictMode>
    );
}

startHomeBotCinema().catch((e) => {
    console.error('[HomeBot Cinema] Boot failure:', e);
});
