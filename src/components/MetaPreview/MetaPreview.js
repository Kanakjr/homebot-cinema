// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const UrlUtils = require('url');
const { useTranslation } = require('react-i18next');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { default: Button } = require('stremio/components/Button');
const { default: Image } = require('stremio/components/Image');
const { default: ActionsGroup } = require('stremio/components/ActionsGroup');
const ModalDialog = require('stremio/components/ModalDialog');
const SharePrompt = require('stremio/components/SharePrompt');
const CONSTANTS = require('stremio/common/CONSTANTS');
const { default: useMediaQuery } = require('stremio/common/useMediaQuery');
const screenSizes = require('stremio/common/screen-sizes.less');
const routesRegexp = require('stremio/common/routesRegexp');
const useBinaryState = require('stremio/common/useBinaryState');
const ActionButton = require('./ActionButton');
const MetaLinks = require('./MetaLinks');
const MetaPreviewPlaceholder = require('./MetaPreviewPlaceholder');
const styles = require('./styles');
const { Ratings } = require('./Ratings');
const usePlayResolve = require('stremio/common/usePlayResolve');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');

const ALLOWED_LINK_REDIRECTS = [
    routesRegexp.search.regexp,
    routesRegexp.discover.regexp,
    routesRegexp.metadetails.regexp
];

