import React from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { usePlatform } from 'stremio/common';
import { Button } from 'stremio/components';
import { SECTIONS } from '../constants';
import styles from './Menu.less';

type Props = {
    selected: string,
    extraSections?: { id: string, label: string }[],
    onSelect: (event: React.MouseEvent<HTMLDivElement>) => void,
};

const Menu = ({ selected, extraSections = [], onSelect }: Props) => {
    const { t } = useTranslation();
    const platform = usePlatform();

    return (
        // HomeBot: role/aria-current so VoiceOver and keyboard users can find and follow the section links
        <div className={styles['menu']}>
            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.GENERAL })} title={t('ACCOUNT', 'Account')} data-section={SECTIONS.GENERAL} role={'button'} aria-current={selected === SECTIONS.GENERAL ? 'true' : undefined} onClick={onSelect}>
                {t('ACCOUNT', 'Account')}
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

            <Button className={classNames(styles['button'], { [styles['selected']]: selected === SECTIONS.ABOUT })} title={t('ABOUT', 'About')} data-section={SECTIONS.ABOUT} role={'button'} aria-current={selected === SECTIONS.ABOUT ? 'true' : undefined} onClick={onSelect}>
                {t('ABOUT', 'About')}
            </Button>
        </div>
    );
};

export default Menu;
