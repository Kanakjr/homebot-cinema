// Copyright (C) 2017-2026 HomeBot Cinema
// "Who's watching?" screen: pick / add / edit profiles, PIN pad, avatar chooser.

const React = require('react');
const PropTypes = require('prop-types');
const classNames = require('classnames');
const pm = require('stremio/common/profileManager');
const { BrandLockup } = require('stremio/components/BrandMark');
const { ACCENTS, DEFAULT_ACCENT } = require('stremio/common/theme');
const styles = require('./styles');

const PIN_LENGTH = 4;

const PinPad = ({ title, subtitle, error, onSubmit, onCancel }) => {
    const [pin, setPin] = React.useState('');
    const push = (d) => {
        if (pin.length >= PIN_LENGTH) return;
        const next = pin + d;
        setPin(next);
        if (next.length === PIN_LENGTH) {
            Promise.resolve(onSubmit(next)).finally(() => setPin(''));
        }
    };
    React.useEffect(() => {
        const onKey = (e) => {
            if (/^\d$/.test(e.key)) push(e.key);
            else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
            else if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });
    return (
        <div className={styles['overlay']} onClick={onCancel}>
            <div className={styles['modal']} onClick={(e) => e.stopPropagation()}>
                <div className={styles['modal-title']}>{title}</div>
                {subtitle ? <div className={styles['modal-sub']}>{subtitle}</div> : null}
                <div className={styles['pin-dots']}>
                    {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                        <span key={i} className={classNames(styles['pin-dot'], { [styles['filled']]: i < pin.length })} />
                    ))}
                </div>
                <div className={styles['pin-error']}>{error || ' '}</div>
                <div className={styles['keypad']}>
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                        <button key={d} type="button" onClick={() => push(d)}>{d}</button>
                    ))}
                    <button type="button" className={styles['ghost']} onClick={onCancel}>Cancel</button>
                    <button type="button" onClick={() => push('0')}>0</button>
                    <button type="button" className={styles['ghost']} onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
                </div>
            </div>
        </div>
    );
};
PinPad.propTypes = {
    title: PropTypes.string,
    subtitle: PropTypes.string,
    error: PropTypes.string,
    onSubmit: PropTypes.func,
    onCancel: PropTypes.func
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    // downscale to 256px so uploads stay small
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = url;
});

