// Copyright (C) 2017-2026 HomeBot Cinema
// Pure logic helpers for Game controllers plugin.

function actionOptions(actions) {
    if (!Array.isArray(actions)) {
        return [];
    }
    return actions.map((action) => ({
        value: action.id,
        label: action.player ? `${action.label} (player)` : action.label,
    }));
}

function stickOptions(modes) {
    if (!modes || typeof modes !== 'object') {
        return [];
    }
    return Object.keys(modes).map((mode) => ({
        value: mode,
        label: modes[mode],
    }));
}

function batteryText(pad) {
    if (!pad || pad.battery === null || typeof pad.battery !== 'number' || isNaN(pad.battery)) {
        return '';
    }
    const pct = `${Math.round(pad.battery * 100)}%`;
    return pad.charging ? `${pct} · charging` : pct;
}

function isLowBattery(pad) {
    if (!pad || pad.battery === null || typeof pad.battery !== 'number' || isNaN(pad.battery)) {
        return false;
    }
    return pad.battery <= 0.15 && !pad.charging;
}

// The app stamps each controller with the time it connected (Unix ms).
const JUST_CONNECTED_MS = 10000;
function justConnected(pad, now) {
    if (!pad || typeof pad.connectedAt !== 'number') {
        return false;
    }
    const age = now - pad.connectedAt;
    return age >= -1000 && age < JUST_CONNECTED_MS;
}

function newPads(prevIds, pads) {
    if (!Array.isArray(pads)) {
        return [];
    }
    const set = prevIds instanceof Set ? prevIds : new Set(prevIds || []);
    return pads.filter((pad) => pad && !set.has(`${pad.slot}:${pad.id}`));
}

module.exports = {
    actionOptions,
    stickOptions,
    batteryText,
    isLowBattery,
    justConnected,
    newPads,
};