const MetaPreview = React.forwardRef(({ className, compact, name, type, metaId, videoId, logo, background, runtime, releaseInfo, released, description, deepLinks, links, trailerStreams, inLibrary, toggleInLibrary, watched, toggleWatched, ratingInfo, metadata, children, actions, showIcon = 'play', onShowClick }, ref) => {
    const { t } = useTranslation();
    const [shareModalOpen, openShareModal, closeShareModal] = useBinaryState(false);
    const [playInfo, setPlayInfo] = React.useState(null);
    const [expandedSummary, setExpandedSummary] = React.useState(false);
    const { play: triggerPlay, resolving: resolvingPlay } = usePlayResolve();

    React.useEffect(() => {
        if (!metaId || !type || compact) return;
        let alive = true;
        const q = new URLSearchParams({ id: metaId, type });
        if (videoId) q.set('videoId', videoId);
        api('GET', `/api/play/resolve?${q.toString()}`, undefined, pm.profileHeaders())
            .then((r) => { if (alive && r) setPlayInfo(r); })
            .catch(() => null);
        return () => { alive = false; };
    }, [metaId, type, videoId, compact]);

    const playLabel = playInfo && playInfo.label ? playInfo.label : (type === 'series' ? 'Play S1E1' : 'Play');
    const isMobileLandscape = useMediaQuery(`(max-width: ${screenSizes.xsmall}) and (max-height: ${screenSizes['phone-landscape-size']}) and (orientation: landscape)`);
    const iconActions = compact && isMobileLandscape;
    const linksGroups = React.useMemo(() => {
        return Array.isArray(links) ?
            links
                .filter((link) => link && typeof link.category === 'string' && typeof link.url === 'string')
                .reduce((linksGroups, { category, name, url }) => {
                    const { protocol, path, pathname, hostname } = UrlUtils.parse(url);
                    if (category === CONSTANTS.IMDB_LINK_CATEGORY) {
                        if (hostname === 'imdb.com') {
                            linksGroups.set(category, {
                                label: name,
                                href: url
                            });
                        }
                    } else if (category === CONSTANTS.SHARE_LINK_CATEGORY) {
                        linksGroups.set(category, {
                            label: name,
                            href: url
                        });
                    } else {
                        if (protocol === 'stremio:') {
                            if (pathname !== null && ALLOWED_LINK_REDIRECTS.some((regexp) => pathname.match(regexp))) {
                                if (!linksGroups.has(category)) {
                                    linksGroups.set(category, []);
                                }
                                linksGroups.get(category).push({
                                    label: name,
                                    href: `#${path}`
                                });
                            }
                        } else if (typeof hostname === 'string' && hostname.length > 0) {
                            if (!linksGroups.has(category)) {
                                linksGroups.set(category, []);
                            }
                            linksGroups.get(category).push({
                                label: name,
                                href: url
                            });
                        }
                    }

                    return linksGroups;
                }, new Map())
            :
            new Map();
    }, [links]);
    const showHref = React.useMemo(() => {
        return deepLinks ?
            typeof deepLinks.player === 'string' ?
                deepLinks.player
                :
                typeof deepLinks.metaDetailsStreams === 'string' ?
                    deepLinks.metaDetailsStreams
                    :
                    typeof deepLinks.metaDetailsVideos === 'string' ?
                        deepLinks.metaDetailsVideos
                        :
                        null
            :
            null;
    }, [deepLinks]);
    const onPrimaryPlay = React.useCallback((event) => {
        event.preventDefault();
        triggerPlay({
            id: metaId,
            type,
            videoId,
            fallbackHref: showHref,
        });
    }, [triggerPlay, metaId, type, videoId, showHref]);
    const trailerHref = React.useMemo(() => {
        if (!Array.isArray(trailerStreams) || trailerStreams.length === 0) {
            return null;
        }

        return trailerStreams[0].deepLinks.player;
    }, [trailerStreams]);
    const renderLogoFallback = React.useCallback(() => (
        <div className={styles['logo-placeholder']}>{name}</div>
    ), [name]);
    // HomeBot: the text title shows until the logo image has loaded (tracked per URL, so switching items never shows a blank frame)
    const [loadedLogo, setLoadedLogo] = React.useState(null);
    const [failedLogo, setFailedLogo] = React.useState(null);
    const hasLogo = typeof logo === 'string' && logo.length > 0;
    const logoReady = hasLogo && loadedLogo === logo;
    const metaItemActions = React.useMemo(() => [
        {
            icon: inLibrary ? 'remove-from-library' : 'add-to-library',
            label: inLibrary ? t('REMOVE_FROM_LIB') : t('ADD_TO_LIB'),
            onClick: typeof toggleInLibrary === 'function' ? toggleInLibrary : null,
        },
        {
            icon: watched ? 'eye-off' : 'eye',
            label: watched ? t('CTX_MARK_UNWATCHED') : t('CTX_MARK_WATCHED'),
            onClick: typeof toggleWatched === 'function' ? toggleWatched : undefined,
        },
    ], [inLibrary, watched, toggleInLibrary, toggleWatched]);
    return (
        <div className={classnames(className, styles['meta-preview-container'], { [styles['compact']]: compact })} ref={ref}>
            {
                typeof background === 'string' && background.length > 0 ?
                    <div className={styles['background-image-layer']}>
                        <Image className={styles['background-image']} src={background} alt={' '} />
                    </div>
                    :
                    null
            }
            <div className={styles['meta-info-container']}>
                {!logoReady ? renderLogoFallback() : null}
                {
                    hasLogo && failedLogo !== logo ?
                        <Image
                            className={classnames(styles['logo'], { [styles['logo-pending']]: !logoReady })}
                            src={logo}
                            alt={' '}
                            title={name}
                            onLoad={() => setLoadedLogo(logo)}
                            onError={() => setFailedLogo(logo)}
                        />
                        :
                        null
                }
                {
                    metadata !== undefined ? metadata : (typeof releaseInfo === 'string' && releaseInfo.length > 0) || (released instanceof Date && !isNaN(released.getTime())) || (typeof runtime === 'string' && runtime.length > 0) || linksGroups.has(CONSTANTS.IMDB_LINK_CATEGORY) ?
                        <div className={styles['runtime-release-info-container']}>
                            {
                                typeof runtime === 'string' && runtime.length > 0 ?
                                    <div className={styles['runtime-label']}>{runtime}</div>
                                    :
                                    null
                            }
                            {
                                typeof releaseInfo === 'string' && releaseInfo.length > 0 ?
                                    <div className={styles['release-info-label']}>{releaseInfo}</div>
                                    :
                                    released instanceof Date && !isNaN(released.getTime()) ?
                                        <div className={styles['release-info-label']}>{released.getFullYear()}</div>
                                        :
                                        null
                            }
                            {
                                linksGroups.has(CONSTANTS.IMDB_LINK_CATEGORY) ?
                                    <Button
                                        className={styles['imdb-button-container']}
                                        title={linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).label}
                                        href={linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).href}
                                        target={'_blank'}
                                        tabIndex={0}
                                    >
                                        <div className={styles['label']}>{linksGroups.get(CONSTANTS.IMDB_LINK_CATEGORY).label}</div>
                                        <Icon className={styles['icon']} name={'imdb'} />
                                    </Button>
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
                {
                    !compact && (metaId || type) ?
                        <div className={styles['primary-action-container']}>
                            <button
                                type="button"
                                className={styles['primary-play-button']}
                                onClick={onPrimaryPlay}
                                disabled={resolvingPlay}
                                aria-label={playLabel}
                            >
                                <svg className={styles['play-icon']} viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                                    <polygon points="5,3 19,12 5,21" />
                                </svg>
                                <span>{resolvingPlay ? 'Loading…' : playLabel}</span>
                            </button>
                        </div>
                        :
                        null
                }
                {
                    !compact ?
                        <div className={styles['action-row-container']}>
                            {
                                typeof trailerHref === 'string' ?
                                    <ActionButton
                                        className={styles['action-button']}
                                        icon={'trailer'}
                                        label={t('TRAILER')}
                                        tabIndex={0}
                                        href={trailerHref}
                                    />
                                    :
                                    null
                            }
                            {
                                typeof toggleInLibrary === 'function' ?
                                    <ActionButton
                                        className={styles['action-button']}
                                        icon={inLibrary ? 'remove-from-library' : 'add-to-library'}
                                        label={inLibrary ? t('REMOVE_FROM_LIB') : t('ADD_TO_LIB')}
                                        tabIndex={0}
                                        onClick={toggleInLibrary}
                                    />
                                    :
                                    null
                            }
                            {
                                typeof toggleWatched === 'function' ?
                                    <ActionButton
                                        className={styles['action-button']}
                                        icon={watched ? 'eye-off' : 'eye'}
                                        label={watched ? t('CTX_MARK_UNWATCHED') : t('CTX_MARK_WATCHED')}
                                        tabIndex={0}
                                        onClick={toggleWatched}
                                    />
                                    :
                                    null
                            }
                            {
                                linksGroups.has(CONSTANTS.SHARE_LINK_CATEGORY) ?
                                    <React.Fragment>
                                        <ActionButton
                                            className={styles['action-button']}
                                            icon={'share'}
                                            label={t('CTX_SHARE')}
                                            tabIndex={0}
                                            onClick={openShareModal}
                                        />
                                        {
                                            shareModalOpen ?
                                                <ModalDialog title={t('CTX_SHARE')} onCloseRequest={closeShareModal}>
                                                    <SharePrompt
                                                        className={styles['share-prompt']}
                                                        url={linksGroups.get(CONSTANTS.SHARE_LINK_CATEGORY).href}
                                                    />
                                                </ModalDialog>
                                                :
                                                null
                                        }
                                    </React.Fragment>
                                    :
                                    null
                            }
                            {
                                ratingInfo !== null ?
                                    <Ratings
                                        ratingInfo={ratingInfo}
                                        className={styles['ratings-group']}
                                    />
                                    :
                                    null
                            }
                        </div>
                        :
                        null
                }
                {
                    compact && typeof description === 'string' && description.length > 0 ?
                        <div className={styles['description-container']}>
                            {description}
                        </div>
                        :
                        null
                }
                {
                    !compact && typeof description === 'string' && description.length > 0 ?
                        <div className={classnames(styles['description-container'], { [styles['expanded']]: expandedSummary })}>
                            <div className={styles['label-container']}>
                                {t('SUMMARY')}
                            </div>
                            <div className={styles['description-text']}>
                                {description}
                            </div>
                            {description.length > 180 ? (
                                <button
                                    type="button"
                                    className={styles['more-toggle']}
                                    onClick={() => setExpandedSummary(!expandedSummary)}
                                >
                                    {expandedSummary ? 'Less' : 'More'}
                                </button>
                            ) : null}
                        </div>
                        :
                        null
                }
                {
                    Array.from(linksGroups.keys())
                        .filter((category) => {
                            return category !== CONSTANTS.IMDB_LINK_CATEGORY &&
                                category !== CONSTANTS.SHARE_LINK_CATEGORY &&
                                category !== CONSTANTS.WRITERS_LINK_CATEGORY;
                        })
                        .map((category, index) => (
                            <MetaLinks
                                key={index}
                                className={styles['meta-links']}
                                label={category}
                                links={linksGroups.get(category)}
                            />
                        ))
                }
                {children}
            </div>
            <div className={styles['action-buttons-container']}>
                {actions !== undefined ? actions : compact ? <>
                    {
                        typeof showHref === 'string' ?
                            <ActionButton
                                className={classnames(styles['action-button'], styles['show-button'])}
                                icon={showIcon}
                                label={t('SHOW')}
                                variant={iconActions ? 'icon' : 'wide'}
                                tooltip={iconActions}
                                tabIndex={0}
                                href={showHref}
                                onClick={onShowClick}
                            />
                            :
                            null
                    }
                    {
                        typeof trailerHref === 'string' ?
                            <ActionButton
                                className={styles['action-button']}
                                icon={'trailer'}
                                label={t('TRAILER')}
                                tabIndex={0}
                                href={trailerHref}
                                tooltip={true}
                            />
                            :
                            null
                    }
                    {
                        typeof toggleInLibrary === 'function' && typeof toggleWatched === 'function'
                            ? <ActionsGroup items={metaItemActions} className={styles['group-container']} />
                            : null
                    }
                </> : null}
            </div>
        </div>
    );
});

