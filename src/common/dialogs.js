// Copyright (C) 2017-2026 HomeBot Cinema
// In-app confirm and prompt dialogs. Never use window.confirm()/prompt()/alert(): the macOS app's web view (wry) has no
// handler for them and answers "cancel" at once, which silently broke every delete button there (eslint no-alert).
//
//   if (await confirmDialog({ title: 'Delete "X"?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) ...
//   const name = await promptDialog({ title: 'Profile name', initial: p.name });   // string, or null when cancelled
//
// Each dialog renders into its own React root on document.body, so it works anywhere, even before the router exists
// (the profile picker). Enter activates the focused button, Escape/Backspace cancels, arrows move between buttons, so a
// remote or game controller can answer it. Dialogs asked for while one is open wait their turn.

const React = require('react');
const ReactDOM = require('react-dom/client');
const PropTypes = require('prop-types');
const { dialogKeyAction, moveFocus } = require('./dialogKeys');
const styles = require('./dialogs.less');

const Dialog = ({ kind, title, message, label, initial, placeholder, confirmLabel, cancelLabel, danger, inputType, onDone }) => {
    const [value, setValue] = React.useState(initial || '');
    const boxRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const confirmRef = React.useRef(null);
    const cancelRef = React.useRef(null);
    const isPrompt = kind === 'prompt';

    const finish = React.useCallback((ok) => {
        if (isPrompt) onDone(ok ? value : null);
        else onDone(!!ok);
    }, [isPrompt, onDone, value]);

    React.useEffect(() => {
        const el = isPrompt ? inputRef.current : (danger ? cancelRef.current : confirmRef.current);
        if (el) {
            el.focus();
            if (isPrompt && typeof el.select === 'function') el.select();
        }
    }, [isPrompt, danger]);

    React.useEffect(() => {
        const onKey = (event) => {
            const box = boxRef.current;
            if (!box) return;
            const focusables = [inputRef.current, cancelRef.current, confirmRef.current].filter(Boolean);
            const active = document.activeElement;
            const action = dialogKeyAction(event.key, { inInput: active === inputRef.current, shift: event.shiftKey });
            if (!action) return;
            // the dialog owns the keyboard while it is open: app shortcuts (player keys, Esc layering) must not fire
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            if (action === 'cancel') return finish(false);
            if (action === 'enter') {
                if (active === cancelRef.current) return finish(false);
                return finish(true); // the confirm button, the text field, or nothing focused
            }
            const next = moveFocus(focusables.indexOf(active), focusables.length, action);
            if (next >= 0) focusables[next].focus();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [finish]);

    return (
        <div className={styles['overlay']} onMouseDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
            {/* data-gamepad-modal: the Mac app's controller navigation keeps focus inside (gamepad_shim.js getScope) */}
            <div ref={boxRef} className={styles['dialog']} role={'alertdialog'} aria-modal={'true'} aria-labelledby={'cinema-dialog-title'} data-gamepad-modal={''}>
                <div id={'cinema-dialog-title'} className={styles['title']}>{title}</div>
                {message ? <div className={styles['message']}>{message}</div> : null}
                {isPrompt ? (
                    <label className={styles['field']}>
                        {label ? <span className={styles['label']}>{label}</span> : null}
                        <input
                            ref={inputRef}
                            className={styles['input']}
                            type={inputType || 'text'}
                            value={value}
                            placeholder={placeholder || ''}
                            spellCheck={false}
                            autoComplete={'off'}
                            onChange={(e) => setValue(e.target.value)}
                        />
                    </label>
                ) : null}
                <div className={styles['actions']}>
                    <button ref={cancelRef} type={'button'} className={styles['secondary']} onClick={() => finish(false)}>{cancelLabel || 'Cancel'}</button>
                    <button ref={confirmRef} type={'button'} className={danger ? styles['danger'] : styles['primary']} onClick={() => finish(true)}>
                        {confirmLabel || (isPrompt ? 'OK' : 'Confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
};

Dialog.propTypes = {
    kind: PropTypes.oneOf(['confirm', 'prompt']).isRequired,
    title: PropTypes.string.isRequired,
    message: PropTypes.string,
    label: PropTypes.string,
    initial: PropTypes.string,
    placeholder: PropTypes.string,
    confirmLabel: PropTypes.string,
    cancelLabel: PropTypes.string,
    danger: PropTypes.bool,
    inputType: PropTypes.string,
    onDone: PropTypes.func.isRequired,
};

let queue = Promise.resolve();

function open(props) {
    const shown = queue.then(() => new Promise((resolve) => {
        const previous = document.activeElement;
        const host = document.createElement('div');
        host.setAttribute('data-cinema-dialog', '');
        document.body.appendChild(host);
        const root = ReactDOM.createRoot(host);
        const onDone = (result) => {
            root.unmount();
            host.remove();
            try {
                if (previous && typeof previous.focus === 'function') previous.focus();
            } catch (_) {
                // the element that had focus is gone
            }
            resolve(result);
        };
        root.render(<Dialog {...props} onDone={onDone} />);
    }));
    queue = shown.catch(() => undefined);
    return shown;
}

/** Ask yes/no. Resolves true only when the user confirms. */
function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false } = {}) {
    return open({ kind: 'confirm', title: String(title || 'Are you sure?'), message, confirmLabel, cancelLabel, danger });
}

/** Ask for a line of text. Resolves the text (possibly empty), or null when cancelled. */
function promptDialog({ title, message, label, initial = '', placeholder, confirmLabel, cancelLabel, inputType } = {}) {
    return open({ kind: 'prompt', title: String(title || ''), message, label, initial: String(initial || ''), placeholder, confirmLabel, cancelLabel, inputType });
}

module.exports = { confirmDialog, promptDialog };
