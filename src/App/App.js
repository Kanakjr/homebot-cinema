// Copyright (C) 2017-2023 Smart code 203358507

require('spatial-navigation-polyfill');
const React = require('react');
const { useTranslation } = require('react-i18next');
const { setLanguage } = require('stremio/common/i18nLanguages');
const { createPath, useLocation, useNavigate } = require('react-router');
const { useCore } = require('stremio/core');
const { Routes, useGoBack } = require('stremio-router');
const { Chromecast, ServicesProvider, GamepadProvider } = require('stremio/services');
const { FullscreenProvider, ToastProvider, TooltipProvider, ShortcutsProvider, DiscordProvider, CONSTANTS, useBinaryState, useProfile, useStreamingServer, withCoreSuspender, usePlatform } = require('stremio/common');
const ServicesToaster = require('./ServicesToaster');
const NewOnServerToaster = require('./NewOnServerToaster');
const Copilot = require('stremio/components/Copilot');
const SearchParamsHandler = require('./SearchParamsHandler');
const AutoAddonsLoader = require('./AutoAddonsLoader');
const DeepLinkHandler = require('./DeepLinkHandler');
const { default: ShellOpenHandler } = require('./ShellOpenHandler');
const { default: UpdaterBanner } = require('./UpdaterBanner');
const { default: ShortcutsModal } = require('./ShortcutsModal');
const { default: GamepadModal } = require('./GamepadModal');
const { default: useInterfaceScale } = require('./useInterfaceScale');
const styles = require('./styles');

const ProtectedRoutes = withCoreSuspender(Routes);
const NAVIGATE_TABS_ROUTES = ['/', '/discover', '/library', '/server', '/admin', '/downloads', '/calendar', '/addons', '/settings'];

