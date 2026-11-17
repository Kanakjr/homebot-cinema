import React, { useMemo } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { usePlatform } from 'stremio/common';
import { Button } from 'stremio/components';
import { SECTIONS } from '../constants';
import styles from './Menu.less';

type Props = {
    selected: string,
    streamingServer: StreamingServer,
    extraSections?: { id: string, label: string }[],
    onSelect: (event: React.MouseEvent<HTMLDivElement>) => void,
};

const Menu = ({ selected, streamingServer, extraSections = [], onSelect }: Props) => {
    const { t } = useTranslation();
    const { shell } = usePlatform();
    const platform = usePlatform();

    const settings = useMemo(() => (
        streamingServer?.settings?.type === 'Ready' ?
            streamingServer.settings.content as StreamingServerSettings : null
    ), [streamingServer?.settings]);

    return (
        // HomeBot: role/aria-current so VoiceOver and keyboard users can find and follow the section links
        <div className={styles['menu']}>
            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.GENERAL })} title={t('SETTINGS_NAV_GENERAL')} data-section={SECTIONS.GENERAL} role={'button'} aria-current={selected === SECTIONS.GENERAL ? 'true' : undefined} onClick={onSelect}>
                { t('SETTINGS_NAV_GENERAL') }
            </Button>
            {extraSections.map((s) => (
                <Button key={s.id} className={classNames(styles['button'], { [styles['selected']]: selected === s.id })} title={s.label} data-section={s.id} role={'button'} aria-current={selected === s.id ? 'true' : undefined} onClick={onSelect}>
                    {s.label}
                </Button>
            ))}
            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.INTERFACE })} title={t('INTERFACE')} data-section={SECTIONS.INTERFACE} role={'button'} aria-current={selected === SECTIONS.INTERFACE ? 'true' : undefined} onClick={onSelect}>
                { t('INTERFACE') }
            </Button>
            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.PLAYER })} title={t('SETTINGS_NAV_PLAYER')} data-section={SECTIONS.PLAYER} role={'button'} aria-current={selected === SECTIONS.PLAYER ? 'true' : undefined} onClick={onSelect}>
                { t('SETTINGS_NAV_PLAYER') }
            </Button>
            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.STREAMING })} title={t('SETTINGS_NAV_STREAMING')} data-section={SECTIONS.STREAMING} role={'button'} aria-current={selected === SECTIONS.STREAMING ? 'true' : undefined} onClick={onSelect}>
                { t('SETTINGS_NAV_STREAMING') }
            </Button>
            { !platform.isMobile && <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.SHORTCUTS })} title={t('SETTINGS_NAV_SHORTCUTS')} data-section={SECTIONS.SHORTCUTS} role={'button'} aria-current={selected === SECTIONS.SHORTCUTS ? 'true' : undefined} onClick={onSelect}>
                { t('SETTINGS_NAV_SHORTCUTS') }
            </Button> }

            <div className={styles['spacing']} />
            <div className={styles['version-info-label']} title={process.env.VERSION}>
                {t('SETTINGS_APP_VERSION')}: {process.env.VERSION}
            </div>
            <div className={styles['version-info-label']} title={process.env.COMMIT_HASH}>
                {t('SETTINGS_BUILD_VERSION')}: {process.env.COMMIT_HASH}
            </div>
            {
                settings?.serverVersion &&
                    <div className={styles['version-info-label']} title={settings.serverVersion}>
                        {t('SETTINGS_SERVER_VERSION')}: {settings.serverVersion}
                    </div>
            }
            {
                typeof shell.state.version === 'string' &&
                    <div className={styles['version-info-label']} title={shell.state.version}>
                        {t('SETTINGS_SHELL_VERSION')}: {shell.state.version}
                    </div>
            }
        </div>
    );
};

export default Menu;
