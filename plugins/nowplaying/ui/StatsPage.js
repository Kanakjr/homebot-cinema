// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "nowplaying": the Watch stats page (route #/stats and Admin > Watch stats). Admins can pick any profile or the
// whole household; everyone else sees the profile they are using (the server enforces it).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const pm = require('stremio/common/profileManager');
const S = require('./statsLogic');
const styles = require('./Stats.less');

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];
const PAGE = 25;

const Tile = ({ label, value, note }) => (
    <div className={styles['tile']}>
        <div className={styles['tile-value']}>{value}</div>
        <div className={styles['tile-label']}>{label}</div>
        {note ? <div className={styles['tile-note']}>{note}</div> : null}
    </div>
);
Tile.propTypes = { label: PropTypes.string, value: PropTypes.node, note: PropTypes.string };

const DailyChart = ({ perDay }) => {
    const W = 720;
    const H = 160;
    const { max, bars } = S.dailyBars(perDay, W, H);
    const [hover, setHover] = React.useState(null);
    const shown = hover !== null ? bars[hover] : null;
    const tick = (i) => i === 0 || i === bars.length - 1 || i === Math.floor((bars.length - 1) / 2);
    return (
        <div className={styles['chart']}>
            <div className={styles['chart-readout']} aria-live="polite">
                {shown ? `${S.dayLabel(shown.day)} · ${S.hours(shown.watchedMs)} · ${shown.plays} ${shown.plays === 1 ? 'play' : 'plays'}` : 'Hover a day for details'}
            </div>
            <svg className={styles['daily']} viewBox={`0 0 ${W + 40} ${H + 24}`} role="img" aria-label="Hours watched per day" onMouseLeave={() => setHover(null)}>
                {[0, 0.5, 1].map((f) => (
                    <g key={f}>
                        <line x1={40} x2={W + 40} y1={H - f * H} y2={H - f * H} className={styles['grid']} />
                        <text x={34} y={H - f * H + 4} className={styles['axis']} textAnchor="end">{`${Math.round(max * f * 10) / 10}h`}</text>
                    </g>
                ))}
                <g transform="translate(40,0)">
                    {bars.map((b, i) => (
                        <g key={b.day} onMouseEnter={() => setHover(i)}>
                            <rect x={b.x - 1} y={0} width={b.w + 2} height={H} fill="transparent" />
                            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(4, b.w / 2)} className={classnames(styles['bar'], { [styles['bar-hover']]: hover === i })} />
                            {tick(i) ? <text x={i === 0 ? b.x : i === bars.length - 1 ? b.x + b.w : b.x + b.w / 2} y={H + 16} className={styles['axis']} textAnchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'}>{S.dayLabel(b.day)}</text> : null}
                        </g>
                    ))}
                </g>
            </svg>
        </div>
    );
};
DailyChart.propTypes = { perDay: PropTypes.array.isRequired };

const Heatmap = ({ grid }) => {
    const rows = S.heatRows(grid);
    const [hover, setHover] = React.useState(null);
    return (
        <div className={styles['chart']}>
            <div className={styles['chart-readout']} aria-live="polite">
                {hover ? `${hover.label} ${String(hover.hour).padStart(2, '0')}:00 · ${S.hours(hover.ms)}` : 'Hours watched by day of week and time of day'}
            </div>
            <div className={styles['heat']} onMouseLeave={() => setHover(null)}>
                {rows.map((r) => (
                    <div key={r.label} className={styles['heat-row']}>
                        <div className={styles['heat-label']}>{r.label}</div>
                        {r.cells.map((c) => (
                            <div
                                key={c.hour}
                                className={classnames(styles['cell'], styles[`level-${c.level}`])}
                                onMouseEnter={() => setHover({ label: r.label, hour: c.hour, ms: c.ms })}
                                title={`${r.label} ${String(c.hour).padStart(2, '0')}:00 · ${S.hours(c.ms)}`}
                            />
                        ))}
                    </div>
                ))}
                <div className={styles['heat-row']}>
                    <div className={styles['heat-label']} />
                    {Array.from({ length: 24 }, (_, h) => <div key={h} className={styles['heat-hour']}>{h % 6 === 0 ? `${h}:00` : ''}</div>)}
                </div>
            </div>
        </div>
    );
};
Heatmap.propTypes = { grid: PropTypes.array.isRequired };