const Editor = ({ profile, isAdmin, avatars, headers, onClose, onSaved, onDeleted }) => {
    const isNew = !profile;
    const [name, setName] = React.useState(profile ? profile.name : '');
    const [avatar, setAvatar] = React.useState(profile ? profile.avatar : avatars[0] && avatars[0].url);
    const [isKid, setIsKid] = React.useState(profile ? profile.isKid : false);
    const [accent, setAccent] = React.useState((profile && profile.accent) || DEFAULT_ACCENT);
    const [amoled, setAmoled] = React.useState(profile && profile.settings && profile.settings.amoled !== undefined ? !!profile.settings.amoled : true);
    const [pin, setPin] = React.useState('');
    const [currentPin, setCurrentPin] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const fileRef = React.useRef(null);

    const run = async (fn) => {
        setBusy(true);
        setError('');
        try {
            await fn();
        } catch (e) {
            setError(e.data && e.data.error === 'bad_pin' ? 'Current PIN is wrong' : e.message);
        } finally {
            setBusy(false);
        }
    };

    const save = () => run(async () => {
        if (pin && !/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits');
        let saved;
        const look = { accent, settings: { amoled } };
        if (isNew) {
            saved = await pm.createProfile({ name, avatar, isKid, pin: pin || undefined });
            // a brand-new PIN-locked profile needs its unlock token before it can be edited again: set the look later
            if (!pin) saved = await pm.updateProfile(saved.id, look, headers);
        } else {
            saved = await pm.updateProfile(profile.id, { name, avatar, isKid, ...look }, headers);
            if (pin) await pm.setPin(profile.id, pin, currentPin, headers);
        }
        onSaved(saved);
    });

    const onFile = (e) => run(async () => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const { url } = await pm.uploadAvatar(await fileToDataUrl(file));
        setAvatar(url);
    });

    return (
        <div className={styles['overlay']} onClick={onClose}>
            <div className={classNames(styles['modal'], styles['editor'])} onClick={(e) => e.stopPropagation()}>
                <div className={styles['modal-title']}>{isNew ? 'Add profile' : 'Edit profile'}</div>
                <img className={styles['editor-avatar']} src={avatar} alt="" />
                <input className={styles['text-input']} value={name} maxLength={24} placeholder="Name" onChange={(e) => setName(e.target.value)} autoFocus />
                <div className={styles['avatar-grid']}>
                    {avatars.map((a) => (
                        <button key={a.url} type="button" title={a.label} className={classNames(styles['avatar-choice'], { [styles['selected']]: avatar === a.url })} onClick={() => setAvatar(a.url)}>
                            <img src={a.url} alt="" />
                        </button>
                    ))}
                    <button type="button" className={styles['avatar-choice']} onClick={() => fileRef.current && fileRef.current.click()} title="Upload a picture">＋</button>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
                </div>
                <label className={styles['toggle-row']}>
                    <input type="checkbox" checked={isKid} onChange={(e) => setIsKid(e.target.checked)} />
                    <span>Kids profile</span>
                </label>
                <label className={styles['toggle-row']}>
                    <input type="checkbox" checked={amoled} onChange={(e) => setAmoled(e.target.checked)} />
                    <span>AMOLED black background</span>
                </label>
                <div className={styles['field-label']}>Accent colour</div>
                <div className={styles['swatches']}>
                    {Object.entries(ACCENTS).map(([key, a]) => (
                        <button
                            key={key}
                            type="button"
                            title={a.label}
                            className={classNames(styles['swatch'], { [styles['selected']]: accent === key })}
                            style={{ background: a.color }}
                            onClick={() => setAccent(key)}
                        />
                    ))}
                </div>
                {!isNew && profile.hasPin && !isAdmin ?
                    <input className={styles['text-input']} inputMode="numeric" maxLength={4} placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} />
                    : null}
                <input
                    className={styles['text-input']}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder={!isNew && profile.hasPin ? 'New 4-digit PIN (optional)' : 'PIN lock, 4 digits (optional)'}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
                {!isNew && profile.hasPin ?
                    <button type="button" className={styles['link-btn']} disabled={busy} onClick={() => run(async () => {
                        await pm.removePin(profile.id, currentPin);
                        onSaved({ ...profile, hasPin: false });
                    })}>Remove PIN</button>
                    : null}
                {error ? <div className={styles['form-error']}>{error}</div> : null}
                <div className={styles['modal-actions']}>
                    {!isNew && isAdmin ?
                        <button type="button" className={styles['danger']} disabled={busy} onClick={() => {
                            if (window.confirm(`Delete profile "${profile.name}" and its library?`)) {
                                run(async () => {
                                    await pm.deleteProfile(profile.id);
                                    onDeleted(profile);
                                });
                            }
                        }}>Delete</button>
                        : <span />}
                    <span>
                        <button type="button" className={styles['secondary']} onClick={onClose}>Cancel</button>
                        <button type="button" className={styles['primary']} disabled={busy || !name.trim()} onClick={save}>Save</button>
                    </span>
                </div>
            </div>
        </div>
    );
};
Editor.propTypes = {
    profile: PropTypes.object,
    isAdmin: PropTypes.bool,
    avatars: PropTypes.array,
    headers: PropTypes.object,
    onClose: PropTypes.func,
    onSaved: PropTypes.func,
    onDeleted: PropTypes.func
};