MetaPreview.Placeholder = MetaPreviewPlaceholder;

MetaPreview.propTypes = {
    type: PropTypes.string,
    metaId: PropTypes.string,
    videoId: PropTypes.string,
    metadata: PropTypes.node,
    children: PropTypes.node,
    actions: PropTypes.node,
    showIcon: PropTypes.string,
    className: PropTypes.string,
    compact: PropTypes.bool,
    name: PropTypes.string,
    logo: PropTypes.string,
    background: PropTypes.string,
    runtime: PropTypes.string,
    releaseInfo: PropTypes.string,
    released: PropTypes.instanceOf(Date),
    description: PropTypes.string,
    deepLinks: PropTypes.shape({
        metaDetailsVideos: PropTypes.string,
        metaDetailsStreams: PropTypes.string,
        player: PropTypes.string
    }),
    links: PropTypes.arrayOf(PropTypes.shape({
        category: PropTypes.string,
        name: PropTypes.string,
        url: PropTypes.string
    })),
    trailerStreams: PropTypes.array,
    inLibrary: PropTypes.bool,
    toggleInLibrary: PropTypes.func,
    watched: PropTypes.bool,
    toggleWatched: PropTypes.func,
    ratingInfo: PropTypes.object,
    onShowClick: PropTypes.func,
};

module.exports = MetaPreview;
