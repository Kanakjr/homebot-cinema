// Copyright (C) 2017-2026 HomeBot Cinema
// Downloads = activity only: what is downloading now, what Sentinel is watching, what just finished.
// Everything that is already on disk lives in the server library (#/server).

const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate } = require('react-router');
const classnames = require('classnames');
const { MainNavBars } = require('stremio/components');
const PageHeader = require('stremio/components/PageHeader');
const { api, formatBytes, isAdmin } = require('stremio/common/serverApi');
const { useQualityProfiles } = require('stremio/common/qualityProfile');
const useServerEvents = require('stremio/common/useServerEvents');
const styles = require('./Downloads.less');

const POLL_MS = 3000;
const toList = (v) => (Array.isArray(v) ? v : Object.values(v || {}));

const eta = (seconds) => {
    if (!(seconds > 0)) return '';
    if (seconds < 90) return `${Math.round(seconds)} s left`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min left`;
    return `${(seconds / 3600).toFixed(1)} h left`;
};

const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const Thumb = ({ src, title }) => {
    const [failed, setFailed] = React.useState(false);
    return src && !failed ?
        <img className={styles['thumb']} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
        :
        <div className={classnames(styles['thumb'], styles['thumb-empty'])}>{(title || '?').charAt(0)}</div>;
};
Thumb.propTypes = { src: PropTypes.string, title: PropTypes.string };

const Downloads = () => {
    const navigate = useNavigate();
    const admin = isAdmin();
    const [data, setData] = React.useState(null);
    const [monitored, setMonitored] = React.useState([]);
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState('');
    const { profiles } = useQualityProfiles();
    const defaultProfile = profiles.find((p) => p.isDefault);
    const profileOf = (m) => profiles.find((p) => p.id === m.profileId) || defaultProfile;

    const load = React.useCallback(async () => {
        try {
            const [dl, mon] = await Promise.all([api('GET', '/api/downloads'), api('GET', '/api/sentinel/monitored').catch(() => [])]);
            setData(dl);
            setMonitored(toList(mon));
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, []);

    React.useEffect(() => { load(); }, [load]);
    // pushed updates; polls every POLL_MS only while the live connection is down
    useServerEvents(['downloads', 'library', 'sentinel'], load, { fallbackMs: POLL_MS });

    const act = async (id, action) => {
        if (action === 'delete' && !window.confirm('Cancel this download and remove its files?')) return;
        try {
            await api('POST', '/api/downloads/action', { id, action, deleteLocalData: action === 'delete' });
            load();
        } catch (e) {
            setError(e.message);
        }
    };
    const checkNow = async (imdbId) => {
        setBusy(imdbId);
        try {
            await api('POST', '/api/sentinel/check', { imdbId });
            await load();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy('');
        }
    };
    const changeProfile = async (m, value) => {
        try {
            await api('POST', '/api/sentinel/monitor', { imdbId: m.imdbId, title: m.title, poster: m.poster, quality: m.quality, monitored: true, profileId: value === '' ? null : Number(value) });
            load();
        } catch (e) {
            setError(e.message);
        }
    };
    const redownload = async (m) => {
        if (!window.confirm(`Download the ${m.skippedCount} removed episode(s) of ${m.title} again?`)) return;
        try {
            await api('POST', '/api/sentinel/redownload', { imdbId: m.imdbId });
            load();
        } catch (e) {
            setError(e.message);
        }
    };
    const stopMonitoring = async (imdbId) => {
        if (!window.confirm('Stop auto-downloading new episodes of this show?')) return;
        try {
            await api('POST', '/api/sentinel/monitor', { imdbId, monitored: false });
            load();
        } catch (e) {
            setError(e.message);
        }
    };
    const openOnServer = async (item) => {
        if (item.imdbId) {
            try {
                const hit = await api('GET', `/api/library/by-imdb/${encodeURIComponent(item.imdbId)}`);
                navigate(`/server/${hit.id}`);
                return;
            } catch (_) {
                // not in the library (yet): fall through to the grid
            }
        }
        navigate('/server');
    };

    const active = data ? toList(data.active) : [];
    const recent = data ? toList(data.completed).filter((d) => d.status === 'completed')
        .sort((a, b) => String(b.completedAt || b.addedAt || '').localeCompare(String(a.completedAt || a.addedAt || ''))).slice(0, 10) : [];
    const disk = data && data.disk ? data.disk : null;
    const pct = disk && disk.totalBytes ? Math.min(100, Math.round((disk.usedBytes / disk.totalBytes) * 100)) : 0;

    return (
        <MainNavBars className={styles['route']} route={'downloads'}>
            <div className={styles['scroll']}>
                <div className={styles['page']}>
                    <PageHeader
                        eyebrow="HomeBot Cinema"
                        title="Downloads"
                        subtitle={`${active.length} active · ${monitored.length} monitored show${monitored.length === 1 ? '' : 's'}`}
                        actions={<a className={styles['btn']} href="#/server">Browse what’s on the server →</a>}
                    />
                    {error ? <div className={styles['error']}>{error}</div> : null}

                    {disk ?
                        <div className={styles['storage']}>
                            <div className={styles['storage-top']}>
                                <span>Storage</span>
                                <span className={styles['muted']}><b>{formatBytes(disk.usedBytes)}</b> used of {formatBytes(disk.totalBytes)} · {formatBytes(disk.freeBytes)} free</span>
                            </div>
                            <div className={styles['track']}><div className={classnames(styles['fill'], { [styles['hot']]: pct >= 90 })} style={{ width: `${pct}%` }} /></div>
                        </div>
                        : null}

                    <h2 className={styles['section']}>Active <span className={styles['count']}>{active.length}</span></h2>
                    {active.length === 0 ? <div className={styles['empty']}>Nothing downloading right now.</div> : null}
                    <div className={styles['list']}>
                        {active.map((t) => {
                            const p = Math.round((t.progress || 0) * 100);
                            const paused = t.status === 'paused';
                            return (
                                <div key={t.id} className={styles['card']}>
                                    <Thumb src={t.poster} title={t.title} />
                                    <div className={styles['card-main']}>
                                        <div className={styles['card-title']}>{t.title}</div>
                                        <div className={styles['track']}><div className={styles['fill']} style={{ width: `${p}%` }} /></div>
                                        <div className={styles['card-meta']}>
                                            <span>{paused ? 'Paused' : `${p}%`}</span>
                                            {!paused && t.rateDownload > 0 ? <span>{formatBytes(t.rateDownload)}/s</span> : null}
                                            {!paused ? <span>{eta(t.eta)}</span> : null}
                                            {t.totalSize ? <span>{formatBytes(t.totalSize)}</span> : null}
                                        </div>
                                    </div>
                                    <div className={styles['card-actions']}>
                                        <button type="button" className={styles['btn-sm']} onClick={() => act(t.id, paused ? 'resume' : 'pause')}>{paused ? 'Resume' : 'Pause'}</button>
                                        {admin ? <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => act(t.id, 'delete')}>Cancel</button> : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <h2 className={styles['section']}>Monitored shows <span className={styles['count']}>{monitored.length}</span></h2>
                    <div className={styles['hint']}>Sentinel checks every 2 hours and downloads new episodes automatically.</div>
                    {monitored.length === 0 ? <div className={styles['empty']}>No shows are being monitored. Turn on auto-download from a show’s page.</div> : null}
                    <div className={styles['list']}>
                        {monitored.map((m) => (
                            <div key={m.imdbId} className={styles['card']}>
                                <Thumb src={m.poster || `https://images.metahub.space/poster/small/${m.imdbId}/img`} title={m.title} />
                                <div className={styles['card-main']}>
                                    <div className={styles['card-title']}>{m.title}</div>
                                    <div className={styles['card-meta']}>
                                        <span title="What Sentinel is allowed to download for this show. Change it on the show's page.">{m.scopeLabel || 'All seasons'}</span>
                                        <span>Auto-download · {profileOf(m) ? profileOf(m).name : (m.quality || '1080p')}</span>
                                        <span>{typeof m.onDiskEpisodes === 'number' ? `${m.onDiskEpisodes} episodes on disk` : `${(m.downloadedEpisodes || []).length} episodes recorded`}</span>
                                        {m.skippedCount > 0 ? <span title="Deleted from the server. Sentinel will not download them again unless you ask.">{m.skippedCount} removed · not re-downloading</span> : null}
                                    </div>
                                </div>
                                {admin ?
                                    <div className={styles['card-actions']}>
                                        {profiles.length > 0 ?
                                            <select className={styles['profile-select']} value={m.profileId === null || m.profileId === undefined ? '' : m.profileId} onChange={(e) => changeProfile(m, e.target.value)} title="Quality profile for this show">
                                                <option value="">Default{defaultProfile ? ` (${defaultProfile.name})` : ''}</option>
                                                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                            : null}
                                        {m.skippedCount > 0 ? <button type="button" className={styles['btn-sm']} onClick={() => redownload(m)}>Re-download {m.skippedCount}</button> : null}
                                        <button type="button" className={styles['btn-sm']} disabled={busy === m.imdbId} onClick={() => checkNow(m.imdbId)}>{busy === m.imdbId ? 'Checking…' : 'Check now'}</button>
                                        <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => stopMonitoring(m.imdbId)}>Stop</button>
                                    </div>
                                    : null}
                            </div>
                        ))}
                    </div>

                    <h2 className={styles['section']}>Recently completed <span className={styles['count']}>{recent.length}</span></h2>
                    {recent.length === 0 ? <div className={styles['empty']}>No finished downloads yet.</div> : null}
                    <div className={styles['list']}>
                        {recent.map((d) => (
                            <button key={d.id} type="button" className={classnames(styles['card'], styles['clickable'])} onClick={() => openOnServer(d)}>
                                <Thumb src={d.poster} title={d.title} />
                                <div className={styles['card-main']}>
                                    <div className={styles['card-title']}>{d.title}</div>
                                    <div className={styles['card-meta']}>
                                        <span>{formatBytes(d.totalSize)}</span>
                                        <span>{when(d.completedAt || d.addedAt)}</span>
                                    </div>
                                </div>
                                <span className={styles['go']}>Open →</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </MainNavBars>
    );
};

module.exports = Downloads;
