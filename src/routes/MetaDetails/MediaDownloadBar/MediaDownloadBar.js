// Copyright (C) 2017-2026 HomeBot Cinema
// Slim "On your server" strip above the streams: what is already on disk, play it, or save the best stream.

const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate } = require('react-router');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { api, playServerFile, formatBytes, isAdmin } = require('stremio/common/serverApi');
const { useQualityProfiles, flattenStreams, toRawStream } = require('stremio/common/qualityProfile');
const { default: useRouteFocused } = require('stremio/common/useRouteFocused');
const useServerEvents = require('stremio/common/useServerEvents');
const styles = require('./MediaDownloadBar.less');

const DriveIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="13" width="18" height="7" rx="2" />
        <path d="M5 13l2.2-7.2A2 2 0 019.1 4h5.8a2 2 0 011.9 1.8L19 13" />
        <circle cx="7.5" cy="16.5" r="0.6" fill="currentColor" />
    </svg>
);

const OPEN_KEY = 'homebot_download_bar_open';
const readOpen = () => {
    try {
        return window.localStorage.getItem(OPEN_KEY) === '1';
    } catch (_) {
        return false;
    }
};

const Chevron = ({ className }) => (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
Chevron.propTypes = { className: PropTypes.string };

const MediaDownloadBar = ({ meta, video, streams = [] }) => {
    const core = useCore();
    const navigate = useNavigate();
    const admin = isAdmin();
    // this page stays mounted underneath the player: do not poll the server while it is not the visible route
    const routeFocused = useRouteFocused();
    const metaId = meta ? meta.id : null;

    const [status, setStatus] = React.useState({ downloaded: false });
    const [lib, setLib] = React.useState(null);
    const [monitor, setMonitor] = React.useState(null); // the Sentinel entry for this show, if any
    const [picking, setPicking] = React.useState(false);
    const [open, setOpen] = React.useState(readOpen);
    const [mode, setMode] = React.useState('seasons');
    const [chosen, setChosen] = React.useState(() => new Set());
    const [submitting, setSubmitting] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [canForce, setCanForce] = React.useState(false);
    const { profiles, selected, select } = useQualityProfiles();

    const mediaId = React.useMemo(() => (video && video.id) || (meta && meta.id) || null, [meta, video]);
    const title = React.useMemo(() => {
        if (video && video.title) {
            const epTag = video.season && video.number ? `S${String(video.season).padStart(2, '0')}E${String(video.number).padStart(2, '0')}` : '';
            return `${meta?.name || 'Series'} ${epTag} - ${video.title}`;
        }
        return meta?.name || 'Media';
    }, [meta, video]);

    const refresh = React.useCallback(async () => {
        if (!mediaId) return;
        try {
            setStatus(await api('GET', `/api/downloads/check/${encodeURIComponent(mediaId)}`));
        } catch (_) {
            // transient: keep the last known status
        }
        if (/^tt\d+/.test(metaId || '')) {
            try {
                setLib(await api('GET', `/api/library/by-imdb/${encodeURIComponent(metaId)}?soft=1`));
            } catch (_) {
                setLib(null);
            }
        }
    }, [mediaId, metaId]);

    React.useEffect(() => {
        if (routeFocused) refresh();
    }, [refresh, routeFocused]);
    useServerEvents(['downloads', 'library'], refresh, { fallbackMs: 5000, enabled: routeFocused });

    React.useEffect(() => {
        if (!meta || meta.type !== 'series' || !meta.id) return;
        api('GET', '/api/sentinel/monitored')
            .then((list) => setMonitor((Array.isArray(list) ? list : Object.values(list || {})).find((i) => i.imdbId === meta.id && i.monitored) || null))
            .catch(() => setMonitor(null));
    }, [meta]);

    // the file for what the page is showing: the movie itself, or the selected episode
    const localFile = React.useMemo(() => {
        if (!lib) return null;
        if (lib.type === 'movie') return (lib.files || [])[0] || null;
        if (!video) return null;
        const season = (lib.seasons || []).find((s) => s.season === video.season);
        const ep = season && season.episodes.find((e) => e.episode === (video.number ?? video.episode));
        return ep && ep.files[0] ? ep.files[0] : null;
    }, [lib, video]);

    const playLocal = async () => {
        const ctx = meta ? { type: meta.type, imdbId: meta.id, season: video ? video.season : null, episode: video ? (video.number ?? video.episode) : null } : null;
        try {
            if (localFile) await playServerFile(core, navigate, localFile.streamId, title, ctx);
            else if (status.streamUrl) await playServerFile(core, navigate, status.streamUrl.split('/stream/')[1].split('/')[0], title, ctx);
        } catch (e) {
            setMessage(e.message);
        }
    };

    // Save the best release for the selected quality profile (the server scores every stream and explains misses)
    const handleDownload = async (force = false) => {
        const flat = flattenStreams(streams);
        if (flat.length === 0) {
            setMessage(meta && meta.type === 'series' && !video ? 'Open an episode to save it.' : 'Streams are still loading, try again in a moment.');
            return;
        }
        setSubmitting(true);
        setMessage('');
        setCanForce(false);
        try {
            const res = await api('POST', '/api/grabber/grab', {
                force,
                profileId: selected ? selected.id : undefined,
                streams: flat.map(toRawStream),
                meta: {
                    type: meta && meta.type === 'series' ? 'series' : 'movie',
                    title, showTitle: meta && meta.name, imdbId: meta && meta.id, mediaId,
                    season: video && video.season, episode: video && (video.number || video.episode),
                    poster: meta && meta.poster, year: meta && meta.year
                }
            });
            setMessage(`Queued ${res.picked.resolution || ''} · ${res.picked.sizeGB ? `${res.picked.sizeGB} GB · ` : ''}${res.profile.name}`);
            await refresh();
        } catch (e) {
            if (e.status === 422 && e.data && e.data.error === 'no_live_swarm') {
                setCanForce(true);
                setMessage(`No working peers for the ${e.data.checked} best releases right now, so they would sit on the loading screen.`);
            } else if (e.status === 422 && e.data && e.data.error === 'no_match') {
                const top = Object.entries(e.data.rejectedSummary || {}).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([why, n]) => `${n}× ${why}`).join(', ');
                setMessage(`Nothing matches “${e.data.profile.name}” (${e.data.considered} checked: ${top || 'all rejected'}). Try another profile.`);
            } else {
                setMessage(e.message);
            }
        } finally {
            setSubmitting(false);
        }
    };

    // Per season: aired episodes, and how many of them are not on the server yet (what Sentinel would queue right now)
    const seasonInfo = React.useMemo(() => {
        const have = new Set();
        if (lib && lib.seasons) lib.seasons.forEach((sn) => sn.episodes.forEach((e) => have.add(`${sn.season}:${e.episode}`)));
        const rows = new Map();
        const nowMs = Date.now();
        for (const v of (meta && meta.videos) || []) {
            const sn = v.season;
            const ep = v.number ?? v.episode;
            if (!sn || !ep) continue;
            const t = v.released instanceof Date ? v.released.getTime() : Date.parse(v.released);
            const row = rows.get(sn) || { season: sn, aired: 0, missing: 0 };
            if (!Number.isFinite(t) || t <= nowMs) {
                row.aired++;
                if (!have.has(`${sn}:${ep}`)) row.missing++;
            }
            rows.set(sn, row);
        }
        return [...rows.values()].sort((a, b) => a.season - b.season);
    }, [meta, lib]);
    const queueNow = (m, picked) => (m === 'new' ? 0 : seasonInfo.filter((sn) => m === 'all' || picked.has(sn.season)).reduce((a, sn) => a + sn.missing, 0));

    const openPicker = () => {
        const sc = monitor && monitor.scope;
        if (sc && sc.mode === 'new') setMode('new');
        else if (sc && sc.mode === 'all') setMode('all');
        else setMode('seasons');
        const start = sc && sc.mode === 'seasons' ? sc.seasons : [video && video.season ? video.season : (seasonInfo.length ? seasonInfo[seasonInfo.length - 1].season : null)].filter((n) => n);
        setChosen(new Set(start));
        setPicking(true);
    };
    const toggleSeason = (n) => setChosen((prev) => {
        const next = new Set(prev);
        if (next.has(n)) next.delete(n); else next.add(n);
        return next;
    });
    const startMonitor = async () => {
        const scope = mode === 'seasons' ? { mode, seasons: [...chosen].sort((a, b) => a - b) } : { mode };
        try {
            const r = await api('POST', '/api/sentinel/monitor', { imdbId: meta.id, title: meta.name, poster: meta.poster, quality: '1080p', monitored: true, profileId: selected ? selected.id : undefined, scope });
            setMonitor({ ...r.item, scopeLabel: scope.mode === 'seasons' ? `Season${scope.seasons.length === 1 ? '' : 's'} ${scope.seasons.join(', ')}` : scope.mode === 'all' ? 'All seasons' : 'New episodes only' });
            setPicking(false);
            setMessage('');
        } catch (e) {
            setMessage(e.message);
        }
    };
    const stopMonitor = async () => {
        try {
            await api('POST', '/api/sentinel/monitor', { imdbId: meta.id, monitored: false });
            setMonitor(null);
        } catch (e) {
            setMessage(e.message);
        }
    };

    const downloading = status.status === 'downloading';
    const onServer = !!localFile || status.downloaded || (lib && !video);
    const canSave = !downloading && !localFile && !status.downloaded;
    const hasOptions = canSave || !!(admin && meta && meta.type === 'series');
    const expanded = open && hasOptions;
    const toggleOpen = () => setOpen((v) => {
        try {
            window.localStorage.setItem(OPEN_KEY, v ? '0' : '1');
        } catch (_) {
            // not remembered
        }
        return !v;
    });
    const summary = lib ?
        (lib.type === 'series' ?
            `${lib.seasons.length} season${lib.seasons.length === 1 ? '' : 's'} · ${lib.seasons.reduce((a, s) => a + s.episodes.length, 0)} episodes · ${formatBytes(lib.totalSize)}`
            :
            [localFile && localFile.resolution, formatBytes(lib.totalSize)].filter(Boolean).join(' · '))
        : '';

    return (
        <div className={classnames(styles['bar'], { [styles['collapsed']]: !expanded })}>
            <div className={classnames(styles['row'], { [styles['on']]: onServer })}>
                <span className={styles['icon']}><DriveIcon /></span>
                <div className={styles['text']}>
                    <div className={styles['headline']}>
                        {downloading ? `Saving to your server… ${Math.round((status.progress || 0) * 100)}%`
                            : localFile && lib && lib.type === 'series' ? 'This episode is on your server'
                                : onServer ? 'On your server'
                                    : lib && video ? 'This episode isn’t on your server'
                                        : 'Not on your server yet'}
                    </div>
                    {expanded && summary && !downloading ? <div className={styles['sub']}>{summary}{localFile && lib.type === 'series' && localFile.resolution ? ` · ${localFile.resolution}` : ''}</div> : null}
                    {downloading ? <div className={styles['track']}><div className={styles['fill']} style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} /></div> : null}
                </div>
                <div className={styles['actions']}>
                    {(localFile || status.downloaded) && !downloading ? <button type="button" className={styles['btn-white']} onClick={playLocal}>▶ Play</button> : null}
                    {lib && (expanded || !hasOptions) ? <a className={styles['btn']} href={`#/server/${lib.id}`}>Open</a> : null}
                    {hasOptions ?
                        <button type="button" className={styles['toggle']} aria-expanded={expanded} onClick={toggleOpen} title={expanded ? 'Hide download options' : 'Show download options'}>
                            {canSave ? 'Download' : 'Options'}<Chevron className={styles['chev']} />
                        </button>
                        : null}
                </div>
            </div>
            {expanded && canSave ?
                <div className={styles['save-row']}>
                    {profiles.length > 0 ?
                        <label className={styles['save-label']}>
                            <span>Quality</span>
                            <select
                                className={styles['profile-select']}
                                value={selected ? selected.id : ''}
                                onChange={(e) => select(Number(e.target.value))}
                                title="Quality profile used to pick the best release"
                            >
                                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </label>
                        : null}
                    <button type="button" className={styles['btn-white']} disabled={submitting} onClick={() => handleDownload(false)} title="Saves the best release for this profile to the server">
                        {submitting ? 'Adding…' : 'Save to server'}
                    </button>
                </div>
                : null}
            {expanded && admin && meta && meta.type === 'series' ?
                <div className={styles['monitor-box']}>
                    {picking ?
                        <div className={styles['picker']}>
                            <div className={styles['picker-title']}>Auto-download with Sentinel</div>
                            <label className={classnames(styles['opt'], { [styles['sel']]: mode === 'seasons' })}>
                                <input type="radio" name="scope" checked={mode === 'seasons'} onChange={() => setMode('seasons')} />
                                <i className={styles['dot']} />
                                <span>Specific seasons</span>
                            </label>
                            {mode === 'seasons' ?
                                <div className={styles['season-chips']}>
                                    {seasonInfo.map((sn) => (
                                        <button key={sn.season} type="button" aria-pressed={chosen.has(sn.season)} className={classnames(styles['season-chip'], { [styles['on']]: chosen.has(sn.season) })} onClick={() => toggleSeason(sn.season)}>
                                            Season {sn.season}<em>{sn.missing === 0 ? 'all on server' : `${sn.missing} to get`}</em>
                                        </button>
                                    ))}
                                </div>
                                : null}
                            <label className={classnames(styles['opt'], { [styles['sel']]: mode === 'new' })}>
                                <input type="radio" name="scope" checked={mode === 'new'} onChange={() => setMode('new')} />
                                <i className={styles['dot']} />
                                <span>New episodes only <em className={styles['hint']}>as they air, nothing from the past</em></span>
                            </label>
                            <label className={classnames(styles['opt'], { [styles['sel']]: mode === 'all' })}>
                                <input type="radio" name="scope" checked={mode === 'all'} onChange={() => setMode('all')} />
                                <i className={styles['dot']} />
                                <span>Every season <em className={styles['hint']}>the whole back catalog</em></span>
                            </label>
                            <div className={classnames(styles['picker-summary'], { [styles['big']]: queueNow(mode, chosen) > 0 })}>
                                {mode === 'new' ? 'Nothing is downloaded now. New episodes are fetched when they air.'
                                    : `Queues ${queueNow(mode, chosen)} episode${queueNow(mode, chosen) === 1 ? '' : 's'} right now${mode === 'seasons' ? ', then the rest of those seasons as they air' : ''}.`}
                            </div>
                            <div className={styles['picker-actions']}>
                                <button type="button" className={styles['btn']} disabled={mode === 'seasons' && chosen.size === 0} onClick={startMonitor}>Start</button>
                                <button type="button" className={styles['link-btn']} onClick={() => setPicking(false)}>Cancel</button>
                            </div>
                        </div>
                        : monitor ?
                            <div className={styles['monitor-row']}>
                                <span>Auto-download: <strong>{monitor.scopeLabel || 'All seasons'}</strong>{selected ? <em className={styles['hint']}> · {selected.name}</em> : null}</span>
                                <button type="button" className={styles['link-btn']} onClick={openPicker}>Change</button>
                                <button type="button" className={styles['link-btn']} onClick={stopMonitor}>Stop</button>
                            </div>
                            :
                            <button type="button" className={styles['link-btn']} onClick={openPicker} title="Choose which seasons Sentinel downloads">Auto-download episodes…</button>}
                </div>
                : null}
            {message ? <div className={styles['message']}>{message}</div> : null}
            {canForce ? <button type="button" className={styles['btn']} onClick={() => handleDownload(true)}>Save anyway</button> : null}
        </div>
    );
};

MediaDownloadBar.propTypes = {
    meta: PropTypes.object,
    video: PropTypes.object,
    streams: PropTypes.array
};

module.exports = MediaDownloadBar;
