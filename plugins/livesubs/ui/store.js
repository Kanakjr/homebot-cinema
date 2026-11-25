// Plugin "livesubs" (UI): the on/off switch shared by the menu item and the overlay. Remembered per browser.

const React = require('react');

const KEY = 'livesubs:mode'; // 'off' | 'on'
const listeners = new Set();

function read() {
    try {
        return window.localStorage.getItem(KEY) === 'on' ? 'on' : 'off';
    } catch (_) {
        return 'off';
    }
}

let mode = read();

function setMode(next) {
    mode = next === 'on' ? 'on' : 'off';
    try { window.localStorage.setItem(KEY, mode); } catch (_) { /* private window */ }
    listeners.forEach((fn) => fn(mode));
}

function useMode() {
    const [m, setM] = React.useState(mode);
    React.useEffect(() => {
        listeners.add(setM);
        return () => { listeners.delete(setM); };
    }, []);
    return m;
}

module.exports = { getMode: () => mode, setMode, useMode };
