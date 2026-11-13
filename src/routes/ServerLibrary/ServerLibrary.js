// Copyright (C) 2017-2026 HomeBot Cinema
// "On your server": one card per movie/show found in /Movies and /TV (Jellyfin-style).

const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate } = require('react-router');
const classnames = require('classnames');
const PageHeader = require('stremio/components/PageHeader');
const { api, formatBytes, isAdmin } = require('stremio/common/serverApi');
const useServerEvents = require('stremio/common/useServerEvents');
const { markSeen } = require('stremio/common/newOnServer');
const styles = require('./styles');

const TABS = [
    { id: 'all', label: 'All', count: 'all' },
    { id: 'movie', label: 'Movies', count: 'movie' },
    { id: 'series', label: 'Series', count: 'series' }
];

const Card = ({ item }) => {
    const [imgFailed, setImgFailed] = React.useState(false);
    const sub = item.type === 'series' ?
        `${item.seasons.length} season${item.seasons.length === 1 ? '' : 's'} · ${item.episodeCount} ep`
        :
        [item.year, formatBytes(item.totalSize)].filter(Boolean).join(' · ');
    return (
        <a className={styles['card']} href={`#/server/${item.id}`} title={item.title}>
            <div className={styles['poster']}>
                {item.poster && !imgFailed ?
                    <img src={item.poster} alt="" loading="lazy" onError={() => setImgFailed(true)} />
                    :
                    <div className={styles['no-art']}>{item.title}</div>}
                <span className={styles['badge']}>On Server</span>
                {!item.matched ? <span className={classnames(styles['badge'], styles['warn'])}>Unmatched</span> : null}
            </div>
            <div className={styles['card-title']}>{item.title}</div>
            <div className={styles['card-sub']}>{sub}</div>
        </a>
    );
};

Card.propTypes = { item: PropTypes.object.isRequired };

const ServerLibrary = () => {
    const navigate = useNavigate();
    const admin = isAdmin();
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState('');
    const [tab, setTab] = React.useState('all');
    const [query, setQuery] = React.useState('');
    const [q, setQ] = React.useState('');
    const [sort, setSort] = React.useState('recent');
    const [scan, setScan] = React.useState(null);

    React.useEffect(() => {
        const t = setTimeout(() => setQ(query.trim()), 250);
        return () => clearTimeout(t);
    }, [query]);

    const load = React.useCallback(async () => {
        const p = new URLSearchParams();
        if (tab === 'movie' || tab === 'series') p.set('type', tab);
        if (tab === 'unmatched') p.set('unmatched', '1');
        if (q) p.set('q', q);
        p.set('sort', sort);
        try {
            setData(await api('GET', `/api/library?${p}`));
            setError('');
        } catch (e) {
            setError(e.message);
        }
    }, [tab, q, sort]);
    React.useEffect(() => { load(); }, [load]);
    // new downloads, deletes and finished scans refresh the grid
    useServerEvents(['library'], load);
    // opening the server library clears the "new" badge for this profile
    React.useEffect(() => { markSeen(); }, []);

    // poll while a scan runs, then refresh the grid
    React.useEffect(() => {
        if (!scan || !scan.running) return;
        const t = setInterval(async () => {
            try {
                const st = await api('GET', '/api/library/scan/status');
                setScan(st);
                if (!st.running) load();
            } catch (_) {
                setScan(null);
            }
        }, 2000);
        return () => clearInterval(t);
    }, [scan, load]);

    const startScan = async () => {
        try {
            setScan(await api('POST', '/api/library/scan'));
        } catch (e) {
            setError(e.message);
        }
    };
    const randomPick = () => {
        if (data && data.items.length) navigate(`/server/${data.items[Math.floor(Math.random() * data.items.length)].id}`);
    };

    const counts = data ? data.counts : { all: 0, movie: 0, series: 0, unmatched: 0 };
    const total = data ? data.items.reduce((a, i) => a + i.totalSize, 0) : 0;
    const tabs = admin && counts.unmatched > 0 ? [...TABS, { id: 'unmatched', label: 'Unmatched', count: 'unmatched' }] : TABS;

    return (
        <div className={styles['page']}>
            <div className={styles['switch']}>
                <a href="#/library">Your library</a>
                <span className={styles['on']}>On server</span>
            </div>
            <PageHeader
                eyebrow="HomeBot Cinema"
                title="On your server"
                subtitle={data ? `${counts.all} title${counts.all === 1 ? '' : 's'} · ${formatBytes(total)} on disk` : 'Loading…'}
                actions={
                    <>
                        <button type="button" className={styles['btn']} onClick={randomPick}>🎲 Random pick</button>
                        {admin ?
                            <button type="button" className={styles['btn']} disabled={!!(scan && scan.running)} onClick={startScan}>
                                {scan && scan.running ? 'Scanning…' : '⟳ Scan library'}
                            </button>
                            : null}
                    </>
                }
            />
            <div className={styles['toolbar']}>
                <div className={styles['tabs']}>
                    {tabs.map((t) => (
                        <button key={t.id} type="button" className={classnames(styles['tab'], { [styles['active']]: tab === t.id })} onClick={() => setTab(t.id)}>
                            {t.label} <span className={styles['count']}>{counts[t.count]}</span>
                        </button>
                    ))}
                </div>
                <input className={styles['search']} placeholder="Filter titles…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select className={styles['select']} value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="recent">Recently added</option>
                    <option value="az">A – Z</option>
                    <option value="size">Largest</option>
                </select>
            </div>
            {error ? <div className={styles['error']}>{error}</div> : null}
            {data && data.items.length === 0 ?
                <div className={styles['empty']}>
                    {counts.all === 0 ? 'Nothing found in /Movies or /TV yet.' : 'No titles match this filter.'}
                </div>
                : null}
            <div className={styles['grid']}>
                {data ? data.items.map((item) => <Card key={item.id} item={item} />) : null}
            </div>
        </div>
    );
};

module.exports = ServerLibrary;
