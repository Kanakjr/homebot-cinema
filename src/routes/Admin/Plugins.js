// Copyright (C) 2017-2026 HomeBot Cinema
// Admin > Plugins: what is installed, what runs, why something does not, and a switch that writes data/plugins.json.
// Switching takes effect after a server restart (plugins register routes at boot). Server side: server/plugins/.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const styles = require('./styles');

const Plugins = ({ onError }) => {
    const [data, setData] = React.useState(null);
    const [pending, setPending] = React.useState({}); // id -> desired state saved for the next restart
    const load = React.useCallback(() => api('GET', '/api/plugins').then(setData).catch((e) => onError(e.message)), [onError]);
    React.useEffect(() => { load(); }, [load]);

    const toggle = (p) => {
        const want = !(p.id in pending ? pending[p.id] : p.enabled);
        api('POST', `/api/plugins/${encodeURIComponent(p.id)}`, { enabled: want })
            .then(() => setPending((s) => ({ ...s, [p.id]: want })))
            .catch((e) => onError(e.message));
    };

    if (!data) return <div className={styles['empty']}>Loading…</div>;
    const changed = Object.keys(pending).some((id) => (data.plugins.find((p) => p.id === id) || {}).enabled !== pending[id]);
    return (
        <>
            <h2 className={styles['section']}>Plugins <span className={styles['count']}>{data.plugins.filter((p) => p.active).length} active</span></h2>
            <div className={styles['hint']}>
                Optional features. Switching one writes <code>data/plugins.json</code> and takes effect after the server restarts.
                {data.envOverride ? <> <b>CINEMA_PLUGINS is set in the environment and wins over these switches.</b></> : null}
            </div>
            {changed ? <div className={styles['hint']}><b>Restart the server to apply your changes.</b></div> : null}
            <div className={styles['plugin-grid']}>
                {data.plugins.map((p) => {
                    const on = p.id in pending ? pending[p.id] : p.enabled;
                    const missing = (p.env || []).filter((e) => e.required && !e.set).map((e) => e.name);
                    const failed = !!p.error;
                    const state = failed ? 'failed' : (p.active ? 'active' : (missing.length ? 'needs' : 'off'));
                    const label = { failed: 'Failed to load', active: 'Active', needs: 'Needs setup', off: 'Off' }[state];
                    return (
                        <div key={p.id} className={classnames(styles['plugin-card'], styles[`state-${state}`])}>
                            <div className={styles['plugin-head']}>
                                <div className={styles['plugin-title']}>
                                    <span className={styles['plugin-name']}>{p.name}</span>
                                    <span className={styles['plugin-id']}>{p.id}{p.version ? ` · v${p.version}` : ''}{p.source === 'data' ? ' · private' : ''}</span>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={`${p.name}: ${on ? 'switch off' : 'switch on'}`}
                                    className={classnames(styles['switch'], { [styles['on']]: on })}
                                    disabled={data.envOverride}
                                    onClick={() => toggle(p)}
                                >
                                    <span className={styles['knob']} />
                                </button>
                            </div>
                            <div className={styles['plugin-desc']}>{p.description}</div>
                            <div className={styles['plugin-foot']}>
                                <span className={classnames(styles['pill'], styles[`pill-${state}`])}>{label}</span>
                                {on !== p.enabled ? <span className={styles['pill']}>Restart to apply</span> : null}
                                {failed ? <span className={styles['plugin-note']}>{p.error}</span> : null}
                                {!failed && !p.active && p.reason ? <span className={styles['plugin-note']}>{p.reason}</span> : null}
                                {missing.map((m) => <code key={m} className={styles['env-chip']}>{m}</code>)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};
Plugins.propTypes = { onError: PropTypes.func.isRequired };

module.exports = Plugins;
