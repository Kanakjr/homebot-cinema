// Copyright (C) 2017-2026 HomeBot Cinema
// The AI copilot drawer (GrowwTrader-style): chat on the right, title cards and Confirm/Cancel cards inside the chat.
// It can only stage things; the user confirms them here. Server code: server/ai/.

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { useMatch } = require('react-router');
const { api, isAdmin } = require('stremio/common/serverApi');
const { profileHeaders } = require('stremio/common/profileManager');
const { useCopilot } = require('stremio/common/copilotState');
const BrandMark = require('stremio/components/BrandMark');
const { TitleStrip, StagedCard } = require('./Cards');
const styles = require('./styles');

const MAX_CHARS = 1000;
const MAX_TURNS_KEPT = 40;
const SEND_LAST = 20;

const TOOL_LABELS = {
    find_titles: 'Searched TMDB', search_titles: 'Searched titles', get_title: 'Looked up a title', get_server_library: 'Checked the server',
    get_downloads: 'Checked downloads', get_watch_history: 'Looked at your history', stage_download: 'Prepared a download', stage_monitor: 'Prepared a monitor',
};

const SUGGESTIONS = {
    adult: ['Something light to watch tonight', 'What did I leave unfinished?', 'What is new on the server?', 'What is downloading?'],
    kids: ['A funny cartoon movie', 'A cartoon series for kids', 'Something with animals', 'An adventure for the whole family'],
};

const storageKey = () => `homebot_copilot_chat:${window.ssoScope || 'p0'}`;
const loadTurns = () => {
    try {
        const raw = JSON.parse(window.sessionStorage.getItem(storageKey()) || '[]');
        return Array.isArray(raw) ? raw.slice(-MAX_TURNS_KEPT) : [];
    } catch (_) {
        return [];
    }
};
const saveTurns = (turns) => {
    try {
        window.sessionStorage.setItem(storageKey(), JSON.stringify(turns.slice(-MAX_TURNS_KEPT)));
    } catch (_) {
        // storage unavailable: the conversation is just not remembered across reloads
    }
};

const friendlyError = (e) => {
    if (e.status === 429) return `You are asking quickly. Try again in ${Math.max(1, Math.ceil(((e.data && e.data.retryAfterSec) || 60) / 60))} min.`;
    if (e.status === 423) return 'This profile is locked. Unlock it and try again.';
    if (e.status === 400 && e.message === 'message_too_long') return `Please keep messages under ${MAX_CHARS} characters.`;
    if (e.status === 502) return 'The AI service is not reachable right now. Try again in a moment.';
    if (e.status === 401 || e.status === 403) return 'Please sign in again.';
    return 'Something went wrong. Please try again.';
};

// The model is asked for plain text, but if it slips in **bold** or bullet markers they are shown tidily (never as HTML).
const FormattedText = ({ text }) => String(text).split('\n').map((line, i) => (
    <div key={i}>
        {(line.replace(/^\s*[*-]\s+/, '• ').split(/(\*\*[^*]+\*\*)/g)).map((part, j) => (/^\*\*[^*]+\*\*$/.test(part) ? <strong key={j}>{part.slice(2, -2)}</strong> : part)) || null}
        {line === '' ? '\u00a0' : null}
    </div>
));
FormattedText.propTypes = { text: PropTypes.string };

