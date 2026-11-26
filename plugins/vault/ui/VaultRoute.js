// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault": #/vault?f=<folder>. Passcode first, then the folder: sub-folders and videos with thumbnails, search,
// sort, play, delete and Lock. Videos play through the bare player route named "Locked folder", so the core keeps no
// library item (nothing in Continue watching, Library, Calendar, stats or the copilot) and nothing names them on screen.

const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate, useLocation } = require('react-router');
const { useCore } = require('stremio/core');
const { MainNavBars } = require('stremio/components');
const PageHeader = require('stremio/components/PageHeader');
const { formatBytes } = require('stremio/common/serverApi');
const { confirmDialog } = require('stremio/common/dialogs');
const { crumbs, duration, canPlayHere, formatDate } = require('./logic');
const V = require('./vaultState');
const Passcode = require('./Passcode');
const styles = require('./styles.less');

const PAGE = 200;
const isDesktopApp = () => typeof window !== 'undefined' && typeof window.qt !== 'undefined';

const Thumb = ({ id, label }) => {
    const [src, setSrc] = React.useState(null);
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => {
        if (!id) return undefined;
        let revoked = null;
        const ac = new AbortController();
        setFailed(false);
        V.fetchThumbUrl(id, ac.signal)
            .then((url) => { revoked = url; setSrc(url); })
            .catch(() => { if (!ac.signal.aborted) setFailed(true); });
        return () => {
            ac.abort();
            if (revoked) URL.revokeObjectURL(revoked);
        };
    }, [id]);
    if (failed || !id) return <div className={styles['thumb-empty']}>{label}</div>;
    if (!src) return <div className={styles['thumb-empty']} />;
    return <img className={styles['thumb-img']} src={src} alt="" onError={() => setFailed(true)} />;
};
Thumb.propTypes = { id: PropTypes.number, label: PropTypes.string };

