// Copyright (C) 2017-2026 HomeBot Cinema
// Per-profile look: accent colour, AMOLED black, corner radius. Applies instantly; saved to the household profile.

import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { Toggle } from 'stremio/components';
import { Section, Option } from '../components';
import styles from './Appearance.less';

const { ACCENTS, DEFAULT_ACCENT, DEFAULT_SETTINGS, applyTheme } = require('stremio/common/theme');
const pm = require('stremio/common/profileManager');

type Look = { amoled: boolean, cornerRadius: number };
type Patch = { accent?: string, settings?: Partial<Look> };

const Appearance = forwardRef<HTMLDivElement>((_props, ref) => {
    const active = (window as any).ssoProfile || null;
    const [accent, setAccent] = useState<string>((active && active.accent) || DEFAULT_ACCENT);
    const [look, setLook] = useState<Look>({ ...DEFAULT_SETTINGS, ...((active && active.settings) || {}) });
    const [status, setStatus] = useState('');
    const pending = useRef<Patch>({});
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // changes are batched and saved 400 ms after the last tweak (a dragged slider is one save)
    const save = useCallback((patch: Patch) => {
        pending.current = {
            ...pending.current,
            ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
            settings: { ...(pending.current.settings || {}), ...(patch.settings || {}) },
        };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            const body = pending.current;
            pending.current = {};
            setStatus('Saving…');
            pm.updateProfile(active.id, body, pm.profileHeaders())
                .then((saved: any) => {
                    (window as any).ssoProfile = saved;
                    setStatus('Saved to this profile');
                })
                .catch((e: Error) => setStatus(`Not saved: ${e.message}`));
        }, 400);
    }, [active]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const change = (nextAccent: string, nextLook: Look, patch: Patch) => {
        setAccent(nextAccent);
        setLook(nextLook);
        applyTheme({ ...active, accent: nextAccent, settings: { ...((active && active.settings) || {}), ...nextLook } });
        save(patch);
    };

    // spread like the other settings toggles (Toggle forwards onClick to its Button)
    const amoledToggle = {
        checked: !!look.amoled,
        onClick: () => change(accent, { ...look, amoled: !look.amoled }, { settings: { amoled: !look.amoled } }),
    };

    if (!active) return null;
    return (
        <Section ref={ref} label={'Appearance'}>
            <div className={styles['hint']}>For the profile “{active.name}”. Other profiles keep their own look.</div>
            <Option label={'Accent colour'}>
                <div className={styles['swatches']}>
                    {Object.entries(ACCENTS).map(([key, a]: [string, any]) => (
                        <button
                            key={key}
                            type={'button'}
                            title={a.label}
                            aria-label={a.label}
                            aria-pressed={accent === key}
                            className={classnames(styles['swatch'], { [styles['selected']]: accent === key })}
                            style={{ background: a.color }}
                            onClick={() => change(key, look, { accent: key })}
                        />
                    ))}
                </div>
            </Option>
            <Option label={'Pure black background (AMOLED)'}>
                <Toggle tabIndex={-1} {...amoledToggle} />
            </Option>
            <Option label={'Corner radius'}>
                <div className={styles['range']}>
                    <input
                        type={'range'}
                        min={0}
                        max={28}
                        step={2}
                        value={Number(look.cornerRadius) || 0}
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            change(accent, { ...look, cornerRadius: v }, { settings: { cornerRadius: v } });
                        }}
                    />
                    <span className={styles['value']}>{Number(look.cornerRadius) || 0}px</span>
                </div>
            </Option>
            {status ? <div className={styles['status']}>{status}</div> : null}
        </Section>
    );
});

export default Appearance;
