// Copyright (C) 2017-2026 HomeBot Cinema
// A movie or show on the server: seasons, episodes, files, and the actions on them.

const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate } = require('react-router');
const classnames = require('classnames');
const { useCore } = require('stremio/core');
const { api, playServerFile, openInVlc, streamUrl, formatBytes, isAdmin } = require('stremio/common/serverApi');
const styles = require('./styles');

const FileRow = ({ file, label, onPlay, onVlc, onDelete, admin }) => (
    <div className={styles['row']}>
        <div className={styles['ep-chip']}>{label}</div>
        <div className={styles['row-main']}>
            <div className={styles['row-name']} title={file.name}>{file.name}</div>
            <div className={styles['row-meta']}>
                {[file.resolution, file.codec, formatBytes(file.size)].filter(Boolean).map((m) => <span key={m} className={styles['chip']}>{m}</span>)}
            </div>
        </div>
        <div className={styles['row-actions']}>
            <button type="button" className={styles['btn-primary-sm']} onClick={() => onPlay(file)}>▶ Play</button>
            <button type="button" className={styles['btn-sm']} onClick={() => onVlc(file)}>VLC</button>
            <a className={styles['btn-sm']} href={`${streamUrl(file.streamId)}?download=1`} download>Save</a>
            {admin ? <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => onDelete(file)}>Delete</button> : null}
        </div>
    </div>
);
FileRow.propTypes = { file: PropTypes.object, label: PropTypes.string, onPlay: PropTypes.func, onVlc: PropTypes.func, onDelete: PropTypes.func, admin: PropTypes.bool };

const has = (v) => v !== null && v !== undefined;