const Copilot = () => {
    const { open, setOpen, loaded, configured } = useCopilot();
    const isPlayer = useMatch('/player/*');
    const [turns, setTurns] = React.useState(loadTurns);
    const [input, setInput] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const listRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const turnId = React.useRef(Date.now());
    const kids = !!(window.ssoProfile && window.ssoProfile.isKid);
    const admin = isAdmin();

    React.useEffect(() => { saveTurns(turns); }, [turns]);
    React.useEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [turns, busy, open]);
    React.useEffect(() => {
        if (open && inputRef.current && window.matchMedia && window.matchMedia('(pointer: fine)').matches) inputRef.current.focus();
    }, [open]);
    React.useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, setOpen]);

    const send = React.useCallback(async (text) => {
        const content = String(text || '').trim().slice(0, MAX_CHARS);
        if (!content || busy) return;
        const next = [...turns, { id: ++turnId.current, role: 'user', content }];
        setTurns(next);
        setInput('');
        setBusy(true);
        try {
            const history = next.filter((t) => t.content && !t.error).slice(-SEND_LAST).map((t) => ({ role: t.role, content: t.content }));
            const r = await api('POST', '/api/ai/chat', { messages: history }, profileHeaders());
            setTurns((cur) => [...cur, { id: ++turnId.current, role: 'assistant', content: r.reply || '', titles: r.titles || [], staged: r.staged || [], trace: r.trace || [] }]);
        } catch (e) {
            setTurns((cur) => [...cur, { id: ++turnId.current, role: 'assistant', content: friendlyError(e), error: true }]);
        } finally {
            setBusy(false);
        }
    }, [turns, busy]);

    const updateStaged = (turnIdToChange, updated) => setTurns((cur) => cur.map((t) => (t.id !== turnIdToChange ? t : { ...t, staged: (t.staged || []).map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) })));
    // on a phone the drawer covers the page, so it closes when you follow a link
    const onNavigate = () => { if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) setOpen(false); };

    if (isPlayer || !loaded || (!configured && !admin)) return null;

    return (
        <aside className={classnames(styles['drawer'], { [styles['open']]: open })} role="complementary" aria-label="Copilot" aria-hidden={!open}>
            <header className={styles['head']}>
                <BrandMark size={26} />
                <div className={styles['head-title']}>Copilot<span className={styles['beta']}>beta</span></div>
                <div className={styles['head-actions']}>
                    {turns.length ? <button type="button" className={styles['icon-btn']} title="New chat" aria-label="New chat" onClick={() => setTurns([])}>↺</button> : null}
                    <button type="button" className={styles['icon-btn']} title="Close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
                </div>
            </header>

            {!configured ?
                <div className={styles['setup']}>
                    <strong>Not set up yet.</strong> Add <code>GEMINI_API_KEY</code> to the server settings, then restart the cinema container.
                </div>
                :
                <>
                    <div className={styles['list']} ref={listRef} aria-live="polite">
                        {turns.length === 0 ?
                            <div className={styles['welcome']}>
                                <div className={styles['welcome-title']}>{kids ? 'Hi! What shall we watch?' : 'What are we watching?'}</div>
                                <div className={styles['welcome-sub']}>
                                    {kids ? 'Ask me for a cartoon, a funny movie or something for the family.' : 'Ask for ideas, check the server, or have me prepare a download. You always confirm before anything starts.'}
                                </div>
                                <div className={styles['chips']}>
                                    {SUGGESTIONS[kids ? 'kids' : 'adult'].map((s) => <button key={s} type="button" className={styles['chip']} onClick={() => send(s)}>{s}</button>)}
                                </div>
                            </div>
                            : turns.map((t) => (
                                <div key={t.id} className={classnames(styles['turn'], styles[t.role], { [styles['turn-error']]: t.error })}>
                                    {t.content ? <div className={styles['bubble']}><FormattedText text={t.content} /></div> : null}
                                    {t.titles && t.titles.length ? <TitleStrip titles={t.titles} onNavigate={onNavigate} /> : null}
                                    {(t.staged || []).map((s) => <StagedCard key={s.id} action={s} onChange={(u) => updateStaged(t.id, u)} />)}
                                    {t.trace && t.trace.length ?
                                        <div className={styles['trace']}>
                                            {[...new Set(t.trace.filter((x) => x.ok && TOOL_LABELS[x.name]).map((x) => TOOL_LABELS[x.name]))].map((l) => <span key={l}>{l}</span>)}
                                        </div>
                                        : null}
                                </div>
                            ))}
                        {busy ? <div className={classnames(styles['turn'], styles['assistant'])}><div className={classnames(styles['bubble'], styles['thinking'])} aria-label="Thinking"><i /><i /><i /></div></div> : null}
                    </div>
                    <form className={styles['composer']} onSubmit={(e) => { e.preventDefault(); send(input); }}>
                        <textarea
                            ref={inputRef}
                            rows={1}
                            value={input}
                            maxLength={MAX_CHARS}
                            placeholder={kids ? 'Ask for a cartoon…' : 'Ask anything…'}
                            aria-label="Message the copilot"
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                        />
                        <button type="submit" className={styles['send']} disabled={busy || !input.trim()} aria-label="Send">➤</button>
                    </form>
                </>}
        </aside>
    );
};

module.exports = Copilot;
