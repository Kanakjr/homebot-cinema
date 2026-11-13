// Copyright (C) 2017-2026 Smart code 203358507

import { useCallback, useEffect, useRef } from 'react';
import { useCore } from 'stremio/core';
import { usePlatform } from 'stremio/common/Platform';
import { INTERFACE_SCALES, DEFAULT_INTERFACE_SCALE } from 'stremio/common/CONSTANTS';
import { normalizeInterfaceScale, setInterfaceScale } from 'stremio/common/interfaceScale';

type ScaleAction = 'decrease' | 'increase' | 'reset';

const markerKey = () => `homebot_zoom_default_90:${(window as unknown as { ssoScope?: string }).ssoScope ?? ''}`;
const writeMarker = () => {
    try {
        window.localStorage.setItem(markerKey(), '1');
    } catch {
        // storage unavailable: nothing to remember
    }
};

const useInterfaceScale = (profile: Profile) => {
    const core = useCore();
    const { shell } = usePlatform();
    const settingsRef = useRef(profile.settings);
    const scale = normalizeInterfaceScale(profile.settings?.interfaceScale);

    useEffect(() => {
        settingsRef.current = profile.settings;
    }, [profile.settings]);

    const changeInterfaceScale = useCallback((action: ScaleAction) => {
        const settings = settingsRef.current;
        if (!settings) return;

        const current = normalizeInterfaceScale(settings.interfaceScale);
        const index = INTERFACE_SCALES.indexOf(current);
        const next = action === 'reset' ? DEFAULT_INTERFACE_SCALE : INTERFACE_SCALES[
            Math.max(0, Math.min(INTERFACE_SCALES.length - 1, index + (action === 'increase' ? 1 : -1)))
        ];
        if (next === settings.interfaceScale) return;

        settingsRef.current = { ...settings, interfaceScale: next };
        core.transport.dispatch({
            action: 'Ctx',
            args: { action: 'UpdateSettings', args: settingsRef.current }
        });
    }, [core.transport]);

    // One-time: the default zoom changed from 100% to 90%. A profile still on the old default moves to the new one;
    // anyone who picks 100% afterwards keeps it (a per-profile marker stops this from running again).
    // The core rewrites a fresh profile with its own default (100) a moment after start, so this watches the value
    // instead of checking once, and only gives up (sets the marker) after a few quiet seconds.
    const currentScale = profile.settings?.interfaceScale;
    const migratedRef = useRef(false);
    useEffect(() => {
        if (migratedRef.current || currentScale === undefined) return;
        try {
            if (window.localStorage.getItem(markerKey()) !== null) {
                migratedRef.current = true;
                return;
            }
        } catch {
            migratedRef.current = true;
            return;
        }
        if (currentScale !== 100) return;
        // wait until the value has stayed at 100 for a moment: the core's own first-run rewrite would undo an earlier change
        const timer = setTimeout(() => {
            if (migratedRef.current) return;
            migratedRef.current = true;
            writeMarker();
            const settings = settingsRef.current;
            if (!settings || settings.interfaceScale !== 100) return;
            settingsRef.current = { ...settings, interfaceScale: DEFAULT_INTERFACE_SCALE };
            core.transport.dispatch({
                action: 'Ctx',
                args: { action: 'UpdateSettings', args: settingsRef.current }
            });
        }, 1500);
        return () => clearTimeout(timer);
    }, [currentScale, core.transport]);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (migratedRef.current) return;
            migratedRef.current = true;
            writeMarker();
        }, 4000);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (shell.active && !shell.state.initialized) return;

        if (shell.capabilities.nativeInterfaceScale) {
            setInterfaceScale(1);
            shell.send('win-set-interface-scale', { scale });
        } else {
            setInterfaceScale(scale / 100);
        }
    }, [scale, shell]);

    useEffect(() => {
        const onScale = (action: string) => {
            if (action === 'increase' || action === 'decrease' || action === 'reset') {
                changeInterfaceScale(action);
            }
        };
        shell.on('interface-scale', onScale);
        return () => { shell.off('interface-scale', onScale); };
    }, [changeInterfaceScale, shell]);

    return changeInterfaceScale;
};

export default useInterfaceScale;
