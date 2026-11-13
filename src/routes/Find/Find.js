// Copyright (C) 2017-2026 HomeBot Cinema
// Smart filters. Results come from /api/find (TMDB discover, queried by our server) and open the normal title page.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useNavigate } = require('react-router');
const { MetaPreview } = require('stremio/components');
const { default: MetaPreviewSheet } = require('stremio/components/MetaPreviewSheet');
const { useMediaQuery } = require('stremio/common');
const screenSizes = require('stremio/common/screen-sizes.less');
const PageHeader = require('stremio/components/PageHeader');
const { api, isAdmin } = require('stremio/common/serverApi');
const styles = require('./styles');

const STORE_KEY = 'homebot_find_filters';
const BLANK = { type: 'movie', genres: [], providers: [], minRating: 0, minVotes: 200, yearFrom: 0, lang: '', maxRuntime: 0, sort: 'rating' };

const { RATINGS, VOTES, YEARS, RUNTIMES, SORTS, PRESET_GROUPS, PRESETS } = require('./presets');

const regionName = (code) => {
    try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch (_) {
        return code;
    }
};

const loadSaved = () => {
    try {
        const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
        if (!raw || typeof raw !== 'object') return BLANK;
        return {
            ...BLANK,
            type: raw.type === 'series' ? 'series' : 'movie',
            genres: Array.isArray(raw.genres) ? raw.genres.filter((g) => typeof g === 'string').slice(0, 6) : [],
            providers: Array.isArray(raw.providers) ? raw.providers.filter((n) => Number.isInteger(n)).slice(0, 8) : [],
            minRating: RATINGS.includes(raw.minRating) ? raw.minRating : 0,
            minVotes: VOTES.includes(raw.minVotes) ? raw.minVotes : BLANK.minVotes,
            yearFrom: YEARS.includes(raw.yearFrom) ? raw.yearFrom : 0,
            lang: typeof raw.lang === 'string' && /^[a-z]{2,3}$/.test(raw.lang) ? raw.lang : '',
            maxRuntime: RUNTIMES.includes(raw.maxRuntime) ? raw.maxRuntime : 0,
            sort: SORTS.some(([k]) => k === raw.sort) ? raw.sort : 'rating',
        };
    } catch (_) {
        return BLANK;
    }
};

const toQuery = (f, page) => {
    const p = new URLSearchParams();
    p.set('type', f.type);
    if (f.genres.length) p.set('genre', f.genres.join(','));
    if (f.providers.length) p.set('provider', f.providers.join(','));
    if (f.minRating) p.set('minRating', String(f.minRating));
    if (f.minVotes) p.set('minVotes', String(f.minVotes));
    if (f.yearFrom) p.set('yearFrom', String(f.yearFrom));
    if (f.lang) p.set('lang', f.lang);
    if (f.maxRuntime) p.set('maxRuntime', String(f.maxRuntime));
    p.set('sort', f.sort);
    p.set('page', String(page));
    return p.toString();
};

const friendly = (e) => {
    const code = (e.data && e.data.error) || e.message;
    if (code === 'tmdb_auth_failed') return 'TMDB rejected the API key. Check CINEMA_TMDB_API_KEY on the server.';
    if (code === 'tmdb_unreachable') return 'Could not reach TMDB. Try again in a moment.';
    if (/^unknown_genre/.test(code)) return 'That genre does not exist for this type. Pick another one.';
    return code || 'Something went wrong';
};

