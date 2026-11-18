// Copyright (C) 2017-2023 Smart code 203358507

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classnames from 'classnames';
import { usePlatform, useProfile, useStreamingServer, withCoreSuspender } from 'stremio/common';
import { MainNavBars } from 'stremio/components';
import PageHeader from 'stremio/components/PageHeader';
import { SECTIONS } from './constants';
import Menu from './Menu';
import General from './General';
import { slot, renderPlugin } from 'stremio/plugins';
import Interface from './Interface';
import Player from './Player';
import Streaming from './Streaming';
import Shortcuts from './Shortcuts';
import Info from './Info';
import styles from './Settings.less';

const Settings = () => {
    const profile = useProfile();
    const platform = usePlatform();
    const streamingServer = useStreamingServer();

    const sectionsContainerRef = useRef<HTMLDivElement>(null);

    // sections contributed by plugins (slot "settingsSections"), shown right after General
    const pluginSections = useMemo(() => slot('settingsSections').map((s: any) => ({ ...s, ref: React.createRef<HTMLDivElement>() })), []);

    // HomeBot: one pane per section (the menu and the content can no longer disagree, which also retires the scroll-spy)
    const [selectedSectionId, setSelectedSectionId] = useState<string>(SECTIONS.GENERAL);

    const onMenuSelect = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const id = event.currentTarget.dataset.section;
        if (id) {
            setSelectedSectionId(id);
        }
    }, []);

    useLayoutEffect(() => {
        if (sectionsContainerRef.current) {
            sectionsContainerRef.current.scrollTop = 0;
        }
    }, [selectedSectionId]);

    const selectedPlugin = pluginSections.find((s: any) => s.id === selectedSectionId);
    const titles: Record<string, string> = {
        [SECTIONS.GENERAL]: 'Account',
        [SECTIONS.INTERFACE]: 'Interface',
        [SECTIONS.PLAYER]: 'Player',
        [SECTIONS.STREAMING]: 'Streaming',
        [SECTIONS.SHORTCUTS]: 'Shortcuts',
        [SECTIONS.ABOUT]: 'About',
    };

    return (
        <MainNavBars className={styles['settings-container']} route={'settings'}>
            <div className={classnames(styles['settings-content'], 'animation-fade-in')}>
                <Menu
                    selected={selectedSectionId}
                    extraSections={pluginSections}
                    onSelect={onMenuSelect}
                />

                <div ref={sectionsContainerRef} className={styles['sections-container']}>
                    <div className={styles['sections-inner']}>
                        <PageHeader eyebrow="Settings" title={selectedPlugin ? selectedPlugin.label : (titles[selectedSectionId] || 'Settings')} />
                        {selectedSectionId === SECTIONS.GENERAL && <General profile={profile} />}
                        {selectedPlugin && renderPlugin(selectedPlugin, 'settingsSections', {}, selectedPlugin.ref)}
                        {selectedSectionId === SECTIONS.INTERFACE && <Interface profile={profile} />}
                        {selectedSectionId === SECTIONS.PLAYER && <Player profile={profile} />}
                        {selectedSectionId === SECTIONS.STREAMING && <Streaming profile={profile} streamingServer={streamingServer} />}
                        {selectedSectionId === SECTIONS.SHORTCUTS && !platform.isMobile && <Shortcuts />}
                        {selectedSectionId === SECTIONS.ABOUT && <Info streamingServer={streamingServer} />}
                    </div>
                </div>
            </div>
        </MainNavBars>
    );
};

const SettingsFallback = () => (
    <MainNavBars className={styles['settings-container']} route={'settings'} />
);

export default withCoreSuspender(Settings, SettingsFallback);
