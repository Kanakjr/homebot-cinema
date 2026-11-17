// Copyright (C) 2017-2026 HomeBot Cinema
// Context menu for movie & series posters and cards (Instant Play, Library, Watched, Details, Link)

const React = require('react');
const ReactDOM = require('react-dom');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { useNavigateWithOrigin } = require('stremio-router');
const { default: Icon } = require('@stremio/stremio-icons/react');
const { getInterfaceScale } = require('stremio/common/interfaceScale');
const usePlayResolve = require('stremio/common/usePlayResolve');
const styles = require('./styles');

function getLibraryState(id) {
    if (!id) return { inLibrary: false, watched: false };
    const rootId = (/tt\d+/.exec(id) || [])[0] || id;
    try {
        const checkBucket = (raw) => {
            if (!raw) return null;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const items = parsed && parsed.items && typeof parsed.items === 'object' ? parsed.items : null;
            if (!items) return null;
            return items[id] || items[rootId] || items[id.toLowerCase()] || items[rootId.toLowerCase()] || null;
        };

        const keysToCheck = ['library'];
        if (typeof window !== 'undefined' && window.ssoScope) {
            keysToCheck.unshift(`library:${window.ssoScope}`);
        }
        if (typeof localStorage !== 'undefined') {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('library') && !k.startsWith('library_recent') && !keysToCheck.includes(k)) {
                    keysToCheck.push(k);
                }
            }
        }

        let foundItem = null;
        for (const k of keysToCheck) {
            try {
                const raw = localStorage.getItem(k);
                const match = checkBucket(raw);
                if (match) {
                    foundItem = match;
                    break;
                }
            } catch (_) {
                // ignore item read error
            }
        }

        if (foundItem) {
            const isRemoved = Boolean(foundItem.removed);
            const isTemp = Boolean(foundItem.temp);
            const inLib = !isRemoved && !isTemp;
            const st = foundItem.state || {};
            const isWatched = Boolean(st.flaggedWatched > 0 || st.timesWatched > 0 || (st.duration > 0 && st.timeOffset / st.duration >= 0.9));
            return { inLibrary: inLib, watched: isWatched };
        }

        const recentKeys = ['library_recent'];
        if (typeof window !== 'undefined' && window.ssoScope) {
            recentKeys.unshift(`library_recent:${window.ssoScope}`);
        }
        for (const k of recentKeys) {
            try {
                const raw = localStorage.getItem(k);
                const match = checkBucket(raw);
                if (match) {
                    const st = match.state || {};
                    const isWatched = Boolean(st.flaggedWatched > 0 || st.timesWatched > 0 || (st.duration > 0 && st.timeOffset / st.duration >= 0.9));
                    return { inLibrary: false, watched: isWatched };
                }
            } catch (_) {
                // ignore item read error
            }
        }
    } catch (_) {
        // ignore storage parse errors
    }
    return { inLibrary: false, watched: false };
}

function resolvePoster(item) {
    const rawPoster = typeof item.poster === 'string' ? item.poster : (item.poster && item.poster.src ? item.poster.src : null);
    if (rawPoster && !rawPoster.includes('/background/')) {
        return rawPoster;
    }
    const id = item.id || item._id;
    if (id && /^tt\d+/.test(id)) {
        return `https://images.metahub.space/poster/medium/${id}/img`;
    }
    return rawPoster;
}

