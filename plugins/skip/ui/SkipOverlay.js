// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "skip": the player overlay (slot playerOverlays). Shows "Skip intro / recap / credits" while one plays, auto-skips
// when the profile asked for it (with Undo), and tells the player when the end credits start so Up Next opens then.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const L = require('./logic');
const styles = require('./SkipOverlay.less');

const NOTICE_MS = 6000;

// clicks on the overlay must not reach the player (a click toggles pause, a double click toggles fullscreen)
const stop = (event) => event.stopPropagation();

const SkipIcon = () => (
    <svg className={styles['icon']} viewBox={'0 0 24 24'} aria-hidden={'true'}>
        <path d={'M5 5.5v13l9-6.5-9-6.5zm10 0v13h2.5v-13H15z'} fill={'currentColor'} />
    </svg>
);

function useSegments(videoId, file) {
    const [state, setState] = React.useState({ key: null, segments: [] });
    const key = videoId || file ? `${videoId || ''}|${file || ''}` : null;
    React.useEffect(() => {
        if (!key) {
            setState({ key: null, segments: [] });
            return undefined;
        }
        let alive = true;
        const q = new URLSearchParams();
        if (videoId) q.set('videoId', videoId);
        if (file) q.set('file', file);
        api('GET', `/api/skip/segments?${q}`)
            .then((r) => { if (alive) setState({ key, segments: (r && r.segments) || [] }); })
            .catch(() => { if (alive) setState({ key, segments: [] }); });
        return () => { alive = false; };
    }, [key, videoId, file]);
    return state.key === key ? state.segments : [];
}

const SkipOverlay = ({ videoId, streamUrl, timeMs, durationMs, paused, live, controlsHidden, menusOpen, hasNextVideo, seekTo, playNext, reportCreditsStart }) => {
    const prefs = L.readPrefs(window.ssoProfile);
    const lookupId = L.lookupVideoId(videoId);
    const file = L.libraryFileParam(streamUrl);
    // ask once the video has loaded: by then the stream (and its library file id) is known, so there is one request per playback
    const ready = !live && Number.isFinite(durationMs) && durationMs > 0;
    const raw = useSegments(ready ? lookupId : null, ready ? file : null);
    const segments = React.useMemo(() => L.toPlayerSegments(raw, durationMs), [raw, durationMs]);

    // segments already skipped (by hand or automatically) or undone in this playback: never auto-skip them again
    const handled = React.useRef(new Set());
    const playbackKey = `${lookupId || ''}|${file || ''}|${streamUrl || ''}`;
    const [notice, setNotice] = React.useState(null);
    React.useEffect(() => {
        handled.current = new Set();
        setNotice(null);
    }, [playbackKey]);
    React.useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(t);
    }, [notice]);

    // Up Next at the start of the end credits (the player ignores it unless it belongs to the stream now playing)
    const creditsAt = prefs.upNextAtCredits ? L.creditsStart(segments, durationMs) : null;
    React.useEffect(() => {
        if (typeof reportCreditsStart === 'function') reportCreditsStart(creditsAt);
    }, [creditsAt, reportCreditsStart]);
    React.useEffect(() => () => {
        if (typeof reportCreditsStart === 'function') reportCreditsStart(null);
    }, [reportCreditsStart]);

    const seg = live ? null : L.activeSegment(segments, timeMs);

    const { autoIntro, autoRecap } = prefs;
    React.useEffect(() => {
        if (!seg || paused !== false || typeof seekTo !== 'function') return;
        if (L.shouldAutoSkip(seg, timeMs, { autoIntro, autoRecap }, handled.current)) {
            handled.current.add(L.segmentKey(seg));
            seekTo(seg.end);
            setNotice({ seg, text: seg.type === 'recap' ? 'Recap skipped' : 'Intro skipped' });
        }
    }, [seg, timeMs, paused, autoIntro, autoRecap, seekTo]);

    const onSkip = React.useCallback((event) => {
        stop(event);
        if (!seg) return;
        handled.current.add(L.segmentKey(seg));
        const action = L.skipAction(seg, segments, durationMs, hasNextVideo);
        if (action.kind === 'next' && typeof playNext === 'function') playNext();
        else if (typeof seekTo === 'function') seekTo(action.to);
    }, [seg, segments, durationMs, hasNextVideo, playNext, seekTo]);

    const onUndo = React.useCallback((event) => {
        stop(event);
        if (notice && typeof seekTo === 'function') seekTo(notice.seg.start);
        setNotice(null);
    }, [notice, seekTo]);

    const showButton = !!seg && !menusOpen && !(notice && L.segmentKey(notice.seg) === L.segmentKey(seg));
    if (!showButton && !notice) return null;
    const action = seg ? L.skipAction(seg, segments, durationMs, hasNextVideo) : null;
    return (
        <div
            className={classnames(styles['skip-overlay'], { [styles['low']]: controlsHidden })}
            onMouseDown={stop}
            onClick={stop}
            onDoubleClick={stop}
            onTouchEnd={stop}
        >
            {
                notice ?
                    <div className={styles['notice']} role={'status'}>
                        <span>{notice.text}</span>
                        <button type={'button'} className={styles['undo']} onClick={onUndo}>Undo</button>
                    </div>
                    :
                    null
            }
            {
                showButton ?
                    <button type={'button'} className={styles['skip-button']} onClick={onSkip} title={action.label}>
                        <SkipIcon />
                        <span>{action.label}</span>
                    </button>
                    :
                    null
            }
        </div>
    );
};

SkipOverlay.propTypes = {
    videoId: PropTypes.string,
    streamUrl: PropTypes.string,
    timeMs: PropTypes.number,
    durationMs: PropTypes.number,
    paused: PropTypes.bool,
    live: PropTypes.bool,
    controlsHidden: PropTypes.bool,
    menusOpen: PropTypes.bool,
    hasNextVideo: PropTypes.bool,
    seekTo: PropTypes.func,
    playNext: PropTypes.func,
    reportCreditsStart: PropTypes.func,
};

module.exports = SkipOverlay;
