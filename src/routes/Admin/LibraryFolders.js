// Copyright (C) 2017-2026 HomeBot Cinema
// Admin > Library: the folders the library scans. /Movies and /TV come from the server config; more folders can be added
// here (any folder the container can see, inside MEDIA_ROOTS), each scanned on its own or with everything else.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api, formatBytes } = require('stremio/common/serverApi');
const useServerEvents = require('stremio/common/useServerEvents');
const { confirmDialog } = require('stremio/common/dialogs');
const styles = require('./styles');

const TYPE_LABEL = { movie: 'Movies', series: 'Series' };
const KIND_LABEL = { base: 'Server setting', folder: 'Added here', cold: 'Cloud drive' };

const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!(s >= 0)) return '';
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
};

function scanText(f) {
    if (!f.online) return f.kind === 'cold' ? 'Drive not connected' : 'Folder not found';
    if (f.scan && f.scan.running) return 'Scanning…';
    if (f.scan && f.scan.error) return `Last scan failed: ${f.scan.error}`;
    if (f.scan && f.scan.finishedAt) return `Scanned ${ago(f.scan.finishedAt)}`;
    return 'Not scanned yet';
}

const FolderPicker = ({ onAdd, onCancel, onError }) => {
    const [at, setAt] = React.useState(null); // { path, parent, dirs, isRoot }
    const [type, setType] = React.useState('movie');
    const [busy, setBusy] = React.useState(false);

    const open = React.useCallback(async (p) => {
        try {
            setAt(await api('GET', `/api/library/browse${p ? `?path=${encodeURIComponent(p)}` : ''}`));
        } catch (e) {
            onError(e.message);
        }
    }, [onError]);
    React.useEffect(() => { open(''); }, [open]);

    const add = async () => {
        if (!at || !at.path) return;
        setBusy(true);
        try {
            await onAdd({ path: at.path, type });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles['folder-picker']}>
            <div className={styles['picker-head']}>
                <button type="button" className={styles['btn-sm']} disabled={!at || !at.path} onClick={() => open(at && at.parent ? at.parent : '')}>↑ Up</button>
                <div className={styles['picker-path']} title={at && at.path ? at.path : ''}>{at && at.path ? at.path : 'Folders the server can see'}</div>
            </div>
            <div className={styles['dir-list']}>
                {at && at.dirs.length === 0 ? <div className={styles['hint']}>No folders inside.</div> : null}
                {at ? at.dirs.map((d) => (
                    <button key={d.path} type="button" className={styles['dir']} onClick={() => open(d.path)}>
                        <span className={styles['dir-name']}>📁 {d.name}</span>
                        {d.isRoot ? <span className={styles['tag']}>In library</span> : null}
                    </button>
                )) : <div className={styles['hint']}>Loading…</div>}
            </div>
            <div className={styles['picker-foot']}>
                <label className={styles['type-choice']}>
                    Contains
                    <select className={styles['input']} value={type} onChange={(e) => setType(e.target.value)}>
                        <option value="movie">Movies</option>
                        <option value="series">Series</option>
                    </select>
                </label>
                <span className={styles['panel-actions']}>
                    <button type="button" className={styles['btn']} onClick={onCancel}>Cancel</button>
                    <button type="button" className={styles['btn-white']} disabled={busy || !at || !at.path || at.isRoot} onClick={add}>Add this folder</button>
                </span>
            </div>
        </div>
    );
};
FolderPicker.propTypes = { onAdd: PropTypes.func.isRequired, onCancel: PropTypes.func.isRequired, onError: PropTypes.func.isRequired };

const LibraryFolders = ({ onError }) => {
    const [data, setData] = React.useState(null);
    const [picking, setPicking] = React.useState(false);

    const load = React.useCallback(() => api('GET', '/api/library/folders').then(setData).catch((e) => onError(e.message)), [onError]);
    React.useEffect(() => { load(); }, [load]);
    useServerEvents(['library'], load, { fallbackMs: 10000 });
    // while a scan runs, refresh until it is done (scans report no progress events)
    const running = !!(data && (data.scanning || data.folders.some((f) => f.scan && f.scan.running)));
    React.useEffect(() => {
        if (!running) return undefined;
        const t = setInterval(load, 2000);
        return () => clearInterval(t);
    }, [running, load]);

    const act = async (fn) => {
        onError('');
        try {
            await fn();
        } catch (e) {
            onError(e.message);
        }
        load();
    };
    const scanOne = (f) => act(() => api('POST', '/api/library/scan', { path: f.path }));
    const remove = async (f) => {
        const ok = await confirmDialog({
            title: `Stop scanning ${f.label || f.path}?`,
            message: 'Its titles leave the library. Nothing on disk is deleted, and you can add the folder again later.',
            confirmLabel: 'Remove folder', danger: true,
        });
        if (ok) act(() => api('DELETE', `/api/library/folders/${f.id}`));
    };
    const add = (body) => act(async () => {
        await api('POST', '/api/library/folders', body);
        setPicking(false);
    });

    return (
        <>
            <h2 className={styles['section']}>Folders <span className={styles['count']}>{data ? data.folders.length : ''}</span></h2>
            <div className={styles['table']}>
                {data ? data.folders.map((f) => (
                    <div key={f.path} className={classnames(styles['trow'], styles['folder-row'])}>
                        <div className={styles['tmain']}>
                            <span className={styles['folder-path']} title={f.path}>{f.label ? `${f.label} · ${f.path}` : f.path}</span>
                            <span className={styles['tag']}>{TYPE_LABEL[f.type] || f.type}</span>
                        </div>
                        <div className={styles['tmeta']}>{KIND_LABEL[f.kind] || f.kind} · {f.files} files · {formatBytes(f.bytes)} · {scanText(f)}</div>
                        <span className={styles['row-actions']}>
                            <button type="button" className={styles['btn-sm']} disabled={running || !f.online} onClick={() => scanOne(f)}>Scan</button>
                            {f.kind === 'folder' ? <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => remove(f)}>Remove</button> : null}
                        </span>
                    </div>
                )) : <div className={styles['empty']}>Loading…</div>}
            </div>
            {picking
                ? <FolderPicker onAdd={add} onCancel={() => setPicking(false)} onError={onError} />
                : <div className={styles['panel-actions']}><button type="button" className={styles['btn']} onClick={() => setPicking(true)}>+ Add folder</button></div>}
            <div className={styles['hint']}>
                A folder must be visible to the server before it can be added: in Docker, mount it into the container and list it in MEDIA_ROOTS.
                A folder inside /Movies or /TV can be added too, for example to read an anime folder as series.
            </div>
        </>
    );
};
LibraryFolders.propTypes = { onError: PropTypes.func.isRequired };

module.exports = LibraryFolders;
