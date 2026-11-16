// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "skip": Settings > Skip intro, per household profile (settings.skip = { autoIntro, autoRecap, upNextAtCredits }).

const React = require('react');
const { forwardRef, useCallback, useState } = React;
const { Toggle } = require('stremio/components');
const { Section, Option } = require('stremio/routes/Settings/components');
const pm = require('stremio/common/profileManager');
const { readPrefs } = require('./logic');
const styles = require('./Settings.less');

const Settings = forwardRef((_props, ref) => {
    const active = window.ssoProfile || null;
    const [prefs, setPrefs] = useState(() => readPrefs(active));
    const [status, setStatus] = useState('');

    const toggle = useCallback((name) => ({
        checked: !!prefs[name],
        onClick: () => {
            // the server merges settings one level deep: always send the whole skip object
            const next = { ...prefs, [name]: !prefs[name] };
            setPrefs(next);
            setStatus('Saving…');
            pm.updateProfile(active.id, { settings: { skip: next } }, pm.profileHeaders())
                .then((saved) => {
                    window.ssoProfile = saved;
                    setStatus('Saved to this profile');
                })
                .catch((e) => setStatus(`Not saved: ${e.message}`));
        },
    }), [prefs, active]);

    if (!active) return null;
    return (
        <Section ref={ref} label={'Skip intro'}>
            <div className={styles['hint']}>
                For the profile “{active.name}”. A Skip button shows during intros, recaps and end credits when their times are
                known: from chapter markers in your server’s files, otherwise from IntroDB, a community database.
            </div>
            <Option label={'Skip intros automatically'}>
                <Toggle tabIndex={-1} {...toggle('autoIntro')} />
            </Option>
            <Option label={'Skip recaps automatically'}>
                <Toggle tabIndex={-1} {...toggle('autoRecap')} />
            </Option>
            <Option label={'Show Up Next when the credits start'}>
                <Toggle tabIndex={-1} {...toggle('upNextAtCredits')} />
            </Option>
            {status ? <div className={styles['hint']}>{status}</div> : null}
        </Section>
    );
});

Settings.displayName = 'SkipSettings';

module.exports = Settings;
