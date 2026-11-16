// Copyright (C) 2017-2026 HomeBot Cinema
// Landscape "Continue watching" card (backdrop, S/E label, time left, progress bar, dismiss). With `upNext` from
// /api/upnext/continue it shows the episode after the furthest one watched ("Next up") once the last one is finished.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { default: getMetaDetailsHref } = require('stremio/common/getMetaDetailsHref');
const { timeLeft, airLabel } = require('stremio/common/whenLabels');
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

const ContinueWatchingCard = ({ className, _id, type, name, poster, progress, deepLinks, upNext }) => {
    const core = useCore();
    const [bgFailed, setBgFailed] = React.useState(false);
    const playerHref = deepLinks && typeof deepLinks.player === 'string' ? deepLinks.player : null;
    const detailsHref = getMetaDetailsHref(deepLinks);
    const backdrop = !bgFailed && /^tt\d+/.test(_id || '') ? `https://images.metahub.space/background/medium/${_id}/img` : poster;
    // next up: the episode after the furthest one watched (aired, or with its air date when it has not aired yet)
    const nextUp = upNext && (upNext.mode === 'next' || upNext.mode === 'upcoming') && upNext.next ? upNext.next : null;
    const href = nextUp ? `#/detail/series/${encodeURIComponent(_id)}/${encodeURIComponent(nextUp.id)}` : (playerHref || detailsHref);
    const pct = nextUp ? 0 : Math.max(0, Math.min(100, Math.round(progress || 0))); // core reports progress as a percentage
    const ep = nextUp ? `Next up · S${nextUp.season} E${nextUp.episode}` : (type === 'series' ? episodeLabel(deepLinks) : null);
    const left = upNext && upNext.mode === 'resume' ? timeLeft(upNext.remainingMs) : null;
    const pill = nextUp ? (upNext.mode === 'upcoming' ? (airLabel(nextUp.released) ? `Airs ${airLabel(nextUp.released)}` : 'Not aired yet') : 'New episode')
        : left || (pct > 0 && pct < 100 ? `${pct}% watched` : null);

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
            {pill ? <div className={classnames(styles['pill'], { [styles['pill-accent']]: !!nextUp })}>{pill}</div> : null}
            <button type="button" className={styles['dismiss']} title="Remove from Continue watching" onClick={onDismiss}>×</button>
            <div className={styles['info']}>
                {ep ? <div className={styles['ep']}>{ep}</div> : null}
                <div className={styles['name']}>{name}</div>
            </div>
            {pct > 0 ? <div className={styles['bar']}><div className={styles['fill']} style={{ width: `${pct}%` }} /></div> : null}
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
    deepLinks: PropTypes.object,
    upNext: PropTypes.shape({ mode: PropTypes.string, remainingMs: PropTypes.number, next: PropTypes.object })
};

module.exports = ContinueWatchingCard;
