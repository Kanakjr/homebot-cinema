// Copyright (C) 2017-2026 HomeBot Cinema

import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '@stremio/stremio-icons/react';
import { Button, Image } from 'stremio/components';
import styles from './Placeholder.less';

const Placeholder = () => {
    const { t } = useTranslation();
    const ssoEmail = (typeof window !== 'undefined' && window.ssoUserEmail) ? window.ssoUserEmail : 'Cloudflare SSO User';

    return (
        <div className={styles['placeholder']}>
            <div className={styles['title']} style={{ color: 'var(--primary-accent-color)' }}>
                {t('HOMEBOT_LIBRARY_PLACEHOLDER_TITLE', 'HomeBot Cinema Library')}
            </div>
            <div className={styles['image-container']}>
                <Image
                    className={styles['image']}
                    src={require('/assets/images/library_placeholder.png')}
                    alt={' '}
                />
            </div>
            <div className={styles['overview']}>
                <div className={styles['point']}>
                    <Icon className={styles['icon']} name={'cloud-library'} />
                    <div className={styles['text']}>
                        {t('HOMEBOT_LIBRARY_PLACEHOLDER_ISOLATED', 'User-Isolated Watchlist & Favorites for {{email}}', { email: ssoEmail })}
                    </div>
                </div>
                <div className={styles['point']}>
                    <Icon className={styles['icon']} name={'actors'} />
                    <div className={styles['text']}>
                        {t('HOMEBOT_LIBRARY_PLACEHOLDER_SYNC', 'Synced directly to HomeServer database & storage')}
                    </div>
                </div>
            </div>
            <div className={styles['button-container']}>
                <Button className={styles['button']} href={'#/'}>
                    {t('HOMEBOT_BROWSE_CATALOGS', 'Browse Cinema Catalogs')}
                </Button>
            </div>
        </div>
    );
};

export default Placeholder;
