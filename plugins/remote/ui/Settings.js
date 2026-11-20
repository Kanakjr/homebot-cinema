// Copyright (C) 2017-2026 HomeBot Cinema
// Plugin "remote": Settings > Remote & Cast.

const React = require('react');
const { forwardRef, useState } = React;
const { Toggle } = require('stremio/components');
const { Section, Option } = require('stremio/routes/Settings/components');
const { useRemoteState } = require('./remoteState');

const Settings = forwardRef((_props, ref) => {
    const {
        deviceId,
        deviceName,
        isDesktop,
        isReceiverEnabled,
        setDeviceName,
        setReceiverEnabled,
    } = useRemoteState();

    const [nameInput, setNameInput] = useState(deviceName);
    const [savedStatus, setSavedStatus] = useState('');

    const handleNameBlur = () => {
        if (nameInput.trim() && nameInput.trim() !== deviceName) {
            setDeviceName(nameInput.trim());
            setSavedStatus('Name saved');
            setTimeout(() => setSavedStatus(''), 2500);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.target.blur();
        }
    };

    return (
        <Section ref={ref} label={'Remote & Cast'}>
            <div style={{ color: 'rgba(255, 255, 255, 0.6)', marginBottom: '1.2rem', lineHeight: 1.5, fontSize: '0.95rem' }}>
                Control media playback on your Mac Mini from an Android phone, tablet, or another browser.
                Both devices talk directly to your HomeBot Cinema server with zero extra setup.
            </div>

            <Option label={'Screen name'}>
                <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={handleKeyDown}
                    style={{
                        padding: '0.5rem 0.8rem',
                        borderRadius: '0.4rem',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(0, 0, 0, 0.3)',
                        color: '#fff',
                        fontSize: '0.95rem',
                        outline: 'none',
                        minWidth: '15rem',
                    }}
                />
            </Option>

            <Option label={'Accept remote playback on this device'}>
                <Toggle
                    checked={isReceiverEnabled}
                    onClick={() => setReceiverEnabled(!isReceiverEnabled)}
                />
            </Option>

            <div style={{ marginTop: '1rem', color: 'rgba(255, 255, 255, 0.45)', fontSize: '0.85rem' }}>
                Device ID: <code style={{ color: '#fff', background: 'rgba(255, 255, 255, 0.1)', padding: '0.1rem 0.4rem', borderRadius: '0.3rem' }}>{deviceId}</code>
                {isDesktop ? ' · Native macOS desktop app' : ' · Web browser'}
                {savedStatus ? <span style={{ marginLeft: '1rem', color: 'var(--primary-accent-color, #23b247)' }}>{savedStatus}</span> : null}
            </div>
        </Section>
    );
});

Settings.displayName = 'RemoteSettings';

module.exports = Settings;
