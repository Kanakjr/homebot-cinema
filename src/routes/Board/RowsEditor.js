// Copyright (C) 2017-2026 HomeBot Cinema
// "Customize rows": show, hide and reorder this profile's Home rows.

const React = require('react');
const PropTypes = require('prop-types');
const styles = require('./rows-editor.less');

const RowsEditor = ({ rows, onToggle, onMove, onClose }) => {
    React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);
    return (
        <div className={styles['scrim']} onMouseDown={onClose}>
            <div className={styles['panel']} role="dialog" aria-label="Customize rows" onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles['head']}>
                    <h2>Customize Home rows</h2>
                    <button type="button" className={styles['done']} onClick={onClose}>Done</button>
                </div>
                <p className={styles['hint']}>Applies to this profile on this device.</p>
                <ul>
                    {rows.map((r, i) => (
                        <li key={r.key} className={r.hidden ? styles['off'] : ''}>
                            <label>
                                <input type="checkbox" checked={!r.hidden} onChange={() => onToggle(r.key)} />
                                <span>{r.title}</span>
                            </label>
                            <span className={styles['moves']}>
                                <button type="button" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => onMove(r.key, -1)}>↑</button>
                                <button type="button" aria-label={`Move ${r.title} down`} disabled={i === rows.length - 1} onClick={() => onMove(r.key, 1)}>↓</button>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

RowsEditor.propTypes = {
    rows: PropTypes.array.isRequired,
    onToggle: PropTypes.func.isRequired,
    onMove: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

module.exports = RowsEditor;
