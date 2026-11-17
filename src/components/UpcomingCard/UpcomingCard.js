// Copyright (C) 2017-2026 HomeBot Cinema
// Landscape card for the home screen's Upcoming row: show, episode and when it airs.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useNavigateWithOrigin } = require('stremio-router');
const { airLabel } = require('stremio/common/whenLabels');
const styles = require('stremio/components/ContinueWatchingCard/styles');

const UpcomingCard = ({ className, metaId, videoId, name, season, episode, title, released, thumbnail, background, poster }) => {
    const { navigateWithOrigin } = useNavigateWithOrigin();
    const [artFailed, setArtFailed] = React.useState(false);
    const art = !artFailed ? (thumbnail || background || (/^tt\d+/.test(metaId || '') ? `https://images.metahub.space/background/medium/${metaId}/img` : poster)) : poster;
    const href = `#/detail/series/${encodeURIComponent(metaId)}/${encodeURIComponent(videoId)}`;
    const when = airLabel(released);

    const onCardClick = React.useCallback((event) => {
        if (
            !event.defaultPrevented &&
            event.button === 0 &&
            !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
            (!event.currentTarget.target || event.currentTarget.target === '_self') &&
            typeof href === 'string'
        ) {
            event.preventDefault();
            navigateWithOrigin(href);
        }
    }, [href, navigateWithOrigin]);

    return (
        <a className={classnames(className, styles['card'])} href={href} title={title ? `${name}: ${title}` : name} onClick={onCardClick}>
            <img className={styles['art']} src={art} alt="" onError={() => setArtFailed(true)} loading="lazy" />
            <div className={styles['shade']} />
            {when ? <div className={classnames(styles['pill'], styles['pill-accent'])}>{when}</div> : null}
            <div className={styles['info']}>
                <div className={styles['ep']}>S{season} E{episode}{title ? ` · ${title}` : ''}</div>
                <div className={styles['name']}>{name}</div>
            </div>
        </a>
    );
};

UpcomingCard.propTypes = {
    className: PropTypes.string,
    metaId: PropTypes.string,
    videoId: PropTypes.string,
    name: PropTypes.string,
    season: PropTypes.number,
    episode: PropTypes.number,
    title: PropTypes.string,
    released: PropTypes.string,
    thumbnail: PropTypes.string,
    background: PropTypes.string,
    poster: PropTypes.string,
};

module.exports = UpcomingCard;