const VaultBrowser = ({ folder, autolockMin }) => {
    const navigate = useNavigate();
    const core = useCore();
    const [data, setData] = React.useState(null);
    const [error, setError] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [q, setQ] = React.useState('');
    const [sort, setSort] = React.useState('date');
    const [limit, setLimit] = React.useState(PAGE);

    React.useEffect(() => {
        const t = setTimeout(() => setQ(query.trim()), 250);
        return () => clearTimeout(t);
    }, [query]);
    React.useEffect(() => { setLimit(PAGE); }, [folder, q, sort]);

    const load = React.useCallback(async () => {
        try {
            const p = new URLSearchParams({ folder, sort, limit: String(limit) });
            if (q) p.set('q', q);
            setData(await V.vaultApi('GET', `/api/vault/browse?${p}`));
            setError('');
        } catch (e) {
            if (e.message !== 'vault_locked') setError(e.message);
        }
    }, [folder, q, sort, limit]);
    React.useEffect(() => { load(); }, [load]);

    // auto-lock on this screen after a while without input (the server locks idle sessions too)
    React.useEffect(() => {
        const onInput = () => V.touch();
        const evs = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
        evs.forEach((ev) => window.addEventListener(ev, onInput, { passive: true }));
        const t = setInterval(() => { if (V.idleFor() > autolockMin * 60 * 1000) V.lock(); }, 15000);
        return () => {
            evs.forEach((ev) => window.removeEventListener(ev, onInput));
            clearInterval(t);
        };
    }, [autolockMin]);

    const openFolder = (path) => navigate(path ? `/vault?f=${encodeURIComponent(path)}` : '/vault');

    const play = async (file) => {
        try {
            const link = await V.vaultApi('GET', `/api/vault/link/${file.id}`);
            if (!canPlayHere({ webPlayable: link.webPlayable, desktop: isDesktopApp() })) {
                setError('This video’s format plays in the Mac app, not in a browser.');
                return;
            }
            const encoded = await core.transport.encodeStream({
                name: 'Locked folder',
                description: '',
                url: `${window.location.origin}${link.url}`,
                behaviorHints: { notWebReady: false },
            });
            if (typeof encoded === 'string') navigate(`/player/${encodeURIComponent(encoded)}`);
        } catch (e) {
            if (e.message !== 'vault_locked') setError(e.message);
        }
    };

    const remove = async (file) => {
        const ok = await confirmDialog({ title: `Delete "${file.name}"?`, message: 'It is deleted from the drive. This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try {
            await V.vaultApi('DELETE', `/api/vault/files/${file.id}`);
            load();
        } catch (e) {
            if (e.message !== 'vault_locked') setError(e.message);
        }
    };

    const rescan = async () => {
        try {
            await V.vaultApi('POST', '/api/vault/rescan', {});
            setTimeout(load, 1500);
        } catch (e) {
            if (e.message !== 'vault_locked') setError(e.message);
        }
    };

    const path = crumbs(folder);
    const title = q ? `Search: ${q}` : path[path.length - 1].name;
    const files = data ? data.files : [];
    const folders = data ? data.folders : [];

    return (
        <div className={styles['page']}>
            <PageHeader
                eyebrow="Locked folder"
                title={title}
                subtitle={data ? `${folders.length ? `${folders.length} folder${folders.length === 1 ? '' : 's'} · ` : ''}${files.length} video${files.length === 1 ? '' : 's'}` : 'Loading…'}
                actions={
                    <>
                        <button type="button" className={styles['btn']} onClick={rescan}>⟳ Rescan</button>
                        <button type="button" className={styles['btn-lock']} onClick={() => V.lock()}>🔒 Lock</button>
                    </>
                }
            />
            <div className={styles['toolbar']}>
                <nav className={styles['crumbs']} aria-label="Folder">
                    {path.map((c, i) => (
                        <React.Fragment key={c.path}>
                            {i ? <span className={styles['crumb-sep']}>/</span> : null}
                            <button type="button" className={styles['crumb']} disabled={i === path.length - 1 && !q} onClick={() => { setQuery(''); openFolder(c.path); }}>{c.name}</button>
                        </React.Fragment>
                    ))}
                </nav>
                <input className={styles['search']} placeholder="Search every video…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select className={styles['select']} value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="date">Newest</option>
                    <option value="name">A – Z</option>
                    <option value="size">Largest</option>
                    <option value="length">Longest</option>
                </select>
            </div>
            {data && !data.online ? <div className={styles['notice']}>The drive is not connected right now: you can browse, but videos will not play.</div> : null}
            {error ? <div className={styles['error']}>{error}</div> : null}
            {folders.length ? (
                <div className={styles['folders']}>
                    {folders.map((f) => (
                        <button key={f.path} type="button" className={styles['folder']} onClick={() => openFolder(f.path)}>
                            <div className={styles['thumb']}><Thumb id={f.coverId} label="📁" /><span className={styles['folder-badge']}>📁 {f.count}</span></div>
                            <div className={styles['name']}>{f.name}</div>
                        </button>
                    ))}
                </div>
            ) : null}
            <div className={styles['videos']}>
                {files.map((f) => (
                    <div key={f.id} className={styles['video']}>
                        <button type="button" className={styles['video-open']} onClick={() => play(f)} title={f.name}>
                            <div className={styles['thumb']}>
                                <Thumb id={f.id} label="▶" />
                                {f.durationMs ? <span className={styles['duration']}>{duration(f.durationMs)}</span> : null}
                                {f.positionMs && f.durationMs ? <span className={styles['resume']} style={{ width: `${Math.min(100, (f.positionMs / f.durationMs) * 100)}%` }} /> : null}
                            </div>
                            <div className={styles['name']}>{f.name}</div>
                            <div className={styles['meta']}>{[q ? f.folder : null, formatDate(f.mtime), formatBytes(f.size)].filter(Boolean).join(' · ')}</div>
                        </button>
                        <button type="button" className={styles['delete']} aria-label={`Delete ${f.name}`} onClick={() => remove(f)}>🗑</button>
                    </div>
                ))}
            </div>
            {data && !q && files.length >= limit ? <button type="button" className={styles['btn']} onClick={() => setLimit((l) => l + PAGE)}>Show more</button> : null}
            {data && !folders.length && !files.length ? <div className={styles['empty']}>{q ? 'No video matches.' : 'Nothing here yet.'}</div> : null}
        </div>
    );
};
VaultBrowser.propTypes = { folder: PropTypes.string, autolockMin: PropTypes.number };

const VaultRoute = () => {
    const location = useLocation();
    const folder = new URLSearchParams(location.search || '').get('f') || '';
    const [token, setTokenState] = React.useState(V.getToken());
    const [status, setStatus] = React.useState(null);
    const [error, setError] = React.useState('');

    React.useEffect(() => V.subscribe(setTokenState), []);
    const loadStatus = React.useCallback(() => {
        V.vaultApi('GET', '/api/vault/status')
            .then((s) => {
                setStatus(s);
                if (!s.unlocked && V.getToken()) V.setToken(null);
            })
            .catch((e) => setError(e.message === 'admin_only' ? 'Only the admin on the main profile can open the Locked folder.' : e.message));
    }, []);
    React.useEffect(() => { loadStatus(); }, [loadStatus, token]);

    return (
        <MainNavBars className={styles['route']} route={'library'}>
            <div className={styles['scroll']}>
                {error ? <div className={styles['page']}><div className={styles['error']}>{error}</div></div> : null}
                {!error && status && !token ? <Passcode status={status} onDone={loadStatus} /> : null}
                {!error && status && token ? <VaultBrowser folder={folder} autolockMin={status.autolockMin || 10} /> : null}
                {!error && !status ? <div className={styles['page']}><div className={styles['empty']}>Loading…</div></div> : null}
            </div>
        </MainNavBars>
    );
};

module.exports = VaultRoute;
