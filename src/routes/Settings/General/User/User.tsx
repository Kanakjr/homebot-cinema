import React, { useMemo } from 'react';
import styles from './User.less';

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
        </div>
    );
};

export default User;
