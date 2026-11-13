// Copyright (C) 2017-2026 HomeBot Cinema
// Landscape "Continue watching" card (backdrop, S/E label, progress bar, dismiss).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { default: getMetaDetailsHref } = require('stremio/common/getMetaDetailsHref');
const styles = require('./styles');

const episodeLabel = (deepLinks) => {
    const link = (deepLinks && (deepLinks.metaDetailsStreams || deepLinks.player)) || '';
    try {
        const decoded = decodeURIComponent(link);
        const m = /:(\d+):(\d+)(?:[/?#]|$)/.exec(decoded);
        return m ? `S${m[1]} E${m[2]}` : null;
    } catch (_) {
        return null;
    }
};

const ContinueWatchingCard = ({ className, _id, type, name, poster, progress, deepLinks }) => {
    const core = useCore();
    const [bgFailed, setBgFailed] = React.useState(false);
    const playerHref = deepLinks && typeof deepLinks.player === 'string' ? deepLinks.player : null;
    const detailsHref = getMetaDetailsHref(deepLinks);
    const href = playerHref || detailsHref;
    const backdrop = !bgFailed && /^tt\d+/.test(_id || '') ? `https://images.metahub.space/background/medium/${_id}/img` : poster;
    const pct = Math.max(0, Math.min(100, Math.round(progress || 0))); // core reports progress as a percentage
    const ep = type === 'series' ? episodeLabel(deepLinks) : null;

    const onDismiss = React.useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof _id === 'string') {
            core.transport.dispatch({ action: 'Ctx', args: { action: 'RewindLibraryItem', args: _id } });
        }
    }, [_id, core]);

    return (
        <a className={classnames(className, styles['card'])} href={href || undefined} title={name}>
            <img className={styles['art']} src={backdrop} alt="" onError={() => setBgFailed(true)} loading="lazy" />
            <div className={styles['shade']} />
            {pct > 0 && pct < 100 ? <div className={styles['pill']}>{pct}% watched</div> : null}
            <button type="button" className={styles['dismiss']} title="Remove from Continue watching" onClick={onDismiss}>×</button>
            <div className={styles['info']}>
                {ep ? <div className={styles['ep']}>{ep}</div> : null}
                <div className={styles['name']}>{name}</div>
            </div>
            <div className={styles['bar']}><div className={styles['fill']} style={{ width: `${pct}%` }} /></div>
        </a>
    );
};

ContinueWatchingCard.propTypes = {
    className: PropTypes.string,
    _id: PropTypes.string,
    type: PropTypes.string,
    name: PropTypes.string,
    poster: PropTypes.string,
    progress: PropTypes.number,
    deepLinks: PropTypes.object
};

module.exports = ContinueWatchingCard;