const ProfilePicker = ({ isAdmin, onDone }) => {
    const [profiles, setProfiles] = React.useState(null);
    const [avatars, setAvatars] = React.useState([]);
    const [manage, setManage] = React.useState(false);
    const [remember, setRemember] = React.useState(true);
    const [pinFor, setPinFor] = React.useState(null); // { profile, purpose }
    const [pinError, setPinError] = React.useState('');
    const [editing, setEditing] = React.useState(null); // { profile|null, headers }
    const [error, setError] = React.useState('');

    const reload = React.useCallback(async () => {
        try {
            setProfiles(await pm.fetchProfiles());
        } catch (e) {
            setError(e.message);
        }
    }, []);
    React.useEffect(() => {
        reload();
        pm.fetchAvatars().then(setAvatars).catch((e) => setError(e.message));
    }, [reload]);

    const finish = (profile, token) => onDone({ profile, token, remember });

    const choose = async (profile) => {
        setError('');
        if (manage) {
            if (profile.hasPin && !isAdmin) setPinFor({ profile, purpose: 'edit' });
            else setEditing({ profile, headers: {} });
            return;
        }
        if (profile.hasPin) {
            setPinFor({ profile, purpose: 'open' });
            return;
        }
        try {
            const { token } = await pm.unlockProfile(profile.id);
            finish(profile, token);
        } catch (e) {
            setError(e.message);
        }
    };

    const submitPin = async (pin) => {
        const { profile, purpose } = pinFor;
        try {
            const { token } = await pm.unlockProfile(profile.id, pin);
            setPinError('');
            setPinFor(null);
            if (purpose === 'open') finish(profile, token);
            else setEditing({ profile, headers: { 'X-Profile-Token': token } });
        } catch (e) {
            if (e.status === 429) setPinError(`Too many attempts. Try again in ${Math.ceil(((e.data && e.data.retryAfterSec) || 300) / 60)} min`);
            else setPinError(e.status === 401 ? 'Wrong PIN' : e.message);
        }
    };

    return (
        <div className={styles['picker']}>
            <BrandLockup size={44} className={styles['brand']} />
            <h1 className={styles['title']}>{manage ? 'Manage profiles' : 'Who\'s watching?'}</h1>
            {profiles === null ? <div className={styles['muted']}>Loading…</div> : (
                <div className={styles['grid']}>
                    {profiles.map((p) => (
                        <button key={p.id} type="button" className={styles['profile']} onClick={() => choose(p)}>
                            <span className={classNames(styles['avatar'], { [styles['editing']]: manage })}>
                                <img src={p.avatar} alt="" />
                                {p.hasPin ? <span className={styles['lock']}>🔒</span> : null}
                                {manage ? <span className={styles['edit-badge']}>✎</span> : null}
                            </span>
                            <span className={styles['name']}>{p.name}{p.isKid ? ' · Kids' : ''}</span>
                        </button>
                    ))}
                    {profiles.length < 8 ?
                        <button type="button" className={styles['profile']} onClick={() => setEditing({ profile: null, headers: {} })}>
                            <span className={classNames(styles['avatar'], styles['add'])}>＋</span>
                            <span className={styles['name']}>Add profile</span>
                        </button>
                        : null}
                </div>
            )}
            {error ? <div className={styles['form-error']}>{error}</div> : null}
            <label className={styles['pill']}>
                <span>Use this profile next time</span>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            </label>
            <div className={styles['footer-actions']}>
                <button type="button" className={styles['secondary']} onClick={() => setManage((m) => !m)}>{manage ? 'Done' : 'Manage profiles'}</button>
                <a className={styles['secondary']} href={pm.signOutUrl()}>Sign out</a>
            </div>
            {pinFor ?
                <PinPad
                    title={`Enter PIN for ${pinFor.profile.name}`}
                    error={pinError}
                    onSubmit={submitPin}
                    onCancel={() => { setPinFor(null); setPinError(''); }}
                />
                : null}
            {editing ?
                <Editor
                    profile={editing.profile}
                    isAdmin={isAdmin}
                    avatars={avatars}
                    headers={editing.headers}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); reload(); }}
                    onDeleted={() => { setEditing(null); reload(); }}
                />
                : null}
        </div>
    );
};
ProfilePicker.propTypes = {
    isAdmin: PropTypes.bool,
    onDone: PropTypes.func.isRequired
};

module.exports = ProfilePicker;