const ServerTitle = ({ id }) => {
    const core = useCore();
    const navigate = useNavigate();
    const admin = isAdmin();
    const [item, setItem] = React.useState(null);
    const [error, setError] = React.useState('');
    const [season, setSeason] = React.useState(null);
    const [bgFailed, setBgFailed] = React.useState(false);

    const load = React.useCallback(async () => {
        try {
            const d = await api('GET', `/api/library/${id}`);
            setItem(d);
            setSeason((s) => (has(s) && d.seasons && d.seasons.some((x) => x.season === s) ? s : (d.seasons && d.seasons[0] ? d.seasons[0].season : null)));
            setError('');
        } catch (e) {
            if (e.status === 404) navigate('/server', { replace: true });
            else setError(e.message);
        }
    }, [id, navigate]);
    React.useEffect(() => { load(); }, [load]);

    if (!item) return <div className={styles['page']}>{error ? <div className={styles['error']}>{error}</div> : <div className={styles['empty']}>Loading…</div>}</div>;

    const play = (file, label) => playServerFile(core, navigate, file.streamId, `${item.title}${label ? ` ${label}` : ''}`, {
        type: item.type, imdbId: item.matched ? item.imdbId : null, season: file.season, episode: file.episode,
    }).catch((e) => setError(e.message));
    const vlc = (file) => openInVlc(file.streamId).catch((e) => setError(e.message));
    const guard = async (fn) => {
        try {
            await fn();
            await load();
        } catch (e) {
            setError(e.message);
        }
    };
    const delFile = (file) => window.confirm(`Delete "${file.name}" from the server? This cannot be undone.`) && guard(() => api('DELETE', `/api/library/files/${file.id}`));
    const delSeason = (s) => window.confirm(`Delete all of season ${s} of ${item.title} from the server?`) && guard(() => api('DELETE', `/api/library/${item.id}/season/${s}`));
    const delItem = async () => {
        if (!window.confirm(`Delete ALL of "${item.title}" (${formatBytes(item.totalSize)}) from the server? This cannot be undone.`)) return;
        try {
            await api('DELETE', `/api/library/${item.id}`);
            navigate('/server');
        } catch (e) {
            setError(e.message);
        }
    };
    const identify = () => {
        const imdb = window.prompt('IMDb id for this title (e.g. tt1375666):', item.imdbId || '');
        if (imdb) guard(() => api('POST', `/api/library/${item.id}/identify`, { imdbId: imdb.trim() }));
    };

    const isSeries = item.type === 'series';
    const current = isSeries ? (item.seasons.find((s) => s.season === season) || item.seasons[0]) : null;
    const firstFile = isSeries ? (current && current.episodes[0] && current.episodes[0].files[0]) : item.files[0];
    const firstLabel = isSeries && current && current.episodes[0] && has(current.episodes[0].episode) ? `S${current.season}E${current.episodes[0].episode}` : '';
    const detailsHref = item.imdbId ? `#/detail/${item.type}/${item.imdbId}` : null;

    return (
        <div className={classnames(styles['page'], styles['title-page'])}>
            <div className={styles['hero-pane']}>
                {item.backdrop && !bgFailed ? <img className={styles['backdrop']} src={item.backdrop} alt="" onError={() => setBgFailed(true)} /> : null}
                <div className={styles['hero-shade']} />
                <div className={styles['hero-content']}>
                    <a className={styles['back']} href="#/server">← On server</a>
                    <h1 className={styles['hero-title']}>{item.title}</h1>
                    <div className={styles['hero-meta']}>
                        {[isSeries ? 'Series' : 'Movie', item.year, isSeries ? `${item.seasons.length} season${item.seasons.length === 1 ? '' : 's'}` : null, formatBytes(item.totalSize)].filter(Boolean).join(' · ')}
                    </div>
                    {!item.matched ? <div className={styles['unmatched']}>Not matched to IMDb yet{admin ? ' – use “Identify” to fix' : ''}.</div> : null}
                    <div className={styles['hero-buttons']}>
                        {firstFile ? <button type="button" className={styles['btn-white']} onClick={() => play(firstFile, firstLabel)}>▶ Play{firstLabel ? ` ${firstLabel}` : ''}</button> : null}
                        {detailsHref ? <a className={styles['btn']} href={detailsHref}>Details &amp; streams</a> : null}
                        {admin ? <button type="button" className={styles['btn']} onClick={identify}>Identify</button> : null}
                        {admin ? <button type="button" className={classnames(styles['btn'], styles['danger'])} onClick={delItem}>Delete all</button> : null}
                    </div>
                </div>
            </div>
            <div className={styles['list-pane']}>
                <div className={styles['list-head']}>
                    <div className={styles['eyebrow']}>{isSeries ? 'Episodes' : 'Files'}</div>
                    {isSeries ?
                        <div className={styles['list-tools']}>
                            <select className={styles['select']} value={current ? current.season : ''} onChange={(e) => setSeason(Number(e.target.value))}>
                                {item.seasons.map((s) => <option key={s.season} value={s.season}>Season {s.season} ({s.episodes.length})</option>)}
                            </select>
                            {admin && current ? <button type="button" className={classnames(styles['btn-sm'], styles['danger'])} onClick={() => delSeason(current.season)}>Delete season</button> : null}
                        </div>
                        : null}
                </div>
                {error ? <div className={styles['error']}>{error}</div> : null}
                {isSeries && current ? current.episodes.map((ep) => ep.files.map((f) => (
                    <FileRow
                        key={f.id}
                        file={f}
                        admin={admin}
                        label={has(ep.episode) ? `S${current.season}E${ep.episode}` : 'Ep ?'}
                        onPlay={(file) => play(file, has(ep.episode) ? `S${current.season}E${ep.episode}` : '')}
                        onVlc={vlc}
                        onDelete={delFile}
                    />
                ))) : null}
                {isSeries && item.extras && item.extras.length ? <div className={styles['sub-head']}>Other files</div> : null}
                {isSeries && item.extras ? item.extras.map((f) => <FileRow key={f.id} file={f} admin={admin} label="—" onPlay={(file) => play(file, '')} onVlc={vlc} onDelete={delFile} />) : null}
                {!isSeries ? item.files.map((f) => <FileRow key={f.id} file={f} admin={admin} label="🎬" onPlay={(file) => play(file, '')} onVlc={vlc} onDelete={delFile} />) : null}
            </div>
        </div>
    );
};

ServerTitle.propTypes = { id: PropTypes.string.isRequired };

module.exports = ServerTitle;
