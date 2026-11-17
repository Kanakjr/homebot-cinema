// Copyright (C) 2017-2023 Smart code 203358507

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classnames from 'classnames';
import throttle from 'lodash.throttle';
import { usePlatform, useProfile, useStreamingServer, useRouteFocused, withCoreSuspender } from 'stremio/common';
import { MainNavBars } from 'stremio/components';
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
    const routeFocused = useRouteFocused();
    const profile = useProfile();
    const platform = usePlatform();
    const streamingServer = useStreamingServer();

    const sectionsContainerRef = useRef<HTMLDivElement>(null);
    const generalSectionRef = useRef<HTMLDivElement>(null);
    const interfaceSectionRef = useRef<HTMLDivElement>(null);
    const playerSectionRef = useRef<HTMLDivElement>(null);
    const streamingServerSectionRef = useRef<HTMLDivElement>(null);
    const shortcutsSectionRef = useRef<HTMLDivElement>(null);

    // sections contributed by plugins (slot "settingsSections"), shown right after General
    const pluginSections = useMemo(() => slot('settingsSections').map((s: any) => ({ ...s, ref: React.createRef<HTMLDivElement>() })), []);

    const sections = useMemo(() => ([
        { ref: generalSectionRef, id: SECTIONS.GENERAL },
        ...pluginSections.map((s: any) => ({ ref: s.ref, id: s.id })),
        { ref: interfaceSectionRef, id: SECTIONS.INTERFACE },
        { ref: playerSectionRef, id: SECTIONS.PLAYER },
        { ref: streamingServerSectionRef, id: SECTIONS.STREAMING },
        { ref: shortcutsSectionRef, id: SECTIONS.SHORTCUTS },
    ]), [pluginSections]);

    const [selectedSectionId, setSelectedSectionId] = useState(SECTIONS.GENERAL);

    const updateSelectedSectionId = useCallback(() => {
        const container = sectionsContainerRef.current;
        if (!container) return;

        const availableSections = sections.filter((section) => section.ref.current);
        if (!availableSections.length) return;

        const { scrollTop, clientHeight, scrollHeight, offsetTop } = container;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

        if (isAtBottom) {
            setSelectedSectionId(availableSections[availableSections.length - 1].id);
            return;
        }

        // HomeBot: the section in the upper third of the view is the current one (a 50px marker kept the previous,
        // mostly scrolled-away section lit), measured like the menu click (container offset subtracted, not added)
        const marker = scrollTop + clientHeight / 3;
        const activeSection = availableSections.reduce((current, section) => {
            const sectionTop = section.ref.current!.offsetTop - offsetTop;
            return sectionTop <= marker ? section : current;
        }, availableSections[0]);

        setSelectedSectionId(activeSection.id);
    }, [sections]);

    const onMenuSelect = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const section = sections.find((section) => {
            return section.id === event.currentTarget.dataset.section;
        });

        const container = sectionsContainerRef.current;
        section && container?.scrollTo({
            top: section.ref.current!.offsetTop - container!.offsetTop,
            behavior: 'smooth'
        });
    }, [sections]);

    const onContainerScroll = useCallback(throttle(() => {
        updateSelectedSectionId();
    }, 50), []);

    useLayoutEffect(() => {
        if (routeFocused) {
            updateSelectedSectionId();
        }
    }, [routeFocused]);

    return (
        <MainNavBars className={styles['settings-container']} route={'settings'}>
            <div className={classnames(styles['settings-content'], 'animation-fade-in')}>
                <Menu
                    selected={selectedSectionId}
                    streamingServer={streamingServer}
                    extraSections={pluginSections}
                    onSelect={onMenuSelect}
                />

                <div ref={sectionsContainerRef} className={styles['sections-container']} onScroll={onContainerScroll}>
                    <General
                        ref={generalSectionRef}
                        profile={profile}
                    />
                    {pluginSections.map((s: any) => renderPlugin(s, 'settingsSections', {}, s.ref))}
                    <Interface
                        ref={interfaceSectionRef}
                        profile={profile}
                    />
                    <Player
                        ref={playerSectionRef}
                        profile={profile}
                    />
                    <Streaming
                        ref={streamingServerSectionRef}
                        profile={profile}
                        streamingServer={streamingServer}
                    />
                    {
                        !platform.isMobile && <Shortcuts ref={shortcutsSectionRef} />
                    }
                    <Info streamingServer={streamingServer} />
                </div>
            </div>
        </MainNavBars>
    );
};

const SettingsFallback = () => (
    <MainNavBars className={styles['settings-container']} route={'settings'} />
);

export default withCoreSuspender(Settings, SettingsFallback);
