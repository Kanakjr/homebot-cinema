// Copyright (C) 2017-2023 Smart code 203358507

import React, { memo } from 'react';
import classnames from 'classnames';
import { VerticalNavBar, HorizontalNavBar } from 'stremio/components/NavBar';
import { useContentGamepadNavigation, useVerticalNavGamepadNavigation } from 'stremio/services/GamepadNavigation';
import styles from './MainNavBars.less';
const { useNewOnServer } = require('stremio/common/newOnServer');
// the tab list is shared with the number-key shortcuts (App.js)
const { navTabs } = require('stremio/common/navTabs');

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
    const tabs = React.useMemo(() => navTabs(isAdmin)
        .map((tab: { id: string, label: string, icon: string, href: string }) => (tab.id === 'library' && fresh.length > 0 ? { ...tab, badge: fresh.length, badgeTitle: `New on your server: ${fresh.map((i: { title: string }) => i.title).join(', ')}` } : tab)), [isAdmin, fresh]);
    const navRoute = route === 'continue_watching' ? 'library' : (route ?? '');
    // HomeBot: once the page is scrolled, the header gets a divider and shadow so the content's top edge reads as a
    // scroll edge (vertical scrollers only: the horizontal rows scroll sideways and must not reset it)
    const [scrolled, setScrolled] = React.useState(false);
    const onContentScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.scrollHeight <= target.clientHeight + 1) return;
        setScrolled(target.scrollTop > 4);
    }, []);
    React.useEffect(() => {
        setScrolled(false);
    }, [route]);
    useContentGamepadNavigation(contentRef, navRoute);
    useVerticalNavGamepadNavigation(navRef, navRoute);

    return (
        <div className={classnames(className, styles['main-nav-bars-container'])}>
            <HorizontalNavBar
                className={classnames(styles['horizontal-nav-bar'], { [styles['scrolled']]: scrolled })}
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
            <div ref={contentRef} className={styles['nav-content-container']} onScrollCapture={onContentScroll}>{children}</div>
        </div>
    );
});

export default MainNavBars;