const Card = ({ item, selected, onSelect, onClick }) => {
    const [broken, setBroken] = React.useState(false);
    return (
        <a
            className={classnames(styles['card'], { [styles['selected']]: selected })}
            href={`#/detail/${item.type}/${item.id}`}
            title={item.name}
            onMouseEnter={onSelect}
            onFocus={onSelect}
            onClick={onClick}
        >
            <div className={styles['poster']}>
                {item.poster && !broken ?
                    <img src={item.poster} alt="" loading="lazy" onError={() => setBroken(true)} />
                    :
                    <div className={styles['no-art']}>{item.name}</div>}
                <span className={styles['rating']} title={`TMDB rating from ${item.votes.toLocaleString()} votes`}>★ {item.rating.toFixed(1)}</span>
                {item.onServer ? <span className={styles['on-server']}>On server</span> : null}
            </div>
            <div className={styles['card-title']}>{item.name}</div>
            <div className={styles['card-sub']}>{[item.year, item.language ? item.language.toUpperCase() : null].filter(Boolean).join(' · ')}</div>
        </a>
    );
};
Card.propTypes = { item: PropTypes.object.isRequired, selected: PropTypes.bool, onSelect: PropTypes.func, onClick: PropTypes.func };

// Scrolling results on the left, the info panel of the highlighted title on the right (like Discover)
const Layout = ({ preview, children }) => (
    <div className={styles['layout']}>
        <div className={styles['scroll']}>{children}</div>
        {preview}
    </div>
);
Layout.propTypes = { preview: PropTypes.node, children: PropTypes.node };

const Chip = ({ on, onClick, children, title }) => (
    <button type="button" aria-pressed={on} title={title} className={classnames(styles['chip'], { [styles['on']]: on })} onClick={onClick}>{children}</button>
);
Chip.propTypes = { on: PropTypes.bool, onClick: PropTypes.func, children: PropTypes.node, title: PropTypes.string };

// Rounded dropdown in the same style as the Discover filters
const Pill = ({ label, value, onChange, children, accent }) => (
    <label className={classnames(styles['pill'], { [styles['accent']]: accent })}>
        <select aria-label={label} value={value} onChange={onChange}>{children}</select>
    </label>
);
Pill.propTypes = { label: PropTypes.string, value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), onChange: PropTypes.func, children: PropTypes.node, accent: PropTypes.bool };

const Select = ({ label, value, onChange, children }) => (
    <label className={styles['field']}>
        <span>{label}</span>
        <select className={styles['select']} value={value} onChange={onChange}>{children}</select>
    </label>
);
Select.propTypes = { label: PropTypes.string, value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), onChange: PropTypes.func, children: PropTypes.node };

