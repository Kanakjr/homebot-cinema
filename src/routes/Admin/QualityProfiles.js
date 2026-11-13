// Copyright (C) 2017-2026 HomeBot Cinema
// Admin: quality profiles for the grabber (Sonarr/Radarr style) + a "why was this release picked/rejected" tester.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const { load: reloadProfiles } = require('stremio/common/qualityProfile');
const styles = require('./styles');

const ALL_QUALITIES = ['4K', '1080p', '720p', '480p'];
const HDR = [['any', 'Any'], ['prefer', 'Prefer HDR / Dolby Vision'], ['require', 'Require HDR'], ['avoid', 'Avoid HDR']];
const CODEC = [['any', 'No preference'], ['prefer-hevc', 'Prefer HEVC / x265 (smaller)'], ['prefer-h264', 'Prefer H.264 (plays everywhere)'], ['avoid-hevc', 'Avoid HEVC']];
const BIAS = [['none', 'No preference'], ['larger', 'Prefer larger (more bitrate)'], ['smaller', 'Prefer smaller (save space)']];

const str = (v) => (v === null || v === undefined ? '' : String(v));
const numOrNull = (v) => (String(v).trim() === '' ? null : Number(v));
const blank = () => ({
    name: '', description: '', order: [...ALL_QUALITIES], enabled: { '1080p': true, '720p': true },
    sizes: {}, minSeeders: '5', hdr: 'any', codec: 'any', sizeBias: 'none', required: '', banned: '', preferred: ''
});

function toForm(p) {
    const c = p.config;
    const order = [...c.qualities, ...ALL_QUALITIES.filter((q) => !c.qualities.includes(q))];
    const sizes = {};
    for (const q of c.qualities) {
        const s = c.sizes[q] || {};
        sizes[q] = { mMin: str(s.movie && s.movie.minGB), mMax: str(s.movie && s.movie.maxGB), eMin: str(s.episode && s.episode.minGB), eMax: str(s.episode && s.episode.maxGB) };
    }
    return {
        name: c.name, description: c.description || '', order, enabled: Object.fromEntries(c.qualities.map((q) => [q, true])), sizes,
        minSeeders: str(c.minSeeders), hdr: c.hdr, codec: c.codec, sizeBias: c.sizeBias,
        required: c.requiredKeywords.join(', '), banned: c.bannedKeywords.join(', '), preferred: c.preferredKeywords.join(', ')
    };
}

function toBody(f) {
    const qualities = f.order.filter((q) => f.enabled[q]);
    const sizes = {};
    for (const q of qualities) {
        const s = f.sizes[q] || {};
        sizes[q] = { movie: { minGB: numOrNull(s.mMin || ''), maxGB: numOrNull(s.mMax || '') }, episode: { minGB: numOrNull(s.eMin || ''), maxGB: numOrNull(s.eMax || '') } };
    }
    return {
        name: f.name, description: f.description, qualities, sizes, minSeeders: numOrNull(f.minSeeders) ?? 0,
        hdr: f.hdr, codec: f.codec, sizeBias: f.sizeBias,
        requiredKeywords: f.required, bannedKeywords: f.banned, preferredKeywords: f.preferred
    };
}

const describe = (c) => `${c.qualities.join(' › ')}${c.hdr === 'prefer' || c.hdr === 'require' ? ' · HDR' : ''}`;

const Field = ({ label, hint, children }) => (
    <label className={styles['field']}>
        <span className={styles['field-label']}>{label}</span>
        {children}
        {hint ? <span className={styles['field-hint']}>{hint}</span> : null}
    </label>
);
Field.propTypes = { label: PropTypes.string, hint: PropTypes.string, children: PropTypes.node };

