// Copyright (C) 2017-2026 Smart code 203358507

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatch } from 'react-router';
import useServiceWorkerUpdater from './useServiceWorkerUpdater';
import styles from './WebUpdateScreen.less';

const WebUpdateScreen = () => {
    const { t } = useTranslation();
    const { state, applyUpdate } = useServiceWorkerUpdater();
    const isPlayer = useMatch('/player/*');
    const autoApply = state.status === 'ready' && state.autoApply;
    useEffect(() => {
        if (autoApply && isPlayer === null) {
            applyUpdate();
        }
    }, [applyUpdate, autoApply, isPlayer]);

    if (state.status === 'applying') {
        return (
            <div
                className={styles['web-update-screen']}
                role={'status'}
                aria-live={'polite'}
                aria-busy={true}
            >
                <img
                    className={styles['logo']}
                    src={require('/assets/images/stremio_symbol.png?inline')}
                    alt={''}
                />
                <div className={styles['title']}>
                    {t('UPDATER_TITLE')}
                </div>
                <div className={styles['progress']} aria-hidden={true}>
                    <div className={styles['progress-value']} />
                </div>
            </div>
        );
    }

    // HomeBot Cinema: no "new version available" banner. A waiting update is applied on the next page load
    // (the 'applying' splash above), so household members are never nagged to reload.
    return null;
};

export default WebUpdateScreen;
