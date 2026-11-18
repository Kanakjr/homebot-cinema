import React, { useMemo } from 'react';
import { Button } from 'stremio/components';
import styles from './User.less';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { switchProfile, signOutUrl } = require('stremio/common/profileManager');

type Props = {
    profile: Profile,
};

const User = ({ profile }: Props) => {
    const ssoEmail = (typeof window !== 'undefined' && window.ssoUserEmail) ? window.ssoUserEmail : '';

    const avatar = useMemo(() => (
        profile.auth?.user?.avatar ?
            `url('${profile.auth.user.avatar}')`
            :
            `url('${require('/assets/images/default_avatar.png')}')`
    ), [profile.auth]);

    return (
        <div className={styles['user']}>
            <div className={styles['user-info-content']}>
                <div
                    className={styles['avatar-container']}
                    style={{ backgroundImage: avatar, border: '2px solid var(--primary-accent-color)' }}
                />
                <div className={styles['email-logout-container']}>
                    <div className={styles['email-label-container']} title={ssoEmail}>
                        <div className={styles['email-label']} style={{ fontWeight: 600, color: '#fff' }}>
                            {ssoEmail}
                        </div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--primary-accent-color)', marginTop: '0.2rem' }}>
                        {/* HomeBot: plain wording instead of the sign-in mechanism */}
                        {(window as unknown as { ssoIsAdmin?: boolean }).ssoIsAdmin ? 'Signed in · admin' : 'Signed in'}
                    </div>
                </div>
            </div>
            {/* HomeBot: the account actions live here, first in Settings, not only in the avatar menu */}
            <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1.2rem' }}>
                <Button className={styles['action']} onClick={switchProfile}>Switch profile</Button>
                <a className={styles['action']} href={signOutUrl()}>Sign out</a>
            </div>
        </div>
    );
};

export default User;