const QualityProfiles = ({ onError }) => {
    const [data, setData] = React.useState(null);
    const [sel, setSel] = React.useState(null); // profile id, or 'new'
    const [form, setForm] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [saved, setSaved] = React.useState('');
    const [test, setTest] = React.useState({ release: '', sizeGB: '', seeders: '' });
    const [result, setResult] = React.useState(null);

    const load = React.useCallback(async (keepSel) => {
        try {
            const d = await api('GET', '/api/grabber/profiles');
            setData(d);
            const pick = d.profiles.find((p) => p.id === keepSel) || d.profiles.find((p) => p.isDefault) || d.profiles[0];
            setSel((cur) => (cur === 'new' && keepSel === undefined ? 'new' : (pick ? pick.id : null)));
            if (pick && keepSel !== 'new') setForm(toForm(pick));
        } catch (e) {
            onError(e.message);
        }
    }, [onError]);
    React.useEffect(() => { load(); }, [load]);

    const current = data && typeof sel === 'number' ? data.profiles.find((p) => p.id === sel) : null;
    const choose = (p) => { setSel(p.id); setForm(toForm(p)); setResult(null); setSaved(''); };
    const startNew = () => { setSel('new'); setForm(blank()); setResult(null); setSaved(''); };
    const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setSaved(''); };
    const run = async (fn, okMsg) => {
        setBusy(true);
        onError('');
        try {
            await fn();
            if (okMsg) setSaved(okMsg);
            await reloadProfiles(true);
        } catch (e) {
            onError(e.message);
        } finally {
            setBusy(false);
        }
    };

    const save = () => run(async () => {
        const body = toBody(form);
        if (sel === 'new') {
            const created = await api('POST', '/api/grabber/profiles', body);
            await load(created.id);
        } else {
            await api('PUT', `/api/grabber/profiles/${sel}`, body);
            await load(sel);
        }
    }, 'Saved');
    const duplicate = () => run(async () => {
        const created = await api('POST', '/api/grabber/profiles', { ...toBody(form), name: `${form.name} (copy)` });
        await load(created.id);
    }, 'Duplicated');
    const remove = () => window.confirm(`Delete “${current.name}”?`) && run(async () => {
        await api('DELETE', `/api/grabber/profiles/${sel}`);
        setSel(null);
        await load();
    });
    const reset = () => window.confirm(`Restore “${current.name}” to its original settings?`) && run(async () => {
        await api('POST', `/api/grabber/profiles/${sel}/reset`);
        await load(sel);
    }, 'Reset to defaults');
    const makeDefault = () => run(async () => {
        await api('PUT', '/api/grabber/default', { profileId: sel });
        await load(sel);
    }, 'Default profile updated');
    const runTest = () => run(async () => {
        setResult(await api('POST', '/api/grabber/test', { profileId: typeof sel === 'number' ? sel : undefined, ...test }));
    });

    const move = (q, dir) => {
        const order = [...form.order];
        const i = order.indexOf(q);
        const j = i + dir;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        set({ order });
    };
    const setSize = (q, key, v) => set({ sizes: { ...form.sizes, [q]: { ...(form.sizes[q] || {}), [key]: v } } });

    if (!data || !form) return <div className={styles['empty']}>Loading…</div>;
    return (
        <>
            <div className={styles['hint']}>
                Profiles decide which release the grabber picks — for the Save button and for Sentinel’s automatic downloads.
                A release must pass every rule; among those that do, higher-ranked qualities and preferred keywords win.
            </div>
            <div className={styles['qp-layout']}>
                <div className={styles['qp-list']}>
                    {data.profiles.map((p) => (
                        <button key={p.id} type="button" className={classnames(styles['qp-item'], { [styles['active']]: sel === p.id })} onClick={() => choose(p)}>
                            <span className={styles['qp-name']}>{p.name}{p.isDefault ? <span className={styles['tag']}>Default</span> : null}</span>
                            <span className={styles['qp-sub']}>{describe(p.config)}{p.builtin ? '' : ' · custom'}</span>
                        </button>
                    ))}
                    <button type="button" className={classnames(styles['qp-item'], styles['qp-new'], { [styles['active']]: sel === 'new' })} onClick={startNew}>＋ New profile</button>
                </div>

                <div className={styles['qp-editor']}>
                    <Field label="Name"><input className={styles['input']} value={form.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} /></Field>
                    <Field label="Description"><input className={styles['input']} value={form.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} /></Field>

                    <div className={styles['field-label']}>Allowed qualities, best first <span className={styles['field-hint']}>Releases in a higher row are always preferred over lower ones.</span></div>
                    <div className={styles['q-table']}>
                        <div className={classnames(styles['q-row'], styles['q-head'])}>
                            <span /><span>Quality</span><span>Movie min GB</span><span>Movie max GB</span><span>Episode min GB</span><span>Episode max GB</span>
                        </div>
                        {form.order.map((q, i) => {
                            const on = !!form.enabled[q];
                            const s = form.sizes[q] || {};
                            return (
                                <div key={q} className={classnames(styles['q-row'], { [styles['off']]: !on })}>
                                    <span className={styles['q-move']}>
                                        <button type="button" disabled={i === 0} onClick={() => move(q, -1)} aria-label="Move up">▲</button>
                                        <button type="button" disabled={i === form.order.length - 1} onClick={() => move(q, 1)} aria-label="Move down">▼</button>
                                    </span>
                                    <label className={styles['q-name']}><input type="checkbox" checked={on} onChange={(e) => set({ enabled: { ...form.enabled, [q]: e.target.checked } })} />{q}</label>
                                    {['mMin', 'mMax', 'eMin', 'eMax'].map((k) => (
                                        <input key={k} className={styles['input']} type="number" min="0" step="0.1" placeholder="no limit" disabled={!on} value={s[k] || ''} onChange={(e) => setSize(q, k, e.target.value)} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>

                    <div className={styles['grid-3']}>
                        <Field label="Minimum seeders"><input className={styles['input']} type="number" min="0" value={form.minSeeders} onChange={(e) => set({ minSeeders: e.target.value })} /></Field>
                        <Field label="HDR / Dolby Vision">
                            <select className={styles['input']} value={form.hdr} onChange={(e) => set({ hdr: e.target.value })}>{HDR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        </Field>
                        <Field label="Video codec">
                            <select className={styles['input']} value={form.codec} onChange={(e) => set({ codec: e.target.value })}>{CODEC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                        </Field>
                    </div>
                    <Field label="File size preference">
                        <select className={styles['input']} value={form.sizeBias} onChange={(e) => set({ sizeBias: e.target.value })}>{BIAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    </Field>

                    <Field label="Must contain one of" hint="Comma separated, e.g. yts, psa. Leave empty for no requirement.">
                        <textarea className={styles['input']} rows={2} value={form.required} onChange={(e) => set({ required: e.target.value })} />
                    </Field>
                    <Field label="Never contain" hint="Releases containing any of these words are rejected, e.g. hindi dub, dts, 10bit.">
                        <textarea className={styles['input']} rows={2} value={form.banned} onChange={(e) => set({ banned: e.target.value })} />
                    </Field>
                    <Field label="Preferred words" hint="Each match raises a release’s rank, e.g. atmos, remux, x265.">
                        <textarea className={styles['input']} rows={2} value={form.preferred} onChange={(e) => set({ preferred: e.target.value })} />
                    </Field>

                    <div className={styles['qp-actions']}>
                        <button type="button" className={styles['btn-white']} disabled={busy || !form.name.trim()} onClick={save}>{sel === 'new' ? 'Create profile' : 'Save changes'}</button>
                        {current && !current.isDefault ? <button type="button" className={styles['btn']} disabled={busy} onClick={makeDefault}>Make default</button> : null}
                        {current ? <button type="button" className={styles['btn']} disabled={busy} onClick={duplicate}>Duplicate</button> : null}
                        {current && current.builtin ? <button type="button" className={styles['btn']} disabled={busy} onClick={reset}>Reset to defaults</button> : null}
                        {current && !current.builtin ? <button type="button" className={classnames(styles['btn'], styles['danger'])} disabled={busy} onClick={remove}>Delete</button> : null}
                        {saved ? <span className={styles['saved']}>✓ {saved}</span> : null}
                    </div>

                    <div className={styles['tester']}>
                        <div className={styles['field-label']}>Try a release against {current ? `“${current.name}”` : 'the default profile'}</div>
                        <div className={styles['test-row']}>
                            <input className={styles['input']} placeholder="Paste a release name, e.g. Movie.2026.2160p.WEB-DL.DV.HDR.HEVC-GROUP" value={test.release} onChange={(e) => setTest({ ...test, release: e.target.value })} />
                            <input className={styles['input']} type="number" min="0" step="0.1" placeholder="GB" value={test.sizeGB} onChange={(e) => setTest({ ...test, sizeGB: e.target.value })} />
                            <input className={styles['input']} type="number" min="0" placeholder="seeders" value={test.seeders} onChange={(e) => setTest({ ...test, seeders: e.target.value })} />
                            <button type="button" className={styles['btn']} disabled={busy || !test.release.trim()} onClick={runTest}>Test</button>
                        </div>
                        {result ?
                            <div className={styles['test-result']}>
                                <div className={styles['chips']}>
                                    {[result.parsed.resolution, result.parsed.hdr, result.parsed.source, result.parsed.codec, ...(result.parsed.audio || []), result.parsed.sizeGB ? `${result.parsed.sizeGB} GB` : null, typeof result.parsed.seeders === 'number' ? `${result.parsed.seeders} seeders` : null]
                                        .filter(Boolean).map((c) => <span key={c} className={styles['chip']}>{c}</span>)}
                                </div>
                                {['movie', 'episode'].map((k) => (
                                    <div key={k} className={classnames(styles['verdict'], result[k].accepted ? styles['ok'] : styles['no'])}>
                                        <b>As a {k}:</b> {result[k].accepted ? `accepted (score ${result[k].score})${result[k].reasons.length ? ` — ${result[k].reasons.join(', ')}` : ''}` : `rejected — ${result[k].reasons.join('; ')}`}
                                    </div>
                                ))}
                            </div>
                            : null}
                    </div>
                </div>
            </div>
        </>
    );
};

QualityProfiles.propTypes = { onError: PropTypes.func.isRequired };

module.exports = QualityProfiles;
