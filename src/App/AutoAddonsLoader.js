// Copyright (C) 2026 HomeBot Cinema
const React = require('react');
const { useCore } = require('stremio/core');
const { useProfile } = require('stremio/common');
const defaultAddons = require('../common/defaultAddons.json');

const AutoAddonsLoader = () => {
    const core = useCore();
    const profile = useProfile();
    const installedUrlsRef = React.useRef(new Set());

    React.useEffect(() => {
        if (!Array.isArray(profile.addons)) return;

        // the addons the server hands out (data/addons.json); the bundled list is only the fallback when there is none
        const wanted = Array.isArray(window.universalAddons) && window.universalAddons.length > 0 ? window.universalAddons : defaultAddons;
        const currentInstalledUrls = new Set(profile.addons.map((a) => a.transportUrl));
        const toInstall = wanted.filter((addon) => !currentInstalledUrls.has(addon.transportUrl));

        if (toInstall.length === 0) return;

        toInstall.forEach((addon) => {
            if (installedUrlsRef.current.has(addon.transportUrl)) return;
            installedUrlsRef.current.add(addon.transportUrl);

            // eslint-disable-next-line no-console
            console.info(`[HomeBot Cinema] Auto-installing missing default addon: ${addon.manifest?.name || addon.transportUrl}`);
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'InstallAddon',
                    args: {
                        transportUrl: addon.transportUrl,
                        manifest: addon.manifest,
                        flags: addon.flags || { official: false, protected: false },
                    }
                }
            });
        });
    }, [core, profile.addons]);

    return null;
};

module.exports = AutoAddonsLoader;
