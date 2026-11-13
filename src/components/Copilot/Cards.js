// Copyright (C) 2017-2026 HomeBot Cinema
// Cards the copilot shows inside the chat: titles (open / play) and staged actions (Confirm / Cancel).

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { api } = require('stremio/common/serverApi');
const { profileHeaders } = require('stremio/common/profileManager');
const styles = require('./styles');

const SWARM = { good: 'Peers ready', slow: 'Slow peers', dead: 'No peers' };

const useNow = (everyMs) => {
    const [now, setNow] = React.useState(Date.now());
    React.useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(t);
    }, [everyMs]);
    return now;
};

const TitleCard = ({ title, onNavigate }) => {
    const [broken, setBroken] = React.useState(false);
    const href = `#/detail/${title.type}/${title.id}`;
    return (
        <div className={styles['title-card']}>
            <a className={styles['title-poster']} href={href} onClick={onNavigate} title={title.title}>
                {title.poster && !broken ?
                    <img src={title.poster} alt="" loading="lazy" onError={() => setBroken(true)} />
                    :
                    <span className={styles['title-noart']}>{title.title}</span>}
                {title.onServer ? <span className={styles['title-badge']}>On server</span> : null}
            </a>
            <div className={styles['title-name']} title={title.title}>{title.title}</div>
            <div className={styles['title-sub']}>
                {[title.year, title.rating ? `★ ${Number(title.rating).toFixed(1)}` : null].filter(Boolean).join(' · ')}
            </div>
            <div className={styles['title-actions']}>
                {title.onServer && title.libraryId ?
                    <a className={classnames(styles['mini-btn'], styles['primary'])} href={`#/server/${title.libraryId}`} onClick={onNavigate}>▶ Play</a>
                    : null}
                <a className={styles['mini-btn']} href={href} onClick={onNavigate}>Details</a>
            </div>
        </div>
    );
};
TitleCard.propTypes = { title: PropTypes.object.isRequired, onNavigate: PropTypes.func };

const TitleStrip = ({ titles, onNavigate }) => (
    <div className={styles['title-strip']}>
        {titles.map((t) => <TitleCard key={t.id} title={t} onNavigate={onNavigate} />)}
    </div>
);
TitleStrip.propTypes = { titles: PropTypes.array.isRequired, onNavigate: PropTypes.func };

const friendlyConfirmError = (e) => {
    if (e.status === 409 && e.message === 'expired') return { status: 'EXPIRED', message: 'This expired. Ask me again and I will prepare it afresh.' };
    if (e.status === 409) return { status: 'DONE', message: 'This was already handled.' };
    if (e.status === 403) return { message: e.message === 'admin_only' ? 'Only an admin can confirm this.' : 'This belongs to someone else.' };
    if (e.status === 423) return { message: 'This profile is locked. Unlock it and try again.' };
    if (e.status === 502 && e.data && e.data.message) return { message: e.data.message };
    if (e.data && e.data.message) return { message: e.data.message };
    return { message: 'That did not work. Nothing was started; try again.' };
};

/** One staged action. Nothing has happened yet: it only runs when Confirm is pressed. */
const StagedCard = ({ action, onChange }) => {
    const [busy, setBusy] = React.useState(false);
    const [note, setNote] = React.useState('');
    const now = useNow(15000);
    const card = action.card || {};
    const pending = action.status === 'PENDING_CONFIRMATION' && now < action.expiresAt;
    const expired = (action.status === 'PENDING_CONFIRMATION' && now >= action.expiresAt) || action.status === 'EXPIRED';
    const minutesLeft = Math.max(1, Math.ceil((action.expiresAt - now) / 60000));

    const run = async (verb) => {
        setBusy(true);
        setNote('');
        try {
            const r = await api('POST', `/api/ai/staged/${encodeURIComponent(action.id)}/${verb}`, undefined, profileHeaders());
            onChange(r.action);
        } catch (e) {
            const f = friendlyConfirmError(e);
            if (f.status) onChange({ ...action, status: f.status });
            setNote(f.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={classnames(styles['staged'], { [styles['staged-done']]: !pending })}>
            <div className={styles['staged-head']}>
                {card.poster ? <img className={styles['staged-poster']} src={card.poster} alt="" /> : null}
                <div className={styles['staged-body']}>
                    <div className={styles['staged-kicker']}>{card.kind === 'monitor' ? 'Ready to monitor' : 'Ready to download'}</div>
                    <div className={styles['staged-title']}>{card.title}</div>
                    {card.kind === 'monitor' ?
                        <div className={styles['staged-line']}>{card.scopeLabel} · fetched automatically as they air</div>
                        :
                        <div className={styles['staged-line']}>
                            {[card.resolution, card.sizeGB ? `${card.sizeGB} GB` : null, SWARM[card.swarm]].filter(Boolean).join(' · ')}
                        </div>}
                    {card.kind === 'download' && card.release ? <div className={styles['staged-release']} title={card.release}>{card.release}</div> : null}
                    {card.qualityProfile ? <div className={styles['staged-release']}>Quality profile: {card.qualityProfile}</div> : null}
                </div>
            </div>
            {pending ?
                <>
                    <div className={styles['staged-actions']}>
                        <button type="button" className={classnames(styles['btn'], styles['btn-primary'])} disabled={busy} onClick={() => run('confirm')}>{busy ? 'Working…' : 'Confirm'}</button>
                        <button type="button" className={styles['btn']} disabled={busy} onClick={() => run('cancel')}>Cancel</button>
                        <span className={styles['staged-expiry']}>Expires in {minutesLeft} min</span>
                    </div>
                    {note ? <div className={styles['staged-note']}>{note}</div> : null}
                </>
                :
                <div className={styles['staged-result']}>
                    {action.status === 'CONFIRMED' ? (
                        card.kind === 'monitor' ?
                            <>✓ Monitoring started. New episodes will download on their own.</>
                            :
                            <>✓ Added to your downloads. <a href="#/downloads">Open Downloads</a></>
                    ) : action.status === 'CANCELLED' ? 'Cancelled. Nothing was started.'
                        : expired ? 'Expired. Ask me again and I will prepare it afresh.' : 'Done.'}
                    {note ? <div className={styles['staged-note']}>{note}</div> : null}
                </div>}
        </div>
    );
};
StagedCard.propTypes = { action: PropTypes.object.isRequired, onChange: PropTypes.func.isRequired };

module.exports = { TitleStrip, StagedCard };