const App = () => {
    const core = useCore();
    const profile = useProfile();
    const streamingServer = useStreamingServer();
    const changeInterfaceScale = useInterfaceScale(profile);
    const { i18n } = useTranslation();
    const { shell } = usePlatform();
    const location = useLocation();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const locationPath = createPath(location);
    const previousPathRef = React.useRef(locationPath);
    const [gamepadSupportEnabled, setGamepadSupportEnabled] = React.useState(false);
    const services = React.useMemo(() => {
        return {
            chromecast: new Chromecast(),
        };
    }, []);
    const [shortcutModalOpen,, closeShortcutsModal, toggleShortcutModal] = useBinaryState(false);
    const [gamepadModalOpen,, closeGamepadModal, toggleGamepadModal] = useBinaryState(false);

    const onShortcut = React.useCallback((name, combo, key) => {
        switch (name) {
            case 'interfaceScale':
                changeInterfaceScale(['decrease', 'increase', 'reset'][combo]);
                break;
            case 'shortcuts':
                toggleShortcutModal();
                break;
            case 'gamepadGuide':
                toggleGamepadModal();
                break;
            case 'navigateSearch':
                navigate('/search');
                break;
            case 'navigateTabs': {
                const index = Number(key) - 1;
                if (index >= 0 && index < NAVIGATE_TABS_ROUTES.length)
                    navigate(NAVIGATE_TABS_ROUTES[index]);
                break;
            }
            case 'navigateHistory':
                if (combo === 0) {
                    goBack();
                } else {
                    navigate(1);
                }
                break;
        }
    }, [toggleShortcutModal, toggleGamepadModal, changeInterfaceScale, navigate, goBack]);

    React.useEffect(() => {
        const prevPath = previousPathRef.current;
        previousPathRef.current = locationPath;
        if (prevPath !== locationPath) {
            core.transport.analytics({
                event: 'LocationPathChanged',
                args: { prevPath }
            });
        }
    }, [locationPath, core.transport]);

    React.useEffect(() => {
        const onChromecastStateChange = () => {
            if (services.chromecast.active) {
                services.chromecast.transport.setOptions({
                    receiverApplicationId: CONSTANTS.CHROMECAST_RECEIVER_APP_ID,
                    autoJoinPolicy: chrome.cast.AutoJoinPolicy.PAGE_SCOPED,
                    resumeSavedSession: false,
                    language: null,
                    androidReceiverCompatible: true
                });
            }
        };
        services.chromecast.on('stateChanged', onChromecastStateChange);
        services.chromecast.start();

        window.services = services;
        return () => {
            services.chromecast.stop();
            services.chromecast.off('stateChanged', onChromecastStateChange);
        };
    }, [services]);

    React.useEffect(() => {
        if (typeof profile.settings?.interfaceLanguage === 'string') {
            setLanguage(profile.settings.interfaceLanguage);
        }

        if (typeof profile.settings?.gamepadSupport === 'boolean') {
            setGamepadSupportEnabled(profile.settings.gamepadSupport);
        }

        if (profile.settings?.quitOnClose && shell.state.windowClosed) {
            shell.send('quit');
        }
    }, [profile.settings, i18n, shell]);

    const reloadAttemptsRef = React.useRef(0);

    React.useEffect(() => {
        const DEFAULT_URL = `${window.location.origin}/`;
        const currentUrl = profile.settings?.streamingServerUrl;

        if (currentUrl !== DEFAULT_URL) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'DeleteServerUrl',
                    args: 'http://127.0.0.1:11470/'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'DeleteServerUrl',
                    args: 'http://127.0.0.1:11470'
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'AddServerUrl',
                    args: DEFAULT_URL,
                }
            });
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'UpdateSettings',
                    args: {
                        ...profile.settings,
                        streamingServerUrl: DEFAULT_URL,
                    }
                }
            });
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'Reload'
                }
            });
        }

        if (streamingServer.settings?.type === 'Err' && reloadAttemptsRef.current < 3) {
            reloadAttemptsRef.current++;
            // eslint-disable-next-line no-console
            console.info(`[HomeBot Cinema] Auto-reloading streaming server (attempt ${reloadAttemptsRef.current})...`);
            core.transport.dispatch({
                action: 'StreamingServer',
                args: {
                    action: 'Reload'
                }
            });
        } else if (streamingServer.settings?.type === 'Ready') {
            reloadAttemptsRef.current = 0;
        }
    }, [profile.settings?.streamingServerUrl, streamingServer.settings, core.transport]);

    React.useEffect(() => {
        const onWindowFocus = () => {
            if (profile.auth !== null) {
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'PullAddonsFromAPI'
                    }
                });
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'PullUserFromAPI',
                        args: {}
                    }
                });
                core.transport.dispatch({
                    action: 'Ctx',
                    args: {
                        action: 'SyncLibraryWithAPI'
                    }
                });
            }
        };

        onWindowFocus();
        window.addEventListener('focus', onWindowFocus);

        return () => {
            window.removeEventListener('focus', onWindowFocus);
        };
    }, [core.transport, profile.auth]);

    return (
        <ServicesProvider services={services}>
            <ToastProvider className={styles['toasts-container']}>
                <TooltipProvider className={styles['tooltip-container']}>
                    <GamepadProvider enabled={gamepadSupportEnabled} onGuide={toggleGamepadModal}>
                        <ShortcutsProvider onShortcut={onShortcut}>
                            <FullscreenProvider>
                                <DiscordProvider>
                                    {
                                        shortcutModalOpen && <ShortcutsModal onClose={closeShortcutsModal}/>
                                    }
                                    {
                                        gamepadModalOpen && <GamepadModal onClose={closeGamepadModal}/>
                                    }
                                    <ServicesToaster />
                                    <NewOnServerToaster />
                                    <Copilot />
                                    <SearchParamsHandler />
                                    <AutoAddonsLoader />
                                    <DeepLinkHandler />
                                    <ShellOpenHandler />
                                    <UpdaterBanner className={styles['updater-banner-container']} />
                                    <ProtectedRoutes />
                                </DiscordProvider>
                            </FullscreenProvider>
                        </ShortcutsProvider>
                    </GamepadProvider>
                </TooltipProvider>
            </ToastProvider>
        </ServicesProvider>
    );
};

module.exports = withCoreSuspender(App);
