// Copyright (C) 2017-2023 Smart code 203358507

import React, { memo } from 'react';
import classnames from 'classnames';
import { VerticalNavBar, HorizontalNavBar } from 'stremio/components/NavBar';
import { useContentGamepadNavigation, useVerticalNavGamepadNavigation } from 'stremio/services/GamepadNavigation';
import styles from './MainNavBars.less';
const { useNewOnServer } = require('stremio/common/newOnServer');

const BASE_TABS = [
    { id: 'board', label: 'Home', icon: 'home', href: '/' },
    { id: 'discover', label: 'Discover', icon: 'discover', href: '/discover' },
    { id: 'library', label: 'Library', icon: 'library', href: '/library' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/calendar' },
    { id: 'downloads', label: 'Downloads', icon: 'download', href: '/downloads' },
    { id: 'settings', label: 'SETTINGS', icon: 'settings', href: '/settings' },
];
const ADMIN_TAB = { id: 'admin', label: 'Admin', icon: 'lock', href: '/admin' };

type Props = {
    className: string,
    route?: string,
    query?: string,
    children?: React.ReactNode,
};

const MainNavBars = memo(({ className, route, query, children }: Props) => {
    const navRef = React.useRef(null);
    const contentRef = React.useRef(null);

    const isAdmin = !!(window as unknown as { ssoIsAdmin?: boolean }).ssoIsAdmin;
    const fresh = useNewOnServer();
    const tabs = React.useMemo(() => (isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS)
        .map((tab) => (tab.id === 'library' && fresh.length > 0 ? { ...tab, badge: fresh.length, badgeTitle: `New on your server: ${fresh.map((i: { title: string }) => i.title).join(', ')}` } : tab)), [isAdmin, fresh]);
    const navRoute = route === 'continue_watching' ? 'library' : (route ?? '');
    useContentGamepadNavigation(contentRef, navRoute);
    useVerticalNavGamepadNavigation(navRef, navRoute);

    return (
        <div className={classnames(className, styles['main-nav-bars-container'])}>
            <HorizontalNavBar
                className={styles['horizontal-nav-bar']}
                route={route}
                query={query}
                backButton={false}
                searchBar={true}
                fullscreenButton={true}
                navMenu={true}
            />
            <VerticalNavBar
                ref={navRef}
                className={styles['vertical-nav-bar']}
                selected={route}
                tabs={tabs}
            />
            <div ref={contentRef} className={styles['nav-content-container']}>{children}</div>
        </div>
    );
});

export default MainNavBars;

