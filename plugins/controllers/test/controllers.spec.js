// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */

const plugin = require('../ui');
const { SLOTS } = require('../../../src/plugins/host');
const {
    actionOptions,
    stickOptions,
    batteryText,
    isLowBattery,
    justConnected,
    newPads,
} = require('../ui/logic');

describe('controllers plugin', () => {
    it('exports only known slots', () => {
        Object.keys(plugin).forEach((k) => expect(SLOTS).toContain(k));
    });

    describe('actionOptions', () => {
        it('formats regular actions into multiselect options', () => {
            const actions = [
                { id: 'select', label: 'Select' },
                { id: 'back', label: 'Back', player: false },
            ];
            expect(actionOptions(actions)).toEqual([
                { value: 'select', label: 'Select' },
                { value: 'back', label: 'Back' },
            ]);
        });

        it('appends (player) to player-only actions', () => {
            const actions = [
                { id: 'seekBack', label: 'Seek back', player: true },
                { id: 'mute', label: 'Mute', player: true },
            ];
            expect(actionOptions(actions)).toEqual([
                { value: 'seekBack', label: 'Seek back (player)' },
                { value: 'mute', label: 'Mute (player)' },
            ]);
        });

        it('handles null or non-array input', () => {
            expect(actionOptions(null)).toEqual([]);
            expect(actionOptions(undefined)).toEqual([]);
            expect(actionOptions('not an array')).toEqual([]);
        });
    });

    describe('stickOptions', () => {
        it('converts STICK_MODES object into options array', () => {
            const modes = {
                navigate: 'Move around',
                seekVolume: 'Seek and volume (player)',
                pad: 'Gamepad stick (built-in navigation)',
                none: 'Nothing',
            };
            expect(stickOptions(modes)).toEqual([
                { value: 'navigate', label: 'Move around' },
                { value: 'seekVolume', label: 'Seek and volume (player)' },
                { value: 'pad', label: 'Gamepad stick (built-in navigation)' },
                { value: 'none', label: 'Nothing' },
            ]);
        });

        it('handles null or invalid input', () => {
            expect(stickOptions(null)).toEqual([]);
            expect(stickOptions(undefined)).toEqual([]);
            expect(stickOptions(123)).toEqual([]);
        });
    });

    describe('batteryText', () => {
        it('returns empty string when battery is null or invalid', () => {
            expect(batteryText(null)).toBe('');
            expect(batteryText({})).toBe('');
            expect(batteryText({ battery: null })).toBe('');
            expect(batteryText({ battery: undefined })).toBe('');
            expect(batteryText({ battery: NaN })).toBe('');
        });

        it('formats battery percentage without charging', () => {
            expect(batteryText({ battery: 0.8, charging: false })).toBe('80%');
            expect(batteryText({ battery: 1, charging: false })).toBe('100%');
            expect(batteryText({ battery: 0, charging: false })).toBe('0%');
            expect(batteryText({ battery: 0.155, charging: false })).toBe('16%');
        });

        it('formats battery percentage with charging indicator', () => {
            expect(batteryText({ battery: 0.8, charging: true })).toBe('80% · charging');
            expect(batteryText({ battery: 0.15, charging: true })).toBe('15% · charging');
        });
    });

    describe('isLowBattery', () => {
        it('returns true when battery <= 0.15 and not charging', () => {
            expect(isLowBattery({ battery: 0.15, charging: false })).toBe(true);
            expect(isLowBattery({ battery: 0.05, charging: false })).toBe(true);
            expect(isLowBattery({ battery: 0, charging: false })).toBe(true);
        });

        it('returns false when battery is low but charging', () => {
            expect(isLowBattery({ battery: 0.15, charging: true })).toBe(false);
            expect(isLowBattery({ battery: 0.05, charging: true })).toBe(false);
        });

        it('returns false when battery > 0.15', () => {
            expect(isLowBattery({ battery: 0.16, charging: false })).toBe(false);
            expect(isLowBattery({ battery: 0.8, charging: false })).toBe(false);
        });

        it('returns false when battery is null, undefined, or invalid', () => {
            expect(isLowBattery(null)).toBe(false);
            expect(isLowBattery({})).toBe(false);
            expect(isLowBattery({ battery: null })).toBe(false);
            expect(isLowBattery({ battery: undefined })).toBe(false);
            expect(isLowBattery({ battery: NaN })).toBe(false);
        });
    });

    describe('newPads', () => {
        it('returns pads not present in the prevIds Set', () => {
            const prevIds = new Set(['0:Xbox Controller']);
            const pads = [
                { slot: 0, id: 'Xbox Controller' },
                { slot: 1, id: 'DualSense' },
            ];
            expect(newPads(prevIds, pads)).toEqual([{ slot: 1, id: 'DualSense' }]);
        });

        it('returns all pads when prevIds is empty', () => {
            const prevIds = new Set();
            const pads = [
                { slot: 0, id: 'Xbox Controller' },
                { slot: 1, id: 'DualSense' },
            ];
            expect(newPads(prevIds, pads)).toEqual(pads);
        });

        it('returns empty array when all pads were previously known', () => {
            const prevIds = new Set(['0:Xbox Controller', '1:DualSense']);
            const pads = [
                { slot: 0, id: 'Xbox Controller' },
                { slot: 1, id: 'DualSense' },
            ];
            expect(newPads(prevIds, pads)).toEqual([]);
        });

        it('handles null, undefined, or non-array pads gracefully', () => {
            const prevIds = new Set();
            expect(newPads(prevIds, null)).toEqual([]);
            expect(newPads(prevIds, undefined)).toEqual([]);
            expect(newPads(prevIds, 'not array')).toEqual([]);
        });
    });

    describe('justConnected', () => {
        const now = 1_700_000_100_000;

        it('is true only for controllers that connected in the last 10 seconds', () => {
            expect(justConnected({ connectedAt: now - 2000 }, now)).toBe(true);
            expect(justConnected({ connectedAt: now - 9999 }, now)).toBe(true);
            expect(justConnected({ connectedAt: now - 10000 }, now)).toBe(false);
            expect(justConnected({ connectedAt: now - 600000 }, now)).toBe(false);
        });

        it('tolerates a little clock skew but not a time in the future', () => {
            expect(justConnected({ connectedAt: now + 500 }, now)).toBe(true);
            expect(justConnected({ connectedAt: now + 5000 }, now)).toBe(false);
        });

        it('is false without a connection time', () => {
            expect(justConnected({ connectedAt: null }, now)).toBe(false);
            expect(justConnected({}, now)).toBe(false);
            expect(justConnected(null, now)).toBe(false);
        });
    });
});
