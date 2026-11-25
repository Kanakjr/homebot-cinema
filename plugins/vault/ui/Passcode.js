// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault": the passcode screen. First visit: choose a passcode (typed twice). Later: unlock. A digits-only
// passcode gets a number pad, so it can be entered with a TV remote or a game controller; digit keys work too.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const { padInput, passcodeError } = require('./logic');
const { setToken } = require('./vaultState');
const styles = require('./styles.less');

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
const PAD_LABEL = { back: '⌫', clear: 'Clear' };

const NumberPad = ({ value, onChange, onSubmit, disabled }) => {
    const firstRef = React.useRef(null);
    // digits typed on a keyboard: Enter then unlocks. A remote or controller presses the focused key with Enter instead.
    const typed = React.useRef(false);
    const latest = React.useRef(value);
    latest.current = value;
    React.useEffect(() => { if (firstRef.current) firstRef.current.focus(); }, []);
    React.useEffect(() => {
        // the pad owns digits and Backspace: elsewhere in the app, number keys switch tabs and Backspace goes back
        const own = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        };
        const onKey = (e) => {
            if (disabled || (e.target && e.target.tagName === 'INPUT')) return;
            if (/^\d$/.test(e.key)) {
                own(e);
                typed.current = true;
                onChange((v) => padInput(v, e.key)); // fast typing: always build on the newest value
            } else if (e.key === 'Backspace') {
                own(e);
                onChange((v) => padInput(v, 'back'));
            } else if (e.key === 'Enter' && typed.current && latest.current.length >= 6) {
                own(e);
                onSubmit();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onChange, onSubmit, disabled]);
    const press = (k) => {
        typed.current = false;
        onChange((v) => padInput(v, k));
    };
    return (
        <>
            <div className={styles['dots']} aria-label={`${value.length} digits entered`}>
                {value.length ? '•'.repeat(value.length) : <span className={styles['dots-hint']}>Enter your passcode</span>}
            </div>
            <div className={styles['pad']}>
                {PAD.map((k, i) => (
                    <button key={k} ref={i === 0 ? firstRef : null} type="button" className={styles['pad-key']} disabled={disabled}
                        onClick={() => press(k)}>{PAD_LABEL[k] || k}</button>
                ))}
            </div>
            <button type="button" className={styles['primary']} disabled={disabled || value.length < 6} onClick={onSubmit}>Unlock</button>
        </>
    );
};
NumberPad.propTypes = { value: PropTypes.string, onChange: PropTypes.func, onSubmit: PropTypes.func, disabled: PropTypes.bool };

const Passcode = ({ status, onDone }) => {
    const setup = !status.configured;
    const [code, setCode] = React.useState('');
    const [again, setAgain] = React.useState('');
    const [error, setError] = React.useState(status.lockedForSec ? passcodeError({ message: 'locked', data: { retryAfterSec: status.lockedForSec } }) : '');
    const [busy, setBusy] = React.useState(false);
    const usePad = !setup && status.numeric;
    // read at submit time: the number pad's Enter can come before the last digit's re-render
    const codeRef = React.useRef(code);
    codeRef.current = code;
    const busyRef = React.useRef(false);

    const submit = async () => {
        const passcode = codeRef.current;
        if (busyRef.current) return;
        if (setup && passcode !== again) return setError('The two passcodes are not the same.');
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            const res = await api('POST', setup ? '/api/vault/setup' : '/api/vault/unlock', { passcode });
            setToken(res.token);
            onDone();
        } catch (e) {
            setError(passcodeError(e));
            setCode('');
            setAgain('');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };
    const onEnter = (e) => { if (e.key === 'Enter') submit(); };

    return (
        <div className={styles['gate']}>
            <div className={styles['gate-icon']} aria-hidden="true">🔒</div>
            <h1 className={styles['gate-title']}>{setup ? 'Set up your Locked folder' : 'Locked folder'}</h1>
            <p className={styles['gate-sub']}>
                {setup
                    ? 'Choose a passcode of at least 6 characters. Only digits gives you a number pad on the TV. It is separate from your profile PIN.'
                    : 'Enter the passcode to open it. It locks again when you leave it alone for a while.'}
            </p>
            {!status.online ? <div className={styles['notice']}>The drive with the Locked folder is not connected right now.</div> : null}
            {usePad ? (
                <NumberPad value={code} onChange={setCode} onSubmit={submit} disabled={busy} />
            ) : (
                <div className={styles['gate-form']}>
                    <input className={styles['field']} type="password" autoFocus autoComplete="off" spellCheck={false}
                        placeholder={setup ? 'New passcode' : 'Passcode'} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} />
                    {setup ? (
                        <input className={styles['field']} type="password" autoComplete="off" spellCheck={false}
                            placeholder="Type it again" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={onEnter} />
                    ) : null}
                    <button type="button" className={classnames(styles['primary'])} disabled={busy || code.length < 6 || (setup && !again)} onClick={submit}>
                        {setup ? 'Set passcode' : 'Unlock'}
                    </button>
                </div>
            )}
            {error ? <div className={styles['gate-error']} role="alert">{error}</div> : null}
            {!setup ? <p className={styles['gate-foot']}>Forgot it? It can only be reset on the server itself (see the vault plugin README).</p> : null}
        </div>
    );
};
Passcode.propTypes = { status: PropTypes.object.isRequired, onDone: PropTypes.func.isRequired };

module.exports = Passcode;