const MetaContextMenu = ({ position, onClose, item }) => {
    const core = useCore();
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const { play, resolving } = usePlayResolve();
    const [copied, setCopied] = React.useState(false);
    const [menuSize, setMenuSize] = React.useState([230, 240]);

    const initialLib = React.useMemo(() => getLibraryState(item.id), [item.id]);
    const initialInLib = Boolean(item.inLibrary || initialLib.inLibrary);
    const initialWatched = Boolean(item.watched !== undefined ? item.watched : initialLib.watched);
    const [inLibrary, setInLibrary] = React.useState(initialInLib);
    const [watched, setWatched] = React.useState(initialWatched);

    const menuRef = React.useCallback((node) => {
        if (node) {
            setMenuSize([node.offsetWidth, node.offsetHeight]);
        }
    }, []);

    const style = React.useMemo(() => {
        const scale = getInterfaceScale() || 1;
        const [clientX, clientY] = position;
        const x = clientX / scale;
        const y = clientY / scale;
        const vw = window.innerWidth / scale;
        const vh = window.innerHeight / scale;
        const PADDING = 10;
        const [w, h] = menuSize;

        const left = Math.max(
            PADDING,
            Math.min(
                x + w > vw - PADDING ? x - w : x,
                vw - w - PADDING
            )
        );

        const top = Math.max(
            PADDING,
            Math.min(
                y + h > vh - PADDING ? y - h : y,
                vh - h - PADDING
            )
        );

        return { left: `${left}px`, top: `${top}px` };
    }, [position, menuSize]);

    React.useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        const handleResize = () => onClose();

        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleResize);
        };
    }, [onClose]);

    const onInstantPlay = React.useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        await play({
            id: item.id,
            type: item.type,
            videoId: item.videoId,
            season: item.season,
            episode: item.episode,
            fallbackHref: item.href,
        });
    }, [item, onClose, play]);

    const onToggleLibrary = React.useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inLibrary) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'RemoveFromLibrary',
                    args: item.id,
                }
            });
            setInLibrary(false);
        } else {
            const posterUrl = resolvePoster(item);
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'AddToLibrary',
                    args: {
                        id: item.id,
                        type: item.type,
                        name: item.name,
                        poster: posterUrl,
                        posterShape: 'poster',
                    }
                }
            });
            setInLibrary(true);
        }
        onClose();
    }, [core, inLibrary, item, onClose]);

    const onToggleWatched = React.useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        const nextWatched = !watched;
        const posterUrl = resolvePoster(item);
        core.transport.dispatch({
            action: 'Ctx',
            args: {
                action: 'MetaItemMarkAsWatched',
                args: {
                    meta_item: {
                        id: item.id,
                        type: item.type,
                        name: item.name,
                        poster: posterUrl,
                        posterShape: 'poster',
                    },
                    is_watched: nextWatched,
                }
            }
        });
        setWatched(nextWatched);
        onClose();
    }, [core, item, onClose, watched]);

    const onViewDetails = React.useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        if (item.href) {
            navigateWithOrigin(item.href);
        }
    }, [item.href, navigateWithOrigin, onClose]);

    const onCopyLink = React.useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            const targetHref = item.href || `#/detail/${encodeURIComponent(item.type || 'movie')}/${encodeURIComponent(item.id)}`;
            const fullUrl = `${window.location.origin}${window.location.pathname}${targetHref}`;
            await navigator.clipboard.writeText(fullUrl);
            setCopied(true);
            setTimeout(() => {
                onClose();
            }, 800);
        } catch (_) {
            onClose();
        }
    }, [item, onClose]);

    const onDismiss = React.useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        if (typeof item.onDismissClick === 'function') {
            item.onDismissClick(e);
        }
    }, [item, onClose]);

    return ReactDOM.createPortal(
        <div
            className={styles['overlay']}
            onMouseDown={(e) => {
                if (e.button !== 2) onClose();
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                ref={menuRef}
                className={styles['menu']}
                style={style}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                {item.name ? (
                    <div className={styles['header']}>
                        <div className={styles['title']} title={item.name}>{item.name}</div>
                        {item.type ? <div className={styles['badge']}>{item.type}</div> : null}
                    </div>
                ) : null}
                <div className={styles['divider']} />

                {/* Instant Play */}
                <button type="button" className={classnames(styles['item'], styles['primary'])} onClick={onInstantPlay}>
                    <Icon className={styles['icon']} name={'play'} />
                    <span className={styles['label']}>{resolving ? 'Resolving...' : 'Instant Play'}</span>
                </button>

                {/* Add / Remove from Library (only for catalog/library VOD cards) */}
                {!item.hideLibraryAction ? (
                    <button type="button" className={styles['item']} onClick={onToggleLibrary}>
                        <Icon className={styles['icon']} name={inLibrary ? 'remove' : 'add'} />
                        <span className={styles['label']}>{inLibrary ? 'Remove from Library' : 'Add to Library'}</span>
                    </button>
                ) : null}

                {/* Mark as Watched / Unwatched */}
                <button type="button" className={styles['item']} onClick={onToggleWatched}>
                    <Icon className={styles['icon']} name={'eye'} />
                    <span className={styles['label']}>{watched ? 'Mark as Unwatched' : 'Mark as Watched'}</span>
                </button>

                <div className={styles['divider']} />

                {/* View Details */}
                <button type="button" className={styles['item']} onClick={onViewDetails}>
                    <Icon className={styles['icon']} name={'details'} />
                    <span className={styles['label']}>View Details</span>
                </button>

                {/* Copy Link */}
                <button type="button" className={styles['item']} onClick={onCopyLink}>
                    <Icon className={styles['icon']} name={copied ? 'checkmark' : 'link'} />
                    <span className={styles['label']}>{copied ? 'Link Copied!' : 'Copy Link'}</span>
                </button>

                {/* Dismiss (for Continue Watching cards) */}
                {typeof item.onDismissClick === 'function' ? (
                    <React.Fragment>
                        <div className={styles['divider']} />
                        <button type="button" className={classnames(styles['item'], styles['danger'])} onClick={onDismiss}>
                            <Icon className={styles['icon']} name={'close'} />
                            <span className={styles['label']}>Dismiss from Continue Watching</span>
                        </button>
                    </React.Fragment>
                ) : null}
            </div>
        </div>,
        document.body
    );
};

MetaContextMenu.propTypes = {
    position: PropTypes.arrayOf(PropTypes.number).isRequired,
    onClose: PropTypes.func.isRequired,
    item: PropTypes.shape({
        id: PropTypes.string,
        type: PropTypes.string,
        name: PropTypes.string,
        poster: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
        posterShape: PropTypes.string,
        videoId: PropTypes.string,
        season: PropTypes.number,
        episode: PropTypes.number,
        href: PropTypes.string,
        deepLinks: PropTypes.object,
        inLibrary: PropTypes.bool,
        watched: PropTypes.bool,
        hideLibraryAction: PropTypes.bool,
        onDismissClick: PropTypes.func,
    }).isRequired,
};

module.exports = MetaContextMenu;
