// Copyright (C) 2017-2026 HomeBot Cinema
// Admin dashboard. Only rendered for the admin login; every API behind it is admin-only too.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { MainNavBars } = require('stremio/components');
const PageHeader = require('stremio/components/PageHeader');
const { api, formatBytes, isAdmin } = require('stremio/common/serverApi');
const useServerEvents = require('stremio/common/useServerEvents');
const QualityProfiles = require('./QualityProfiles');
const styles = require('./styles');

const TABS = [['overview', 'Overview'], ['people', 'People'], ['quality', 'Quality profiles'], ['library', 'Library'], ['activity', 'Activity log']];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(s >= 0)) return '';
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
};

const Stat = ({ label, value, sub, children }) => (
    <div className={styles['stat']}>
        <div className={styles['stat-label']}>{label}</div>
        <div className={styles['stat-value']}>{value}</div>
        {sub ? <div className={styles['stat-sub']}>{sub}</div> : null}
        {children}
    </div>
);
Stat.propTypes = { label: PropTypes.string, value: PropTypes.node, sub: PropTypes.node, children: PropTypes.node };

const Overview = ({ o }) => {
    const pct = o.storage.totalBytes ? Math.round((o.storage.usedBytes / o.storage.totalBytes) * 100) : 0;
    const max = Math.max(1, ...o.library.biggest.map((b) => b.totalSize));
    return (
        <>
            <div className={styles['stats']}>
                <Stat label="Storage" value={`${pct}%`} sub={`${formatBytes(o.storage.usedBytes)} of ${formatBytes(o.storage.totalBytes)} · ${formatBytes(o.storage.freeBytes)} free`}>
                    <div className={styles['track']}><div className={classnames(styles['fill'], { [styles['hot']]: pct >= 90 })} style={{ width: `${pct}%` }} /></div>
                </Stat>
                <Stat label="Library" value={plural(o.library.titles, 'title')} sub={`${o.library.movies} movies · ${o.library.series} shows · ${formatBytes(o.library.totalBytes)}`} />
                <Stat label="Downloads" value={`${o.downloads.active} active`} sub={`${o.downloads.completed} completed`} />
                <Stat label="Sentinel" value={plural(o.sentinel.monitoredShows, 'show')} sub="auto-downloading new episodes" />
                <Stat label="Streaming" value={o.streaming ? plural(o.streaming.torrents, 'torrent') : 'unavailable'} sub="handled by the streaming server" />
                <Stat label="People" value={plural(o.people.logins, 'login')} sub={plural(o.people.profiles, 'profile')} />
            </div>
            <h2 className={styles['section']}>Largest titles</h2>
            {o.library.biggest.map((b) => (
                <a key={b.id} className={styles['bar-row']} href={`#/server/${b.id}`}>
                    <span className={styles['bar-name']}>{b.title}</span>
                    <span className={styles['bar-track']}><span className={styles['bar-fill']} style={{ width: `${Math.max(2, (b.totalSize / max) * 100)}%` }} /></span>
                    <span className={styles['bar-size']}>{formatBytes(b.totalSize)}</span>
                </a>
            ))}
            {o.downloads.activeList.length ? <h2 className={styles['section']}>Downloading now</h2> : null}
            {o.downloads.activeList.map((d) => (
                <div key={d.id} className={styles['bar-row']}>
                    <span className={styles['bar-name']}>{d.title}</span>
                    <span className={styles['bar-track']}><span className={styles['bar-fill']} style={{ width: `${Math.round((d.progress || 0) * 100)}%` }} /></span>
                    <span className={styles['bar-size']}>{Math.round((d.progress || 0) * 100)}%</span>
                </div>
            ))}
        </>
    );
};
Overview.propTypes = { o: PropTypes.object.isRequired };

const People = ({ onError }) => {
    const [logins, setLogins] = React.useState([]);
    const [profiles, setProfiles] = React.useState([]);
    const load = React.useCallback(async () => {
        try {
            const [l, p] = await Promise.all([api('GET', '/api/admin/logins'), api('GET', '/api/profiles')]);
            setLogins(l);
            setProfiles(p);
        } catch (e) {
            onError(e.message);
        }
    }, [onError]);
    React.useEffect(() => { load(); }, [load]);
    const patch = async (email, body) => {
        try {
            await api('PATCH', `/api/admin/logins/${encodeURIComponent(email)}`, body);
            load();
        } catch (e) {
            onError(e.message);
        }
    };
    const run = async (fn) => {
        try {
            await fn();
            load();
        } catch (e) {
            onError(e.message);
        }
    };
    return (
        <>
            <h2 className={styles['section']}>Logins <span className={styles['count']}>{logins.length}</span></h2>
            <div className={styles['hint']}>Everyone who has signed in through Cloudflare. Disabled logins are refused by the server.</div>
            <div className={styles['table']}>
                {logins.map((l) => (
                    <div key={l.email} className={styles['trow']}>
                        <div className={styles['tmain']}>{l.email}{l.isAdmin ? <span className={styles['tag']}>Admin</span> : null}</div>
                        <div className={styles['tmeta']}>last seen {ago(l.lastSeen)}</div>
                        <label className={styles['quota']}>
                            Quota GB
                            <input
                                type="number"
                                min="0"
                                placeholder="none"
                                defaultValue={l.quotaGb === null ? '' : l.quotaGb}
                                onBlur={(e) => { if (String(l.quotaGb ?? '') !== e.target.value) patch(l.email, { quotaGb: e.target.value === '' ? null : Number(e.target.value) }); }}
                            />
                        </label>
                        {l.isAdmin ? <span /> : <button type="button" className={classnames(styles['btn-sm'], { [styles['danger']]: !l.disabled })} onClick={() => patch(l.email, { disabled: !l.disabled })}>{l.disabled ? 'Enable' : 'Disable'}</button>}
                    </div>
                ))}
            </div>
            <h2 className={styles['section']}>Profiles <span className={styles['count']}>{profiles.length}</span></h2>
            <div className={styles['table']}>
                {profiles.map((p) => (
                    <div key={p.id} className={styles['trow']}>
                        <img className={styles['avatar']} src={p.avatar} alt="" />
                        <div className={styles['tmain']}>{p.name}{p.isKid ? <span className={styles['tag']}>Kids</span> : null}{p.hasPin ? <span className={styles['tag']}>PIN</span> : null}</div>
                        <span />
                        <span className={styles['row-actions']}>
                            {p.hasPin ? <button type="button" className={styles['btn-sm']} onClick={() => run(() => api('POST', `/api/profiles/${p.id}/pin/remove`, {}))}>Reset PIN</button> : null}
                            <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => window.confirm(`Delete profile "${p.name}" and its library?`) && run(() => api('DELETE', `/api/profiles/${p.id}`))}>Delete</button>
                        </span>
                    </div>
                ))}
            </div>
        </>
    );
};
People.propTypes = { onError: PropTypes.func.isRequired };

