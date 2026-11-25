// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "vault": the "Locked folder" tile at the end of Server library. Only for the admin on the owner profile (the
// server answers 403 to anyone else, and then nothing is shown). It never shows what is inside.

const React = require('react');
const PropTypes = require('prop-types');
const { api } = require('stremio/common/serverApi');
const styles = require('./styles.less');

const VaultTile = ({ admin }) => {
    const [status, setStatus] = React.useState(null);
    React.useEffect(() => {
        if (!admin) return undefined;
        let alive = true;
        api('GET', '/api/vault/status').then((s) => { if (alive) setStatus(s); }).catch(() => { if (alive) setStatus(null); });
        return () => { alive = false; };
    }, [admin]);
    if (!admin || !status) return null;
    const sub = !status.configured ? 'Set a passcode to start' : (status.online ? 'Opens with your passcode' : 'Drive not connected');
    return (
        <a className={styles['tile']} href="#/vault">
            <span className={styles['tile-icon']} aria-hidden="true">🔒</span>
            <span className={styles['tile-text']}>
                <span className={styles['tile-title']}>Locked folder</span>
                <span className={styles['tile-sub']}>{sub}</span>
            </span>
            <span className={styles['tile-go']} aria-hidden="true">›</span>
        </a>
    );
};
VaultTile.propTypes = { admin: PropTypes.bool };

module.exports = VaultTile;
