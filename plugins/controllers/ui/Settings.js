// Copyright (C) 2017-2026 HomeBot Cinema
// Settings section for Game controllers.

const React = require('react');
const { forwardRef, useMemo } = React;
const classNames = require('classnames');
const { Button, MultiselectMenu } = require('stremio/components');
const { Section, Option } = require('stremio/routes/Settings/components');
const { usePad } = require('./usePad');
const { actionOptions, stickOptions, batteryText } = require('./logic');
const styles = require('./Settings.less');

const Settings = forwardRef((_props, ref) => {
    const padApi = typeof window !== 'undefined' ? window.__cinemaPad : null;
    const { available, state } = usePad();

    const currentState = state || (padApi ? padApi.getState() : null);
    const pads = (currentState && currentState.pads) || [];
    const config = (currentState && currentState.config) || { preset: 'tv', overrides: {}, sticks: {} };
    const bindings = (currentState && currentState.bindings) || { buttons: {}, sticks: {} };

    const inputs = (padApi && padApi.INPUTS) || [];
    const inputLabels = (padApi && padApi.INPUT_LABELS) || {};
    const sticks = (padApi && padApi.STICKS) || [];
    const stickLabels = (padApi && padApi.STICK_LABELS) || {};

    const actionOpts = useMemo(() => actionOptions((padApi && padApi.ACTIONS) || []), [padApi]);
    const stickOpts = useMemo(() => stickOptions((padApi && padApi.STICK_MODES) || {}), [padApi]);
    const presetOpts = useMemo(
        () => (((padApi && padApi.PRESETS) || []).map((p) => ({ value: p.id, label: p.label }))),
        [padApi]
    );

    const hasPadBinding = useMemo(() => {
        if (!currentState || !currentState.bindings) {
            return false;
        }
        const buttonPad = Object.values(currentState.bindings.buttons || {}).some(
            (a) => typeof a === 'string' && a.indexOf('pad.') === 0
        );
        const stickPad = Object.values(currentState.bindings.sticks || {}).some((m) => m === 'pad');
        return buttonPad || stickPad;
    }, [currentState]);

    if (!available) {
        return (
            <Section ref={ref} label={'Controllers'}>
                <div className={styles['hint']}>
                    Controllers work in the HomeBot Cinema desktop app for Mac (Xbox, PlayStation, other MFi controllers; pair them in macOS System Settings &gt; Bluetooth).
                </div>
            </Section>
        );
    }

    return (
        <Section ref={ref} label={'Controllers'}>
            <Option label={'Connected'}>
                {pads.length === 0 ? (
                    <div className={styles['empty-hint']}>
                        No controller connected. Turn one on (pair it in System Settings &gt; Bluetooth first).
                    </div>
                ) : (
                    <div className={styles['pads-list']}>
                        {pads.map((pad) => {
                            const batt = batteryText(pad);
                            return (
                                <div key={`${pad.slot}:${pad.id}`} className={styles['pad-badge']}>
                                    <span className={styles['pad-name']}>{pad.id}</span>
                                    {batt ? <span className={styles['battery-chip']}>{batt}</span> : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Option>

            <Option label={'Layout'}>
                <MultiselectMenu
                    className={'multiselect'}
                    options={presetOpts}
                    value={config.preset}
                    onSelect={(value) => {
                        if (padApi && typeof padApi.setConfig === 'function') {
                            padApi.setConfig({
                                ...config,
                                preset: value,
                                overrides: {},
                                sticks: {},
                            });
                        }
                    }}
                />
            </Option>

            <Option label={'Your changes'}>
                <Button
                    className={'button'}
                    onClick={() => {
                        if (padApi && typeof padApi.resetConfig === 'function') {
                            padApi.resetConfig();
                        }
                    }}
                >
                    Reset layout
                </Button>
            </Option>

            {inputs.map((input) => {
                const isPressed = pads.some((p) => p.pressed && p.pressed[input]);
                const label = inputLabels[input] || input;
                const value = bindings.buttons ? bindings.buttons[input] : undefined;
                return (
                    <Option
                        key={input}
                        className={classNames(styles['input-row'], { [styles['pressed']]: isPressed })}
                        label={label}
                    >
                        <MultiselectMenu
                            className={'multiselect'}
                            options={actionOpts}
                            value={value}
                            onSelect={(actionId) => {
                                if (padApi && typeof padApi.setConfig === 'function') {
                                    padApi.setConfig({
                                        ...config,
                                        overrides: {
                                            ...(config.overrides || {}),
                                            [input]: actionId,
                                        },
                                    });
                                }
                            }}
                        />
                    </Option>
                );
            })}

            {sticks.map((stick) => {
                const label = stickLabels[stick] || stick;
                const value = bindings.sticks ? bindings.sticks[stick] : undefined;
                return (
                    <Option
                        key={stick}
                        className={styles['input-row']}
                        label={label}
                    >
                        <MultiselectMenu
                            className={'multiselect'}
                            options={stickOpts}
                            value={value}
                            onSelect={(mode) => {
                                if (padApi && typeof padApi.setConfig === 'function') {
                                    padApi.setConfig({
                                        ...config,
                                        sticks: {
                                            ...(config.sticks || {}),
                                            [stick]: mode,
                                        },
                                    });
                                }
                            }}
                        />
                    </Option>
                );
            })}

            <div className={styles['hint']}>
                Press a button on the controller to see which row it is.
            </div>
            {hasPadBinding && (
                <div className={styles['hint']}>
                    Gamepad bindings require Settings &gt; Interface &gt; Gamepad switched on.
                </div>
            )}
        </Section>
    );
});

Settings.displayName = 'ControllersSettings';

module.exports = Settings;
