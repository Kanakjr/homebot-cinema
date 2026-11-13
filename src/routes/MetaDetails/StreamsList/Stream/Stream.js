// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { t } = require('i18next');
const { useCore } = require('stremio/core');
const { useProfile, usePlatform, useToast, useBinaryState } = require('stremio/common');
const { Button, Image, Popup } = require('stremio/components');
const ActionButton = require('stremio/components/MetaPreview/ActionButton');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const StreamPlaceholder = require('./StreamPlaceholder');
const { parseStream } = require('../streamParser');
const styles = require('./styles');

const Stream = ({ className = '', compact = false, isEpg = false, videoId = undefined, videoReleased = undefined, addonName, name, description, title, thumbnail = undefined, progress, deepLinks, externalPlayerCallbackCanMarkWatched, match = undefined, swarm = undefined, ...props }) => {
    const profile = useProfile();
    const toast = useToast();
    const platform = usePlatform();
    const core = useCore();
    const routeFocused = useRouteFocused();

    const [menuOpen, openMenu, closeMenu, toggleMenu] = useBinaryState(false);

    const popupLabelOnMouseUp = React.useCallback((event) => {
        if (!event.nativeEvent.togglePopupPrevented) {
            if (event.nativeEvent.ctrlKey || event.nativeEvent.button === 2) {
                event.preventDefault();
                openMenu();
            }
        }
    }, [openMenu]);
    const popupLabelOnContextMenu = React.useCallback((event) => {
        if (!event.nativeEvent.togglePopupPrevented && !event.nativeEvent.ctrlKey && !event.nativeEvent.shiftKey) {
            event.preventDefault();
        }
    }, [toggleMenu]);
    const popupLabelOnLongPress = React.useCallback((event) => {
        if (event.nativeEvent.pointerType !== 'mouse' && !event.nativeEvent.togglePopupPrevented) {
            toggleMenu();
        }
    }, [toggleMenu]);
    const popupMenuOnPointerDown = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
    }, []);
    const popupMenuOnContextMenu = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
        if (!event.nativeEvent.ctrlKey && !event.nativeEvent.shiftKey) {
            event.preventDefault();
        }
    }, []);
    const popupMenuOnClick = React.useCallback((event) => {
        event.nativeEvent.togglePopupPrevented = true;
    }, []);
    const popupMenuOnKeyDown = React.useCallback((event) => {
        event.nativeEvent.buttonClickPrevented = true;
    }, []);

    const href = React.useMemo(() => {
        return deepLinks ?
            deepLinks.externalPlayer ?
                deepLinks.externalPlayer.web ?
                    deepLinks.externalPlayer.web
                    :
                    deepLinks.externalPlayer.openPlayer ?
                        deepLinks.externalPlayer.openPlayer[platform.name] ?
                            deepLinks.externalPlayer.openPlayer[platform.name]
                            :
                            deepLinks.externalPlayer.playlist
                        :
                        deepLinks.player
                :
                deepLinks.player
            :
            null;
    }, [deepLinks]);

    const download = React.useMemo(() => {
        return href === deepLinks?.externalPlayer?.playlist ?
            deepLinks.externalPlayer.fileName
            :
            null;
    }, [href, deepLinks]);

    const target = React.useMemo(() => {
        return href === deepLinks?.externalPlayer?.web ?
            '_blank'
            :
            null;
    }, [href, deepLinks]);

    const streamLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.streaming;
    }, [deepLinks]);

    const downloadLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.download;
    }, [deepLinks]);

    const magnetLink = React.useMemo(() => {
        return deepLinks?.externalPlayer?.magnet;
    }, [deepLinks]);

    const markVideoAsWatched = React.useCallback(() => {
        if (typeof videoId === 'string') {
            core.transport.dispatch({
                action: 'MetaDetails',
                args: {
                    action: 'MarkVideoAsWatched',
                    args: [{ id: videoId, released: videoReleased }, true]
                }
            });
        }
    }, [videoId, videoReleased]);

    const onClick = React.useCallback((event) => {
        if (event.nativeEvent.togglePopupPrevented) {
            return;
        }

        if (isEpg) closeMenu();

        if (profile.settings.playerType !== null) {
            if (profile.settings.playerType !== 'infuse' || !platform.shell.active || !externalPlayerCallbackCanMarkWatched) {
                markVideoAsWatched();
            }
            toast.show({
                type: 'success',
                title: 'Stream opened in external player',
                timeout: 4000
            });
        }

        if (typeof props.onClick === 'function') {
            props.onClick(event);
        }
    }, [props.onClick, profile.settings.playerType, platform.shell.active, externalPlayerCallbackCanMarkWatched, markVideoAsWatched, isEpg, closeMenu]);

    const copyMagnetLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (magnetLink) {
            navigator.clipboard.writeText(magnetLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_MAGNET_LINK_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_MAGNET_LINK_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [magnetLink]);

    const copyDownloadLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (downloadLink) {
            navigator.clipboard.writeText(downloadLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_DOWNLOAD_LINK_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_DOWNLOAD_LINK_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [downloadLink]);

    const downloadToServer = React.useCallback(async (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        const targetUrl = magnetLink || downloadLink || streamLink;
        if (!targetUrl) {
            toast.show({ type: 'error', title: 'No download link found for this stream', timeout: 4000 });
            return;
        }
        try {
            toast.show({ type: 'success', title: 'Sending download to HomeServer…', timeout: 3000 });
            const titleLine = (description && description.split('\n')[0]) || name || addonName || 'Media';
            const res = await fetch('/api/downloads/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    magnet: targetUrl,
                    mediaId: videoId,
                    title: titleLine,
                    type: videoId ? 'series' : 'movie'
                })
            }).then((r) => r.json());
            if (res && res.success) {
                toast.show({ type: 'success', title: '⚡ Queued in HomeServer Transmission!', timeout: 4000 });
            } else {
                toast.show({ type: 'error', title: `Failed: ${res?.error || 'Unknown'}`, timeout: 4000 });
            }
        } catch (e) {
            toast.show({ type: 'error', title: `Error: ${e.message}`, timeout: 4000 });
        }
    }, [magnetLink, downloadLink, streamLink, description, name, addonName, videoId, toast, closeMenu]);

    const copyStreamLink = React.useCallback((event) => {
        event.preventDefault();
        closeMenu();
        if (streamLink) {
            navigator.clipboard.writeText(streamLink)
                .then(() => {
                    toast.show({
                        type: 'success',
                        title: t('PLAYER_COPY_STREAM_SUCCESS'),
                        timeout: 4000
                    });
                })
                .catch(() => {
                    toast.show({
                        type: 'error',
                        title: t('PLAYER_COPY_STREAM_ERROR'),
                        timeout: 4000,
                    });
                });
        }
    }, [streamLink]);

    const renderThumbnailFallback = React.useCallback(() => (
        <Icon className={styles['placeholder-icon']} name={'ic_broken_link'} />
    ), []);

    const renderLabel = React.useMemo(() => function renderLabel({ className, children, ...props }) {
        if (compact) {
            return <ActionButton className={classnames(className, styles['stream-action'])} icon={'play'} label={name || addonName} variant={'wide'} href={href} target={target} download={download} onClick={onClick} {...props}>
                {children}
            </ActionButton>;
        }

        const parsed = parseStream({ name, description, title, addonName });
        const titleLine = (description && description.split('\n')[0]) || (title && title.split('\n')[0]) || name || addonName;
        const chips = parsed ? [
            match && match.best && { text: 'Best match', tone: 'best' },
            parsed.resolution && { text: parsed.resolution, tone: parsed.resolution === '4K' ? 'hi' : '' },
            parsed.hdr && { text: parsed.hdr, tone: 'hdr' },
            parsed.quality && { text: parsed.quality, tone: '' },
            parsed.codec && { text: parsed.codec, tone: '' },
            parsed.audio && { text: parsed.audio, tone: '' },
        ].filter(Boolean) : [];
        const seedTone = parsed && typeof parsed.seeders === 'number' ? (parsed.seeders > 50 ? 'high' : parsed.seeders > 15 ? 'med' : 'low') : null;

        return (
            <Button className={classnames(className, styles['card'], { [styles['card-active']]: menuOpen, [styles['card-dim']]: match && !match.accepted, [styles['card-best']]: match && match.best, [styles['card-dead']]: swarm && swarm.state === 'dead' })} title={match && !match.accepted ? `Not for this profile: ${match.reasons.join('; ')}` : addonName} href={href} target={target} download={download} onClick={onClick} {...props}>
                {
                    typeof thumbnail === 'string' && thumbnail.length > 0 ?
                        <div className={styles['card-thumb']} title={name || addonName}>
                            <Image className={styles['card-thumb-img']} src={thumbnail} alt={' '} renderFallback={renderThumbnailFallback} />
                        </div>
                        :
                        null
                }
                <div className={styles['card-main']} title={description || title}>
                    {chips.length > 0 ?
                        <div className={styles['card-chips']}>
                            {chips.map((c) => <span key={c.text} className={classnames(styles['chip'], c.tone && styles[`chip-${c.tone}`])}>{c.text}</span>)}
                        </div>
                        :
                        null}
                    <div className={styles['card-title']}>{titleLine}</div>
                    <div className={styles['card-meta']}>
                        {parsed && parsed.sizeLabel ? <span>{parsed.sizeLabel}</span> : null}
                        {seedTone ?
                            <span className={styles['seeds']} title={`${parsed.seeders} seeders${typeof parsed.leechers === 'number' ? ` / ${parsed.leechers} leechers` : ''}`}>
                                <i className={classnames(styles['seed-dot'], styles[`seed-${seedTone}`])} />{parsed.seeders} seeders
                            </span>
                            :
                            null}
                        {swarm ?
                            <span
                                className={classnames(styles['swarm'], styles[`swarm-${swarm.state}`])}
                                title={swarm.state === 'dead' ? `No peer is sending data right now (${swarm.peers ?? '?'} peers, ${swarm.unchoked ?? 0} unchoked). It would sit on the loading screen.`
                                    : swarm.state === 'checking' ? 'Checking whether peers are actually sending data…'
                                        : `First ${Math.round((swarm.bytes || 0) / 1024)} KB in ${((swarm.ms || 0) / 1000).toFixed(1)} s`}
                            >
                                <i className={styles['swarm-dot']} />
                                {swarm.state === 'checking' ? 'Checking peers…' : swarm.state === 'good' ? 'Peers ready' : swarm.state === 'slow' ? 'Slow peers' : 'No peers'}
                            </span>
                            : null}
                        {addonName ? <span className={styles['source']}>{addonName}</span> : null}
                    </div>
                    {progress !== null && !isNaN(progress) && progress > 0 ?
                        <div className={styles['card-progress']}><div className={styles['card-progress-fill']} style={{ width: `${progress}%` }} /></div>
                        :
                        null}
                </div>
                <div className={styles['card-actions']}>
                    <span role="button" className={styles['card-save']} title="Save to HomeServer" aria-label="Save to HomeServer" onClick={downloadToServer}>
                        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M10 3v9.5M6 9l4 4 4-4M4 16.5h12" />
                        </svg>
                    </span>
                    <span className={styles['card-play']}>
                        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 001.2.7l10-6.2a.8.8 0 000-1.4l-10-6.2A.8.8 0 006 3.8z" /></svg>
                        Play
                    </span>
                </div>
                {children}
            </Button>
        );
    }, [compact, thumbnail, progress, addonName, name, description, href, target, download, onClick, menuOpen, downloadToServer, match, swarm]);

    const renderMenu = React.useMemo(() => function renderMenu() {
        return (
            <div className={styles['context-menu-content']} onPointerDown={popupMenuOnPointerDown} onContextMenu={popupMenuOnContextMenu} onClick={popupMenuOnClick} onKeyDown={popupMenuOnKeyDown}>
                <div className={styles['context-menu-title']}>
                    {description}
                </div>
                <Button className={styles['context-menu-option-container']} title={t('CTX_PLAY')} href={isEpg ? href : undefined} target={isEpg ? target : undefined} download={isEpg ? download : undefined} onClick={isEpg ? onClick : undefined}>
                    <Icon className={styles['menu-icon']} name={'play'} />
                    <div className={styles['context-menu-option-label']}>{t('CTX_PLAY')}</div>
                </Button>
                {
                    !isEpg && (magnetLink || downloadLink || streamLink) &&
                        <Button className={styles['context-menu-option-container']} title="Download to HomeServer" onClick={downloadToServer}>
                            <Icon className={styles['menu-icon']} name={'download'} />
                            <div className={styles['context-menu-option-label']}>⬇️ Download to HomeServer SSD</div>
                        </Button>
                }
                {
                    streamLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_COPY_STREAM_LINK')} onClick={copyStreamLink}>
                            <Icon className={styles['menu-icon']} name={'link'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_STREAM_LINK')}</div>
                        </Button>
                }
                {
                    !isEpg && magnetLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_COPY_MAGNET_LINK')} onClick={copyMagnetLink}>
                            <Icon className={styles['menu-icon']} name={'magnet-link'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_MAGNET_LINK')}</div>
                        </Button>
                }
                {
                    !isEpg && downloadLink &&
                        <Button className={styles['context-menu-option-container']} title={t('CTX_DOWNLOAD_VIDEO')} onClick={copyDownloadLink}>
                            <Icon className={styles['menu-icon']} name={'download'} />
                            <div className={styles['context-menu-option-label']}>{t('CTX_COPY_VIDEO_DOWNLOAD_LINK')}</div>
                        </Button>
                }
            </div>
        );
    }, [copyStreamLink, copyMagnetLink, copyDownloadLink, downloadToServer, onClick, isEpg, href, target, download, magnetLink, downloadLink, streamLink]);

    React.useEffect(() => {
        if (!routeFocused) {
            closeMenu();
        }
    }, [routeFocused]);

    return (
        <Popup
            className={className}
            onMouseUp={popupLabelOnMouseUp}
            onLongPress={popupLabelOnLongPress}
            onContextMenu={popupLabelOnContextMenu}
            open={menuOpen}
            portal={isEpg}
            menuClassName={isEpg ? styles['epg-menu'] : undefined}
            onCloseRequest={closeMenu}
            renderLabel={renderLabel}
            renderMenu={renderMenu}
        />
    );
};

Stream.Placeholder = StreamPlaceholder;

Stream.propTypes = {
    className: PropTypes.string,
    compact: PropTypes.bool,
    isEpg: PropTypes.bool,
    videoId: PropTypes.string,
    videoReleased: PropTypes.instanceOf(Date),
    addonName: PropTypes.string,
    name: PropTypes.string,
    description: PropTypes.string,
    title: PropTypes.string,
    thumbnail: PropTypes.string,
    progress: PropTypes.number,
    deepLinks: PropTypes.shape({
        player: PropTypes.string,
        externalPlayer: PropTypes.shape({
            download: PropTypes.string,
            magnet: PropTypes.string,
            streaming: PropTypes.string,
            playlist: PropTypes.string,
            fileName: PropTypes.string,
            web: PropTypes.string,
            openPlayer: PropTypes.shape({
                ios: PropTypes.string,
                android: PropTypes.string,
                windows: PropTypes.string,
                macos: PropTypes.string,
                linux: PropTypes.string,
            })
        })
    }),
    externalPlayerCallbackCanMarkWatched: PropTypes.bool,
    match: PropTypes.shape({ accepted: PropTypes.bool, best: PropTypes.bool, reasons: PropTypes.array }),
    swarm: PropTypes.shape({ state: PropTypes.string, ms: PropTypes.number, bytes: PropTypes.number, peers: PropTypes.number, unchoked: PropTypes.number }),
    onClick: PropTypes.func
};

module.exports = Stream;
