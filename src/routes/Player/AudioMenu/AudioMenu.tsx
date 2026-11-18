import React, { forwardRef, memo, MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { languages } from 'stremio/common';
import { Button } from 'stremio/components';
import styles from './AudioMenu.less';

type Props = {
    className: string,
    selectedAudioTrackId: string | null,
    audioTracks: AudioTrack[],
    onAudioTrackSelected: (id: string) => void,
};

const AudioMenu = memo(forwardRef<HTMLDivElement, Props>(({ className, selectedAudioTrackId, audioTracks, onAudioTrackSelected }: Props, ref) => {
    const { t } = useTranslation();

    const onAudioTrackClick = useCallback(({ currentTarget }: MouseEvent) => {
        const id = currentTarget.getAttribute('data-id')!;
        onAudioTrackSelected && onAudioTrackSelected(id);
    }, [onAudioTrackSelected]);

    const onMouseDown = (event: MouseEvent) => {
        // @ts-expect-error: Property 'audioMenuClosePrevented' does not exist on type 'MouseEvent'.
        event.nativeEvent.audioMenuClosePrevented = true;
    };

    return (
        <div ref={ref} className={classNames(className, styles['audio-menu'])} onMouseDown={onMouseDown}>
            <div className={styles['container']}>
                <div className={styles['header']}>
                    { t('AUDIO_TRACKS') }
                </div>
                <div className={styles['list']}>
                    {
                        audioTracks.map(({ id, label, lang }, index) => {
                            const langLabel = languages.label(lang) || lang;
                            // Same language twice and nothing to tell them apart: number them within the language
                            const sameLanguage = audioTracks.filter((track) => track.lang === lang);
                            const displayLabel = label && label !== lang && label !== langLabel
                                ? label
                                : (sameLanguage.length > 1 ? `Audio ${audioTracks.slice(0, index).filter((track) => track.lang === lang).length + 1}` : '');
                            return (
                                <Button
                                    key={index}
                                    title={displayLabel ? `${langLabel} · ${displayLabel}` : langLabel}
                                    className={classNames(styles['option'], { 'selected': selectedAudioTrackId === id })}
                                    data-id={id}
                                    onClick={onAudioTrackClick}
                                >
                                    <div className={styles['info']}>
                                        <div className={styles['lang']}>
                                            {langLabel}
                                        </div>
                                        {displayLabel ? (
                                            <div className={styles['label']}>
                                                {displayLabel}
                                            </div>
                                        ) : null}
                                    </div>
                                    {
                                        selectedAudioTrackId === id ?
                                            <div className={styles['icon']} />
                                            :
                                            null
                                    }
                                </Button>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}));

export default AudioMenu;
