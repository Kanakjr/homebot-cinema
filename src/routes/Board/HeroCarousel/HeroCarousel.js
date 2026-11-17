// Copyright (C) 2017-2026 HomeBot Cinema
// Home hero banner: backdrop + title logo + one "View details" CTA, auto-rotating, with previous/next buttons.
// Which titles appear is decided by pickHeroItems (Board passes the result in `items`).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { default: getMetaDetailsHref } = require('stremio/common/getMetaDetailsHref');
const usePlayResolve = require('stremio/common/usePlayResolve');
const { MAX_SLIDES } = require('./pickHeroItems');
const styles = require('./styles');

const ROTATE_MS = 7000;
const SWIPE_PX = 40;
const imdbArt = (kind, id) => `https://images.metahub.space/${kind}/medium/${id}/img`;

const Slide = ({ item, active, onBackdropBroken }) => {
    const { play, resolving } = usePlayResolve();
    // the text title shows until the logo image has loaded (or for good if it fails); a shimmer until the backdrop arrives
    const [logoState, setLogoState] = React.useState('loading'); // loading | ok | failed
    const [backdropReady, setBackdropReady] = React.useState(false);
    const logoSrc = item.logo || imdbArt('logo', item.id);
    const href = getMetaDetailsHref(item.deepLinks) || `#/detail/${item.type}/${item.id}`;
    const year = item.releaseInfo || (item.year ? String(item.year) : null);
    const meta = [
        item.type === 'series' ? 'Series' : item.type === 'movie' ? 'Movie' : item.type,
        Array.isArray(item.genres) && item.genres[0],
        year
    ].filter(Boolean);
    const synopsis = item.description || item.overview || null;

    const onPlay = React.useCallback((event) => {
        event.preventDefault();
        play({ id: item.id, type: item.type, fallbackHref: href });
    }, [play, item, href]);

    return (
        <div className={classnames(styles['slide'], { [styles['active']]: active, [styles['loading']]: !backdropReady })} aria-hidden={!active}>
            <img
                className={styles['backdrop']}
                src={imdbArt('background', item.id)}
                alt=""
                onLoad={() => setBackdropReady(true)}
                onError={() => onBackdropBroken(item.id)}
            />
            <div className={styles['shade']} />
            <div className={styles['content']}>
                {logoState !== 'ok' ? <div className={styles['title']}>{item.name}</div> : null}
                {logoState !== 'failed' ?
                    <img
                        className={classnames(styles['logo'], { [styles['pending']]: logoState === 'loading' })}
                        src={logoSrc}
                        alt={logoState === 'ok' ? item.name : ''}
                        onLoad={() => setLogoState('ok')}
                        onError={() => setLogoState('failed')}
                    />
                    : null}
                <div className={styles['meta']}>
                    {meta.map((m, i) => <React.Fragment key={m}>{i > 0 ? <span className={styles['dot']}>•</span> : null}<span>{m}</span></React.Fragment>)}
                </div>
                {synopsis ? <p className={styles['synopsis']}>{synopsis}</p> : null}
                <div className={styles['actions']}>
                    <button
                        type="button"
                        className={classnames(styles['cta'], styles['cta-play'])}
                        onClick={onPlay}
                        disabled={resolving}
                        tabIndex={active ? 0 : -1}
                        aria-label={`Play ${item.name}`}
                    >
                        <svg className={styles['play-icon']} viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                            <polygon points="5,3 19,12 5,21" />
                        </svg>
                        <span>{resolving ? 'Loading…' : 'Play'}</span>
                    </button>
                    <a className={classnames(styles['cta'], styles['cta-details'])} href={href} tabIndex={active ? 0 : -1}>
                        View details
                    </a>
                </div>
            </div>
        </div>
    );
};
Slide.propTypes = { item: PropTypes.object.isRequired, active: PropTypes.bool, onBackdropBroken: PropTypes.func.isRequired };

const Chevron = ({ dir }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
);
Chevron.propTypes = { dir: PropTypes.oneOf(['prev', 'next']).isRequired };

const prefersReducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return false;
    }
};

const HeroCarousel = ({ className, items }) => {
    // a title whose backdrop cannot be loaded is dropped instead of showing a stretched poster
    const [broken, setBroken] = React.useState(() => new Set());
    const slides = React.useMemo(() => {
        const seen = new Set();
        return (items || []).filter((i) => i && !broken.has(i.id) && !seen.has(i.id) && seen.add(i.id)).slice(0, MAX_SLIDES);
    }, [items, broken]);
    // the active slide is tracked by id, so slides arriving (or being dropped) later do not make the banner jump
    const [activeId, setActiveId] = React.useState(null);
    const [hovered, setHovered] = React.useState(false);
    const [keyboardFocus, setKeyboardFocus] = React.useState(false);
    const [tabHidden, setTabHidden] = React.useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
    const touchStart = React.useRef(null);
    const reducedMotion = React.useMemo(prefersReducedMotion, []);

    const index = Math.max(0, slides.findIndex((s) => s.id === activeId));
    const count = slides.length;
    const go = React.useCallback((delta) => {
        if (count < 2) return;
        setActiveId(slides[(index + delta + count) % count].id);
    }, [slides, index, count]);

    React.useEffect(() => {
        const onVisibility = () => setTabHidden(document.visibilityState === 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    // one timer per slide: choosing a slide yourself restarts the wait, and nothing rotates while you are looking at it
    React.useEffect(() => {
        if (count < 2 || hovered || keyboardFocus || tabHidden || reducedMotion) return;
        const timer = setTimeout(() => go(1), ROTATE_MS);
        return () => clearTimeout(timer);
    }, [count, hovered, keyboardFocus, tabHidden, reducedMotion, go, index]);

    const onBackdropBroken = React.useCallback((id) => {
        setBroken((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
    }, []);
    const onKeyDown = (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    };
    const onTouchStart = (event) => { touchStart.current = event.touches[0].clientX; };
    const onTouchEnd = (event) => {
        if (touchStart.current === null) return;
        const dx = event.changedTouches[0].clientX - touchStart.current;
        touchStart.current = null;
        if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? 1 : -1);
    };

    if (count === 0) return null;
    return (
        <div
            className={classnames(className, styles['hero'])}
            role="region"
            aria-roledescription="carousel"
            aria-label="Featured titles"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={(event) => { if (event.target.matches(':focus-visible')) setKeyboardFocus(true); }}
            onBlur={() => setKeyboardFocus(false)}
            onKeyDown={onKeyDown}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
        >
            {slides.map((item, i) => <Slide key={item.id} item={item} active={i === index} onBackdropBroken={onBackdropBroken} />)}
            {count > 1 ?
                <>
                    <button type="button" className={classnames(styles['nav'], styles['prev'])} aria-label="Previous title" onClick={() => go(-1)}>
                        <Chevron dir="prev" />
                    </button>
                    <button type="button" className={classnames(styles['nav'], styles['next'])} aria-label="Next title" onClick={() => go(1)}>
                        <Chevron dir="next" />
                    </button>
                    <div className={styles['dots']}>
                        {slides.map((item, i) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-label={`Show ${item.name || `title ${i + 1}`}`}
                                aria-current={i === index}
                                className={classnames(styles['pip'], { [styles['on']]: i === index })}
                                onClick={() => setActiveId(item.id)}
                            />
                        ))}
                    </div>
                </>
                : null}
        </div>
    );
};
HeroCarousel.propTypes = { className: PropTypes.string, items: PropTypes.array };

module.exports = HeroCarousel;