const Find = () => {
    const navigate = useNavigate();
    const admin = isAdmin();
    const [opts, setOpts] = React.useState(null);
    const [filters, setFilters] = React.useState(loadSaved);
    const [results, setResults] = React.useState({ items: [], page: 0, totalPages: 0, total: 0, hidden: 0 });
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [note, setNote] = React.useState('');
    const [advanced, setAdvanced] = React.useState(false);
    const reqId = React.useRef(0);
    const [selected, setSelected] = React.useState(0);
    const [sheetOpen, setSheetOpen] = React.useState(false);
    const previewRef = React.useRef(null);
    const isMobile = useMediaQuery(`(max-width: ${screenSizes.xsmall})`);

    React.useEffect(() => {
        api('GET', '/api/find/options').then(setOpts).catch((e) => setError(friendly(e)));
    }, []);

    React.useEffect(() => {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify(filters));
        } catch (_) {
            // storage unavailable: filters just are not remembered
        }
    }, [filters]);

    const run = React.useCallback(async (f, page, append) => {
        const id = ++reqId.current;
        setLoading(true);
        setError('');
        try {
            const r = await api('GET', `/api/find?${toQuery(f, page)}`);
            if (id !== reqId.current) return;
            if (!append) setSelected(0);
            setResults((prev) => (append ?
                { ...r, items: [...prev.items, ...r.items.filter((n) => !prev.items.some((o) => o.id === n.id))], hidden: prev.hidden + r.hidden }
                : r));
        } catch (e) {
            if (id === reqId.current) setError(friendly(e));
        } finally {
            if (id === reqId.current) setLoading(false);
        }
    }, []);

    // search whenever the filters change (a dragged selection settles for a moment first)
    React.useEffect(() => {
        if (!opts || !opts.configured) return;
        const t = setTimeout(() => run(filters, 1, false), 250);
        return () => clearTimeout(t);
    }, [opts, filters, run]);

    const set = (patch) => { setNote(''); setFilters((f) => ({ ...f, ...patch })); };
    const toggle = (key, value) => set({ [key]: filters[key].includes(value) ? filters[key].filter((x) => x !== value) : [...filters[key], value] });
    const setType = (type) => {
        const allowed = new Set(((opts && opts.genres && opts.genres[type]) || []).map((g) => g.name));
        set({ type, genres: filters.genres.filter((g) => allowed.has(g)) });
    };
    const applyPreset = (p) => {
        const wanted = (p.f.services || []).map((n) => n.toLowerCase());
        const found = ((opts && opts.providers) || []).filter((s) => wanted.includes(s.name.toLowerCase()));
        setNote(wanted.length && found.length < wanted.length ? `${p.f.services.join(', ')} is not listed for ${regionName(opts.region)}, so the service filter was left out.` : '');
        const { services: _services, ...rest } = p.f;
        setFilters({ ...BLANK, ...rest, providers: found.map((s) => s.id) });
    };
    const surprise = () => {
        const pool = results.items;
        if (pool.length) {
            const pick = pool[Math.floor(Math.random() * pool.length)];
            navigate(`/detail/${pick.type}/${pick.id}`);
        }
    };
    const isDefault = JSON.stringify(filters) === JSON.stringify(BLANK);
    // everything the minimal bar cannot show: it is counted on the Advanced button so hidden filters are never a surprise
    const advancedCount = [filters.minVotes !== BLANK.minVotes, filters.yearFrom, filters.lang, filters.maxRuntime, filters.sort !== 'rating', filters.providers.length > 1, filters.genres.length > 1].filter(Boolean).length;

    if (!opts && !error) return <Layout><div className={styles['page']}><div className={styles['empty']}>Loading…</div></div></Layout>;

    if (opts && !opts.configured) {
        return (
            <Layout><div className={styles['page']}>
                <PageHeader eyebrow="Discover" title="Smart filters" subtitle="Find something to watch by rating, genre, streaming service and more." />
                <div className={styles['setup']}>
                    <h2>One-time setup: a free TMDB key</h2>
                    <p>Smart filters ask TMDB (a free movie database) for titles that match, which the normal catalogs cannot do.</p>
                    <ol>
                        <li>Create a free account at themoviedb.org, then open Settings → API and request a key.</li>
                        <li>Put it in <code>~/HomeServer/.env</code> as <code>CINEMA_TMDB_API_KEY=…</code>.</li>
                        <li>Restart the cinema container.</li>
                    </ol>
                    {admin ? null : <p className={styles['muted']}>Ask the admin to do this.</p>}
                    <a className={styles['btn']} href="#/discover">← Back to catalogs</a>
                </div>
            </div></Layout>
        );
    }

    const genreList = (opts && opts.genres && opts.genres[filters.type]) || [];
    const more = results.page > 0 && results.page < results.totalPages;
    const current = results.items[selected] || null;
    const genreNames = current ? (current.genreIds || []).map((id) => (genreList.find((g) => g.id === id) || {}).name).filter(Boolean) : [];
    const previewProps = current && {
        compact: true,
        name: current.name,
        description: current.overview,
        deepLinks: { metaDetailsStreams: `#/detail/${current.type}/${current.id}` },
        metadata: (
            <>
                <div className={styles['info']}>
                    <span className={styles['info-rating']} title="TMDB rating">★ {current.rating.toFixed(1)}</span>
                    <span>{current.votes.toLocaleString()} {current.votes === 1 ? 'vote' : 'votes'}</span>
                    {current.year ? <span>{current.year}</span> : null}
                    {current.language ? <span>{current.language.toUpperCase()}</span> : null}
                    <a className={styles['info-imdb']} href={`https://www.imdb.com/title/${current.id}/`} target="_blank" rel="noopener noreferrer">IMDb ↗</a>
                </div>
                {genreNames.length ? <div className={styles['info-tags']}>{genreNames.map((g) => <span key={g}>{g}</span>)}</div> : null}
                {current.onServer ? <div className={styles['info-server']}>On your server</div> : null}
            </>
        ),
    };
    const preview = current ?
        <MetaPreview {...previewProps} className={styles['preview']} ref={previewRef} background={current.poster} />
        : loading ? <div className={styles['preview']} ref={previewRef} /> : null;
    const onCardClick = (event, index) => {
        if (isMobile) {
            event.preventDefault();
            setSelected(index);
            setSheetOpen(true);
        }
    };
    return (
        <Layout preview={preview}><div className={styles['page']}>
            <PageHeader
                eyebrow="Discover"
                title="Smart filters"
                subtitle={opts ? `Titles on streaming services in ${regionName(opts.region)}, matched by rating, genre, language and more.` : ''}
                actions={
                    <>
                        <a className={styles['btn']} href="#/discover">Catalogs</a>
                        <button type="button" className={styles['btn']} disabled={!results.items.length} onClick={surprise}>🎲 Surprise me</button>
                    </>
                }
            />

            <div className={styles['bar']}>
                <Pill label="Quick picks" accent value="" onChange={(e) => { const p = PRESETS[Number(e.target.value)]; if (p) applyPreset(p); }}>
                    <option value="">✨ Quick picks</option>
                    {PRESET_GROUPS.map((g) => (
                        <optgroup key={g.title} label={g.title}>
                            {g.items.map((p) => <option key={p.label} value={p.index}>{p.label}</option>)}
                        </optgroup>
                    ))}
                </Pill>
                <Pill label="Type" value={filters.type} onChange={(e) => setType(e.target.value)}>
                    <option value="movie">Movies</option>
                    <option value="series">Series</option>
                </Pill>
                <Pill
                    label="Streaming on"
                    value={filters.providers.length > 1 ? 'multi' : filters.providers.length === 1 ? String(filters.providers[0]) : ''}
                    onChange={(e) => { if (e.target.value !== 'multi') set({ providers: e.target.value ? [Number(e.target.value)] : [] }); }}
                >
                    <option value="">Any service</option>
                    {((opts && opts.providers) || []).map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                    {filters.providers.length > 1 ? <option value="multi">{filters.providers.length} services</option> : null}
                </Pill>
                <Pill
                    label="Genre"
                    value={filters.genres.length > 1 ? 'multi' : filters.genres.length === 1 ? filters.genres[0] : ''}
                    onChange={(e) => { if (e.target.value !== 'multi') set({ genres: e.target.value ? [e.target.value] : [] }); }}
                >
                    <option value="">Any genre</option>
                    {genreList.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
                    {filters.genres.length > 1 ? <option value="multi">{filters.genres.length} genres</option> : null}
                </Pill>
                <Pill label="Minimum rating" value={filters.minRating} onChange={(e) => set({ minRating: Number(e.target.value) })}>
                    {RATINGS.map((v) => <option key={v} value={v}>{v ? `Rating ${v}+` : 'Any rating'}</option>)}
                </Pill>
                <button type="button" className={classnames(styles['advanced-toggle'], { [styles['open']]: advanced })} aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
                    Advanced{advancedCount ? <span className={styles['count']}>{advancedCount}</span> : null}
                    <svg className={styles['chev']} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                {isDefault ? null : <button type="button" className={styles['link']} onClick={() => { setNote(''); setFilters(BLANK); }}>Reset</button>}
            </div>
            {note ? <div className={styles['notice']}>{note}</div> : null}

            {advanced ?
                <div className={styles['panel']}>
                    <div className={styles['row']}>
                        <Select label="Rated by at least" value={filters.minVotes} onChange={(e) => set({ minVotes: Number(e.target.value) })}>
                            {VOTES.map((v) => <option key={v} value={v}>{v ? `${v.toLocaleString()} votes` : 'Any'}</option>)}
                        </Select>
                        <Select label="Released since" value={filters.yearFrom} onChange={(e) => set({ yearFrom: Number(e.target.value) })}>
                            {YEARS.map((v) => <option key={v} value={v}>{v || 'Any'}</option>)}
                        </Select>
                        <Select label="Language" value={filters.lang} onChange={(e) => set({ lang: e.target.value })}>
                            <option value="">Any</option>
                            {((opts && opts.languages) || []).map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                        </Select>
                        <Select label="Max length" value={filters.maxRuntime} onChange={(e) => set({ maxRuntime: Number(e.target.value) })}>
                            {RUNTIMES.map((v) => <option key={v} value={v}>{v ? `${v} min` : 'Any'}</option>)}
                        </Select>
                        <Select label="Sort by" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
                            {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </Select>
                    </div>

                    <div className={styles['group']}>
                        <div className={styles['group-title']}>Streaming on <em>pick several to match any of them, in {opts ? regionName(opts.region) : ''}</em></div>
                        <div className={styles['chips']}>
                            {((opts && opts.providers) || []).map((sv) => (
                                <Chip key={sv.id} on={filters.providers.includes(sv.id)} onClick={() => toggle('providers', sv.id)}>
                                    {sv.logo ? <img className={styles['logo']} src={sv.logo} alt="" /> : null}{sv.name}
                                </Chip>
                            ))}
                        </div>
                    </div>

                    <div className={styles['group']}>
                        <div className={styles['group-title']}>Genres <em>a title must match every one you pick</em></div>
                        <div className={styles['chips']}>
                            {genreList.map((g) => <Chip key={g.id} on={filters.genres.includes(g.name)} onClick={() => toggle('genres', g.name)}>{g.name}</Chip>)}
                        </div>
                    </div>
                </div>
                : null}

            {error ?
                <div className={styles['error']}>
                    {error}{' '}
                    <button type="button" className={styles['link']} onClick={() => {
                        setError('');
                        if (!opts) api('GET', '/api/find/options').then(setOpts).catch((e) => setError(friendly(e)));
                        else run(filters, 1, false);
                    }}>Try again</button>
                </div>
                : null}

            <div className={styles['summary']}>
                {loading && !results.items.length ? 'Searching…'
                    : results.page > 0 ? `${results.total.toLocaleString()} title${results.total === 1 ? '' : 's'} match${results.hidden > 0 ? ` · ${results.hidden} hidden because they have no IMDb id` : ''}` : ''}
            </div>

            {results.page > 0 && !results.items.length && !loading && !error ?
                <div className={styles['empty']}>Nothing matches. Try a lower rating, fewer votes, or remove a genre.</div> : null}

            <div className={classnames(styles['grid'], { [styles['busy']]: loading })}>
                {results.items.map((item, i) => (
                    <Card key={`${item.type}-${item.id}`} item={item} selected={i === selected && !isMobile} onSelect={() => setSelected(i)} onClick={(e) => onCardClick(e, i)} />
                ))}
            </div>

            {more ?
                <div className={styles['more']}>
                    <button type="button" className={styles['btn']} disabled={loading} onClick={() => run(filters, results.page + 1, true)}>{loading ? 'Loading…' : 'Show more'}</button>
                </div>
                : null}
            <div className={styles['credit']}>Ratings and streaming availability from TMDB and JustWatch. TMDB ratings can differ slightly from IMDb&apos;s.</div>
        </div>
        {current ?
            <MetaPreviewSheet show={isMobile && sheetOpen} onCloseRequest={() => setSheetOpen(false)} ariaLabel={current.name}>
                <MetaPreview {...previewProps} background={current.poster} onShowClick={() => setSheetOpen(false)} showIcon={'chevron-forward'} />
            </MetaPreviewSheet>
            : null}
        </Layout>
    );
};

module.exports = Find;
