// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": Admin > Now playing (slot adminTabs). Refreshes every 5 s while the tab is visible.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const { clock } = require('./report');
const styles = require('./NowPlaying.less');

const SOURCE = { server: 'File on this server', torrent: 'Torrent', link: 'Web link' };
const avatarSrc = (a) => (typeof a === 'string' && (/^\/api\/avatars\//.test(a) || /^https:\/\//.test(a)) ? a : null);
const since = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just started' : m < 60 ? `for ${m} min` : `for ${Math.floor(m / 60)} h ${m % 60} min`;
};

const NowPlaying = ({ onError }) => {
    const [sessions, setSessions] = React.useState(null);
    const load = React.useCallback(() => api('GET', '/api/nowplaying')
        .then((d) => setSessions(d.sessions || []))
        .catch((e) => onError && onError(e.message)), [onError]);
    React.useEffect(() => {
        load();
        const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
        return () => clearInterval(t);
    }, [load]);

    if (sessions === null) return <div className={styles['muted']}>Loading…</div>;
    if (!sessions.length) return <div className={styles['muted']}>Nobody is watching right now.</div>;
    return (
        <div className={styles['list']}>
            {sessions.map((s) => {
                const pct = s.durationMs ? Math.min(100, Math.round((s.timeMs || 0) / s.durationMs * 100)) : 0;
                const href = s.type && s.metaId ? `#/detail/${s.type}/${encodeURIComponent(s.metaId)}${s.videoId && s.videoId !== s.metaId ? `/${encodeURIComponent(s.videoId)}` : ''}` : null;
                return (
                    <div key={`${s.login}|${s.session}`} className={styles['card']}>
                        {s.poster ? <img className={styles['poster']} src={s.poster} alt="" loading="lazy" /> : <div className={styles['poster']} />}
                        <div className={styles['body']}>
                            <div className={styles['who']}>
                                {avatarSrc(s.profile && s.profile.avatar) ? <img className={styles['avatar']} src={avatarSrc(s.profile.avatar)} alt="" /> : null}
                                <span className={styles['name']}>{(s.profile && s.profile.name) || 'Unknown profile'}</span>
                                {s.profile && s.profile.isKid ? <span className={styles['tag']}>Kids</span> : null}
                                <span className={styles['muted']}>{s.login} · {s.device}</span>
                            </div>
                            {href ? <a className={styles['title']} href={href}>{s.title}</a> : <div className={styles['title']}>{s.title}</div>}
                            <div className={styles['bar']}><div className={styles['fill']} style={{ width: `${pct}%` }} /></div>
                            <div className={styles['meta']}>
                                <span className={s.paused ? styles['paused'] : styles['playing']}>{s.paused ? 'Paused' : 'Playing'}</span>
                                <span>{clock(s.timeMs)} / {clock(s.durationMs)}</span>
                                <span className={s.mode === 'transcode' ? styles['transcode'] : styles['direct']}>
                                    {s.mode === 'transcode' ? 'Transcoding' : 'Direct play'}
                                </span>
                                {s.source ? <span>{SOURCE[s.source]}</span> : null}
                                <span className={styles['muted']}>{since(s.startedAt)}</span>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

NowPlaying.propTypes = { onError: PropTypes.func };

module.exports = NowPlaying;