const LibraryTab = ({ o, onScan }) => (
    <>
        <h2 className={styles['section']}>Library scanner</h2>
        <div className={styles['panel']}>
            <div>
                {o.library.scan.running ? 'Scanning…' : o.library.scan.finishedAt ? `Last scan ${ago(o.library.scan.finishedAt)}` : 'No scan has run yet'}
                {' · '}{o.library.fileCount} video files · {o.library.titles} titles · <b>{o.library.unmatched}</b> unmatched
            </div>
            <div className={styles['panel-actions']}>
                <button type="button" className={styles['btn']} disabled={o.library.scan.running} onClick={onScan}>⟳ Scan now</button>
                <a className={styles['btn']} href="#/server">Review titles{o.library.unmatched ? ` (${o.library.unmatched} unmatched)` : ''}</a>
            </div>
        </div>
        <div className={styles['hint']}>The scanner runs every 30 minutes. It groups files by their parsed names and never moves or renames anything on disk. Unmatched titles can be fixed with “Identify” on the title’s page.</div>
    </>
);
LibraryTab.propTypes = { o: PropTypes.object.isRequired, onScan: PropTypes.func.isRequired };

const Activity = ({ onError }) => {
    const [rows, setRows] = React.useState([]);
    React.useEffect(() => { api('GET', '/api/admin/audit?limit=100').then(setRows).catch((e) => onError(e.message)); }, [onError]);
    return (
        <>
            <h2 className={styles['section']}>Activity log <span className={styles['count']}>{rows.length}</span></h2>
            {rows.length === 0 ? <div className={styles['empty']}>Nothing recorded yet.</div> : null}
            <div className={styles['table']}>
                {rows.map((r) => (
                    <div key={r.id} className={classnames(styles['trow'], styles['log'])}>
                        <div className={styles['tmeta']}>{ago(r.ts)}</div>
                        <div className={styles['tmain']}><b>{r.action}</b> <span className={styles['tmeta']}>{r.email || ''}</span></div>
                        <div className={styles['payload']}>{r.payload ? JSON.stringify(r.payload).slice(0, 140) : ''}</div>
                    </div>
                ))}
            </div>
        </>
    );
};
Activity.propTypes = { onError: PropTypes.func.isRequired };

const Admin = () => {
    const admin = isAdmin();
    const [tab, setTab] = React.useState('overview');
    const [o, setO] = React.useState(null);
    const [error, setError] = React.useState('');
    const loadOverview = React.useCallback(() => api('GET', '/api/admin/overview').then((d) => { setO(d); setError(''); }).catch((e) => setError(e.message)), []);

    React.useEffect(() => {
        if (!admin) return;
        loadOverview();
        // live transcodes come from the streaming server and have no event: a slow refresh covers those
        const t = setInterval(() => { if (document.visibilityState === 'visible') loadOverview(); }, 15000);
        return () => clearInterval(t);
    }, [admin, loadOverview]);
    useServerEvents(['downloads', 'library', 'sentinel'], loadOverview, { fallbackMs: 5000, enabled: admin });

    const scan = async () => {
        try {
            await api('POST', '/api/library/scan');
            loadOverview();
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <MainNavBars className={styles['route']} route={'admin'}>
            <div className={styles['scroll']}>
                <div className={styles['page']}>
                    <PageHeader eyebrow="HomeBot Cinema" title="Admin" subtitle={admin ? 'Server health, people and library maintenance' : 'This area is for administrators.'} />
                    {!admin ? null : (
                        <>
                            <div className={styles['tabs']}>
                                {TABS.map(([id, label]) => (
                                    <button key={id} type="button" className={classnames(styles['tab'], { [styles['active']]: tab === id })} onClick={() => setTab(id)}>{label}</button>
                                ))}
                            </div>
                            {error ? <div className={styles['error']}>{error}</div> : null}
                            {tab === 'overview' && o ? <Overview o={o} /> : null}
                            {tab === 'people' ? <People onError={setError} /> : null}
                            {tab === 'quality' ? <QualityProfiles onError={setError} /> : null}
                            {tab === 'library' && o ? <LibraryTab o={o} onScan={scan} /> : null}
                            {tab === 'activity' ? <Activity onError={setError} /> : null}
                            {!o && tab !== 'people' && tab !== 'activity' && tab !== 'quality' && !error ? <div className={styles['empty']}>Loading…</div> : null}
                        </>
                    )}
                </div>
            </div>
        </MainNavBars>
    );
};

module.exports = Admin;
