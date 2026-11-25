// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "livesubs": the player overlay (slot playerOverlays). When AI subtitles are on, it asks the server to transcribe
// from the current position, polls for cues (the poll is also the playhead heartbeat) and draws the line on screen.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const L = require('./logic');
const store = require('./store');
const styles = require('./LiveSubsOverlay.less');

const POLL_MS = 2000;
const KEEP_SEC = 600; // cues kept around the playhead

const LiveSubsOverlay = ({ stream, streamUrl, subtitlesOn, timeMs, durationMs, paused, live, controlsHidden }) => {
    const mode = store.useMode();
    const src = L.sourceOf(stream, streamUrl);
    const key = L.sourceKey(src);
    // a real subtitle track always wins: while one is shown we neither draw nor transcribe (no two lines in one place)
    const ready = mode !== 'off' && !!src && !live && !subtitlesOn && Number.isFinite(durationMs) && durationMs > 0;

    const [session, setSession] = React.useState(null);
    const [cues, setCues] = React.useState([]);
    const [status, setStatus] = React.useState(null);
    const timeRef = React.useRef(0);
    timeRef.current = (Number(timeMs) || 0) / 1000;

    React.useEffect(() => {
        setSession(null);
        setCues([]);
        setStatus(null);
        if (!ready) return undefined;
        let alive = true;
        api('POST', '/api/livesubs/open', { ...src, position: timeRef.current })
            .then((r) => { if (alive) { setSession(r.id); setStatus(r.status); } })
            .catch((e) => { if (alive) setStatus({ state: 'error', error: e.message }); });
        return () => { alive = false; };
    }, [ready, key, mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const inFlight = React.useRef(false);
    const poll = React.useCallback(() => {
        if (!session || inFlight.current) return;
        inFlight.current = true;
        const t = timeRef.current;
        api('GET', `/api/livesubs/${session}?pos=${t.toFixed(2)}&from=${(t - 10).toFixed(2)}&to=${(t + 300).toFixed(2)}`)
            .then((r) => {
                setStatus(r.status);
                setCues((held) => L.mergeWindow(held, r.cues || []).filter((c) => Math.abs(c.start - timeRef.current) < KEEP_SEC));
            })
            .catch((e) => setStatus({ state: 'error', error: e.message }))
            .finally(() => { inFlight.current = false; });
    }, [session]);

    React.useEffect(() => {
        if (!session) return undefined;
        poll();
        const iv = setInterval(poll, POLL_MS);
        return () => clearInterval(iv);
    }, [session, poll]);

    // a seek: tell the server straight away so it starts transcribing at the new position
    const last = React.useRef({ t: null, at: 0 });
    React.useEffect(() => {
        const t = (Number(timeMs) || 0) / 1000;
        const at = Date.now();
        if (L.isSeek(last.current.t, last.current.at, t, at, paused)) poll();
        last.current = { t, at };
    }, [timeMs, paused, poll]);

    if (!ready) return null;
    const t = (Number(timeMs) || 0) / 1000;
    const cue = L.cueAt(cues, t);
    const waiting = !cue && status && status.state !== 'error' && status.lead < 1;
    const badge = status && status.state === 'error' ? 'AI subtitles unavailable'
        : (waiting ? 'AI subtitles · listening…' : null);

    return (
        <div className={classnames(styles['livesubs'], { [styles['low']]: controlsHidden })} aria-live={'polite'}>
            {
                badge && !controlsHidden ?
                    <div className={styles['badge']} title={status && status.error ? status.error : ''}>{badge}</div>
                    : null
            }
            {
                cue ?
                    <div className={styles['cue']}>
                        {cue.text.split('\n').map((line, i) => <span key={i} className={styles['line']}>{line}</span>)}
                    </div>
                    : null
            }
        </div>
    );
};

LiveSubsOverlay.propTypes = {
    stream: PropTypes.object,
    streamUrl: PropTypes.string,
    subtitlesOn: PropTypes.bool,
    timeMs: PropTypes.number,
    durationMs: PropTypes.number,
    paused: PropTypes.bool,
    live: PropTypes.bool,
    controlsHidden: PropTypes.bool,
};

module.exports = LiveSubsOverlay;
