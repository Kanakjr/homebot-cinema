// Copyright (C) 2017-2026 HomeBot Cinema

import React from 'react';
import Icon from '@stremio/stremio-icons/react';
import { Button, Image } from 'stremio/components';
import styles from './Placeholder.less';

const Placeholder = () => {
    const ssoEmail = (typeof window !== 'undefined' && window.ssoUserEmail) ? window.ssoUserEmail : 'Cloudflare SSO User';

    return (
        <div className={styles['placeholder']}>
            <div className={styles['title']} style={{ color: '#F27A24' }}>
                HomeBot Cinema Library
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
                        User-Isolated Watchlist & Favorites for {ssoEmail}
                    </div>
                </div>
                <div className={styles['point']}>
                    <Icon className={styles['icon']} name={'actors'} />
                    <div className={styles['text']}>
                        Synced directly to HomeServer database & storage
                    </div>
                </div>
            </div>
            <div className={styles['button-container']}>
                <Button className={styles['button']} href={'#/'}>
                    Browse Cinema Catalogs
                </Button>
            </div>
        </div>
    );
};

export default Placeholder;