const BarList = ({ title, items }) => {
    if (!items || !items.length) return null;
    return (
        <div className={styles['barlist']}>
            <div className={styles['card-title']}>{title}</div>
            {S.share(items).map((it) => (
                <div key={String(it.key)} className={styles['barlist-row']}>
                    <div className={styles['barlist-label']}>{it.label}</div>
                    <div className={styles['barlist-track']}><div className={styles['barlist-fill']} style={{ width: `${Math.max(it.pct, 1)}%` }} /></div>
                    <div className={styles['barlist-value']}>{S.hours(it.watchedMs)} · {it.pct}%</div>
                </div>
            ))}
        </div>
    );
};
BarList.propTypes = { title: PropTypes.string, items: PropTypes.array };

const titleHref = (it) => (it.type && /^[a-z0-9:_.-]+$/i.test(String(it.key)) && /^tt\d+/.test(String(it.key)) ? `#/detail/${it.type}/${encodeURIComponent(it.key)}` : null);

const StatsPage = ({ embedded, onError }) => {
    const admin = !!window.ssoIsAdmin;
    const [days, setDays] = React.useState(30);
    const [profile, setProfile] = React.useState('all');
    const [profiles, setProfiles] = React.useState([]);
    const [sum, setSum] = React.useState(null);
    const [hist, setHist] = React.useState({ total: 0, items: [] });
    const [q, setQ] = React.useState('');
    const [error, setError] = React.useState('');
    const fail = React.useCallback((e) => { setError(e.message); if (onError) onError(e.message); }, [onError]);
    const headers = React.useMemo(() => pm.profileHeaders(), []);
    const tz = new Date().getTimezoneOffset();
    const scope = admin ? `&profile=${encodeURIComponent(profile)}` : '';

    React.useEffect(() => {
        if (!admin) return;
        api('GET', '/api/profiles').then((list) => setProfiles(Array.isArray(list) ? list : [])).catch(() => null);
    }, [admin]);

    React.useEffect(() => {
        api('GET', `/api/stats/summary?days=${days}&tz=${tz}${scope}`, undefined, headers).then(setSum).catch(fail);
    }, [days, scope, tz, headers, fail]);

    const loadHistory = React.useCallback((offset) => api('GET', `/api/stats/history?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(q)}${scope}`, undefined, headers)
        .then((r) => setHist((prev) => ({ total: r.total, items: offset ? [...prev.items, ...r.items] : r.items })))
        .catch(fail), [q, scope, headers, fail]);
    React.useEffect(() => {
        const t = setTimeout(() => loadHistory(0), 250);
        return () => clearTimeout(t);
    }, [loadHistory]);

    // CSV needs the profile headers, so it is fetched and saved through a blob link
    const exportCsv = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/stats/history.csv?x=1${scope}`, { credentials: 'same-origin', headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const url = URL.createObjectURL(await res.blob());
            const a = document.createElement('a');
            a.href = url;
            a.download = `watch-history-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            fail(e);
        }
    }, [scope, headers, fail]);

    const who = admin ? (profile === 'all' ? 'The whole household' : `Profile “${(profiles.find((p) => String(p.id) === profile) || {}).name || profile}”`)
        : `Profile “${(window.ssoProfile && window.ssoProfile.name) || ''}”`;
    const t = sum && sum.totals;
    const direct = sum ? S.share(sum.modes).find((m) => m.key === 'direct') : null;

    return (
        <div className={classnames(styles['stats'], { [styles['embedded']]: embedded })}>
            {!embedded ? (
                <div className={styles['head']}>
                    <div className={styles['eyebrow']}>HomeBot Cinema</div>
                    <h1 className={styles['title']}>Watch stats</h1>
                    <div className={styles['subtitle']}>{who}. Plays of 30 seconds or more, kept on this server.</div>
                </div>
            ) : <div className={styles['subtitle']}>{who}. Plays of 30 seconds or more, kept on this server.</div>}

            <div className={styles['filters']}>
                <div className={styles['pills']} role="group" aria-label="Period">
                    {PERIODS.map(([d, label]) => (
                        <button key={d} type="button" className={classnames(styles['pill'], { [styles['active']]: days === d })} aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
                    ))}
                </div>
                {admin ? (
                    <select className={styles['select']} value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Profile">
                        <option value="all">All profiles</option>
                        {profiles.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                    </select>
                ) : null}
            </div>

            {error ? <div className={styles['error']}>{error}</div> : null}
            {!sum ? <div className={styles['muted']}>Loading…</div> : null}
            {sum && t.plays === 0 ? (
                <div className={styles['empty']}>Nothing watched in this period yet. Plays show up here once someone has watched for 30 seconds.</div>
            ) : null}
            {sum && t.plays > 0 ? (
                <>
                    <div className={styles['tiles']}>
                        <Tile label="Watched" value={S.hours(t.watchedMs)} note={`${t.plays} ${t.plays === 1 ? 'play' : 'plays'}`} />
                        <Tile label="Titles" value={t.titles} />
                        <Tile label="Current streak" value={`${t.streak.current} ${t.streak.current === 1 ? 'day' : 'days'}`} note={`Longest: ${t.streak.longest} ${t.streak.longest === 1 ? 'day' : 'days'}`} />
                        <Tile label="Direct play" value={direct ? `${direct.pct}%` : '0%'} note="of hours watched, no transcoding" />
                        {admin && profile === 'all' ? <Tile label="Profiles watching" value={t.profiles} /> : null}
                    </div>

                    <div className={styles['card']}>
                        <div className={styles['card-title']}>Hours watched per day</div>
                        <DailyChart perDay={sum.perDay} />
                    </div>

                    <div className={styles['card']}>
                        <div className={styles['card-title']}>When {admin && profile === 'all' ? 'the household watches' : 'you watch'}</div>
                        <Heatmap grid={sum.grid} />
                    </div>

                    <div className={styles['split']}>
                        <div className={styles['card']}>
                            <div className={styles['card-title']}>Most watched</div>
                            <div className={styles['top']}>
                                {sum.topTitles.map((it, i) => {
                                    const href = titleHref(it);
                                    const Tag = href ? 'a' : 'div';
                                    return (
                                        <Tag key={String(it.key)} className={styles['top-item']} href={href || undefined}>
                                            <span className={styles['rank']}>{i + 1}</span>
                                            {it.poster ? <img className={styles['top-poster']} src={it.poster} alt="" loading="lazy" /> : <span className={styles['top-poster']} />}
                                            <span className={styles['top-name']}>{it.label}</span>
                                            <span className={styles['top-value']}>{S.hours(it.watchedMs)} · {it.plays} {it.plays === 1 ? 'play' : 'plays'}</span>
                                        </Tag>
                                    );
                                })}
                            </div>
                        </div>
                        <div className={styles['card']}>
                            {admin && profile === 'all' ? <BarList title="Profiles" items={sum.profiles} /> : null}
                            <BarList title="Playback" items={sum.modes} />
                            <BarList title="Movies and episodes" items={sum.types} />
                            <BarList title="Devices" items={sum.devices} />
                            <BarList title="Sources" items={sum.sources} />
                        </div>
                    </div>
                </>
            ) : null}

            <div className={styles['card']}>
                <div className={styles['history-head']}>
                    <div className={styles['card-title']}>History</div>
                    <input className={styles['search']} type="search" placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search history" />
                    <button type="button" className={styles['button']} onClick={exportCsv}>Export CSV</button>
                </div>
                {hist.items.length === 0 ? <div className={styles['muted']}>No plays{q ? ` matching “${q}”` : ''}.</div> : (
                    <div className={styles['table-wrap']}>
                        <table className={styles['table']}>
                            <thead>
                                <tr>
                                    <th>When</th>
                                    {admin ? <th>Profile</th> : null}
                                    <th>Title</th>
                                    <th>Watched</th>
                                    <th>Progress</th>
                                    <th>Playback</th>
                                    <th>Device</th>
                                </tr>
                            </thead>
                            <tbody>
                                {hist.items.map((r) => {
                                    const pct = r.durationMs ? Math.min(100, Math.round((r.positionMs || 0) / r.durationMs * 100)) : null;
                                    const ep = S.episodeTag(r);
                                    return (
                                        <tr key={r.id}>
                                            <td className={styles['nowrap']}>{new Date(r.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                                            {admin ? <td>{r.profile}{r.isKid ? ' (kids)' : ''}</td> : null}
                                            <td className={styles['title-cell']}>{r.name || r.title}{ep ? <span className={styles['muted']}> · {ep}</span> : null}</td>
                                            <td className={styles['nowrap']}>{S.hours(r.watchedMs)}</td>
                                            <td>{pct === null ? '–' : `${pct}%`}</td>
                                            <td>{r.mode === 'transcode' ? 'Transcoding' : 'Direct play'}</td>
                                            <td className={styles['muted']}>{r.device}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {hist.items.length < hist.total ? (
                    <button type="button" className={classnames(styles['button'], styles['more'])} onClick={() => loadHistory(hist.items.length)}>
                        Show more ({hist.total - hist.items.length} left)
                    </button>
                ) : null}
            </div>
        </div>
    );
};

StatsPage.propTypes = { embedded: PropTypes.bool, onError: PropTypes.func };

module.exports = StatsPage;
