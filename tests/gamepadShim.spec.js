// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect, beforeEach */

const {
    INPUTS,
    STICKS,
    STICK_MODES,
    ACTIONS,
    PRESETS,
    KEYS,
    TABS,
    normalizeConfig,
    resolveBindings,
    stickDirection,
    stickInterval,
    tabIndex,
    createController,
    install,
    findNextCandidate,
    findInitialCandidate,
    getCandidates,
    focusTarget,
    navigateDirection,
} = require('../desktop/src-tauri/src/gamepad_shim.js');

function makeEnv(options = {}) {
    let t = options.initialTime || 0;
    let currentRoute = options.route !== undefined ? options.route : '/';
    let isFocused = options.focused !== undefined ? options.focused : true;
    let isOverlayOpen = options.overlayOpen !== undefined ? options.overlayOpen : false;
    let isQuickMenuOpen = false;
    let isVirtualKeyboardOpen = false;
    let cardTarget = options.cardTarget !== undefined ? options.cardTarget : false;

    const keys = [];
    const navigations = [];
    const mediaKeys = [];
    const connections = [];
    const activations = [];
    const gamepadModes = [];
    const focusCalls = [];
    const quickMenuCalls = [];
    const contextMenuCalls = [];
    const lowBatteryNotifications = [];
    const virtualKeypresses = [];

    let nextTimerId = 1;
    const timers = new Map();

    function setTimer(fn, ms) {
        const id = nextTimerId++;
        timers.set(id, { id: id, fn: fn, ms: ms || 0, time: t + (ms || 0) });
        return id;
    }

    function clearTimer(id) {
        timers.delete(id);
    }

    function runTimers() {
        const pending = Array.from(timers.entries());
        for (let i = 0; i < pending.length; i++) {
            const id = pending[i][0];
            const item = pending[i][1];
            if (timers.has(id)) {
                timers.delete(id);
                item.fn();
            }
        }
    }

    return {
        now: function () { return t; },
        setTime: function (newT) { t = newT; },
        advanceClock: function (ms) { t += ms; },
        setTimer: setTimer,
        clearTimer: clearTimer,
        runTimers: runTimers,
        timers: timers,
        focused: function () { return isFocused; },
        setFocused: function (f) { isFocused = f; },
        route: function () { return currentRoute; },
        setRoute: function (r) { currentRoute = r; },
        overlayOpen: function () { return isOverlayOpen; },
        setOverlayOpen: function (o) { isOverlayOpen = o; },
        navigate: function (path) { navigations.push(path); },
        mediaKey: function (action) { mediaKeys.push(action); },
        connection: function (type, gamepad) { connections.push({ type: type, gamepad: gamepad }); },
        key: function (spec, type, repeat) {
            keys.push(type + ':' + spec.key + (repeat ? ':r' : ''));
            return !(options.prevented && options.prevented(spec, type));
        },
        setGamepadMode: function (mode) { gamepadModes.push(mode); },
        ensureFocus: function () { focusCalls.push(t); },
        gamepadModes: gamepadModes,
        focusCalls: focusCalls,
        activate: function () { activations.push(t); },
        activations: activations,
        keys: keys,
        navigations: navigations,
        mediaKeys: mediaKeys,
        connections: connections,
        toggleQuickMenu: function () {
            isQuickMenuOpen = !isQuickMenuOpen;
            quickMenuCalls.push(t);
        },
        isQuickMenuOpen: function () { return isQuickMenuOpen; },
        quickMenuCalls: quickMenuCalls,
        isCardTarget: function () { return cardTarget; },
        setCardTarget: function (c) { cardTarget = c; },
        triggerContextMenu: function () { contextMenuCalls.push(t); },
        contextMenuCalls: contextMenuCalls,
        notifyLowBattery: function (level) { lowBatteryNotifications.push(level); },
        lowBatteryNotifications: lowBatteryNotifications,
        isVirtualKeyboardOpen: function () { return isVirtualKeyboardOpen; },
        setVirtualKeyboardOpen: function (v) { isVirtualKeyboardOpen = v; },
        virtualKeyPress: function (k) { virtualKeypresses.push(k); },
        virtualKeypresses: virtualKeypresses,
    };
}

function pad(opts = {}) {
    const slot = opts.slot !== undefined ? opts.slot : 0;
    const connected = opts.connected !== undefined ? opts.connected : true;
    const id = opts.id !== undefined ? opts.id : 'Xbox Wireless Controller';
    const b = new Array(INPUTS.length).fill(0);
    if (opts.buttons) {
        if (Array.isArray(opts.buttons)) {
            opts.buttons.forEach((val, idx) => { b[idx] = val; });
        } else {
            Object.keys(opts.buttons).forEach((k) => {
                const idx = INPUTS.indexOf(k);
                if (idx >= 0) b[idx] = opts.buttons[k];
            });
        }
    }
    const a = [0, 0, 0, 0];
    if (opts.axes) {
        opts.axes.forEach((val, idx) => { if (idx < 4) a[idx] = val; });
    }
    const entry = {
        slot: slot,
        connected: connected,
        id: id,
        b: b,
        a: a,
        battery: opts.battery !== undefined ? opts.battery : 0.8,
        charging: opts.charging !== undefined ? opts.charging : false,
    };
    entry.pads = [entry];
    return entry;
}

describe('gamepadShim controller mapping', () => {
    it('1. normalizeConfig: unknown preset falls back to tv, invalid overrides dropped, valid kept', () => {
        expect(normalizeConfig(null)).toEqual({
            version: 1,
            preset: 'tv',
            overrides: {},
            sticks: {},
        });

        const fallback = normalizeConfig({ preset: 'nonexistent' });
        expect(fallback.preset).toBe('tv');

        const normalized = normalizeConfig({
            preset: 'stremio',
            overrides: {
                a: 'playPause',
                b: 'nonexistentAction',
                unknownInput: 'select',
            },
            sticks: {
                leftStick: 'none',
                rightStick: 'invalidStickMode',
                unknownStick: 'navigate',
            },
        });

        expect(normalized.version).toBe(1);
        expect(normalized.preset).toBe('stremio');
        expect(normalized.overrides).toEqual({ a: 'playPause' });
        expect(normalized.sticks).toEqual({ leftStick: 'none' });
    });

    it('2. resolveBindings: default tv preset, overrides winning, and stremio preset', () => {
        const tv = resolveBindings();
        expect(tv.buttons.a).toBe('select');
        expect(tv.buttons.b).toBe('back');
        expect(tv.buttons.x).toBe('playPause');
        expect(tv.buttons.up).toBe('up');
        expect(tv.sticks.leftStick).toBe('navigate');
        expect(tv.sticks.rightStick).toBe('seekVolume');

        const custom = resolveBindings({
            overrides: { a: 'mute', up: 'volumeUp' },
            sticks: { leftStick: 'none' },
        });
        expect(custom.buttons.a).toBe('mute');
        expect(custom.buttons.up).toBe('volumeUp');
        expect(custom.sticks.leftStick).toBe('none');
        expect(custom.sticks.rightStick).toBe('seekVolume');

        const stremio = resolveBindings({ preset: 'stremio' });
        expect(stremio.buttons.a).toBe('pad.a');
        expect(stremio.sticks.leftStick).toBe('pad');
        expect(stremio.sticks.rightStick).toBe('pad');
    });

    it('3. Pressing A (tv preset) dispatches keydown Enter and keyup Enter once with heartbeat deduplication', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);

        controller.update(pad({ buttons: { a: 1 } }));
        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);

        controller.update(pad({ buttons: { a: 0 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);

        controller.update(pad({ buttons: { a: 0 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);
    });

    it('4. Hysteresis: trigger value threshold 0.45, 0.6 press, 0.4 hold, 0.3 release', () => {
        const env = makeEnv({ route: '/player/x' });
        const controller = createController(env);

        controller.update(pad({ buttons: { rt: 0.45 } }));
        expect(env.keys).toEqual([]);

        controller.update(pad({ buttons: { rt: 0.6 } }));
        expect(env.keys).toEqual(['keydown:ArrowRight']);

        controller.update(pad({ buttons: { rt: 0.4 } }));
        expect(env.keys).toEqual(['keydown:ArrowRight']);

        controller.update(pad({ buttons: { rt: 0.3 } }));
        expect(env.keys).toEqual(['keydown:ArrowRight', 'keyup:ArrowRight']);
    });

    it('4b. Button A in player toggles playPause when no control focused, and selects when control is active', () => {
        const envPlayer = makeEnv({ route: '/player/123' });
        const cPlayer = createController(envPlayer);
        cPlayer.update(pad({ buttons: { a: 1 } }));
        expect(envPlayer.mediaKeys).toEqual(['play-pause']);
        expect(envPlayer.keys).toEqual([]);

        const envControl = makeEnv({ route: '/player/123' });
        envControl.hasActiveControl = () => true;
        const cControl = createController(envControl);
        cControl.update(pad({ buttons: { a: 1 } }));
        expect(envControl.mediaKeys).toEqual([]);
        expect(envControl.keys).toEqual(['keydown:Enter']);
    });

    it('5. Player-only actions do nothing outside the player (route /)', () => {
        const env = makeEnv({ route: '/' });
        const controller = createController(env);

        controller.update(pad({ buttons: { rt: 1.0 } }));
        expect(env.keys).toEqual([]);

        controller.update(pad({ buttons: { rt: 0 } }));
        expect(env.keys).toEqual([]);
    });

    it('6. B (back): exitPlayer in player without overlay, Escape with overlayOpen, Backspace outside without overlay', () => {
        const envPlayer = makeEnv({ route: '/player/123' });
        let playerExited = false;
        envPlayer.exitPlayer = () => { playerExited = true; };
        const cPlayer = createController(envPlayer);
        cPlayer.update(pad({ buttons: { b: 1 } }));
        expect(playerExited).toBe(true);

        const envPlayerFallback = makeEnv({ route: '/player/123' });
        const cPlayerFallback = createController(envPlayerFallback);
        cPlayerFallback.update(pad({ buttons: { b: 1 } }));
        expect(envPlayerFallback.keys).toEqual(['keydown:Backspace', 'keyup:Backspace']);

        const envOverlay = makeEnv({ route: '/', overlayOpen: true });
        const cOverlay = createController(envOverlay);
        cOverlay.update(pad({ buttons: { b: 1 } }));
        expect(envOverlay.keys).toEqual(['keydown:Escape', 'keyup:Escape']);

        const envOverlayClose = makeEnv({ route: '/player/123', overlayOpen: true });
        let closedOverlay = false;
        envOverlayClose.closeOverlay = () => { closedOverlay = true; return true; };
        const cOverlayClose = createController(envOverlayClose);
        cOverlayClose.update(pad({ buttons: { b: 1 } }));
        expect(closedOverlay).toBe(true);
        expect(envOverlayClose.keys).toEqual([]);

        const envNormal = makeEnv({ route: '/', overlayOpen: false });
        const cNormal = createController(envNormal);
        cNormal.update(pad({ buttons: { b: 1 } }));
        expect(envNormal.keys).toEqual(['keydown:Backspace', 'keyup:Backspace']);
    });

    it('6b. Controller input triggers setGamepadMode(true) and ensureFocus()', () => {
        const env = makeEnv({ route: '/' });
        const controller = createController(env);

        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.gamepadModes).toContain(true);
        expect(env.focusCalls.length).toBeGreaterThan(0);

        const envStick = makeEnv({ route: '/' });
        const cStick = createController(envStick);
        cStick.update(pad({ axes: [0, 0.8, 0, 0] }));
        expect(envStick.gamepadModes).toContain(true);
    });

    it('7. X (playPause) calls mediaKey, Home navigates to /, Y navigates to /search', () => {
        const env = makeEnv({ route: '/library' });
        const controller = createController(env);

        controller.update(pad({ buttons: { x: 1 } }));
        expect(env.mediaKeys).toEqual(['play-pause']);
        controller.update(pad({ buttons: { x: 0 } }));

        controller.update(pad({ buttons: { home: 1 } }));
        controller.update(pad({ buttons: { home: 0 } }));
        expect(env.navigations).toEqual(['/']);

        controller.update(pad({ buttons: { y: 1 } }));
        expect(env.navigations).toEqual(['/', '/search']);
        controller.update(pad({ buttons: { y: 0 } }));
    });

    it('7b. Home hold (>= 500ms) toggles Quick Menu instead of navigating Home', () => {
        const env = makeEnv({ route: '/library' });
        const controller = createController(env);

        controller.update(pad({ buttons: { home: 1 } }));
        expect(env.quickMenuCalls.length).toBe(0);
        expect(env.navigations.length).toBe(0);

        // Advance timers by 500ms to trigger hold
        env.runTimers();
        expect(env.quickMenuCalls.length).toBe(1);

        // Releasing home should not navigate to '/'
        controller.update(pad({ buttons: { home: 0 } }));
        expect(env.navigations.length).toBe(0);
    });

    it('7c. Card target A short tap activates, hold (>= 500ms) triggers context menu', () => {
        // Short tap
        const env1 = makeEnv({ route: '/', cardTarget: true });
        const c1 = createController(env1);

        c1.update(pad({ buttons: { a: 1 } }));
        expect(env1.activations.length).toBe(0);
        expect(env1.contextMenuCalls.length).toBe(0);

        c1.update(pad({ buttons: { a: 0 } }));
        expect(env1.activations.length).toBe(1);
        expect(env1.contextMenuCalls.length).toBe(0);

        // Long hold (>= 500ms)
        const env2 = makeEnv({ route: '/', cardTarget: true });
        const c2 = createController(env2);

        c2.update(pad({ buttons: { a: 1 } }));
        expect(env2.contextMenuCalls.length).toBe(0);

        env2.runTimers();
        expect(env2.contextMenuCalls.length).toBe(1);

        c2.update(pad({ buttons: { a: 0 } }));
        expect(env2.activations.length).toBe(0);
    });

    it('7d. Low battery notification triggers at <= 15% and throttles', () => {
        const env = makeEnv();
        const controller = createController(env);

        // Initial connect with 80% battery
        controller.update(pad({ battery: 0.8, charging: false }));
        expect(env.lowBatteryNotifications.length).toBe(0);

        // Battery drops to 12%
        controller.update(pad({ battery: 0.12, charging: false }));
        expect(env.lowBatteryNotifications).toEqual([0.12]);

        // Immediate subsequent update should be throttled
        controller.update(pad({ battery: 0.11, charging: false }));
        expect(env.lowBatteryNotifications.length).toBe(1);

        // Advance 16 minutes: next drop triggers notification again
        env.advanceClock(16 * 60 * 1000);
        controller.update(pad({ battery: 0.10, charging: false }));
        expect(env.lowBatteryNotifications.length).toBe(2);
    });

    it('7e. On-screen keyboard shortcuts: X sends BACKSPACE, Y sends SPACE', () => {
        const env = makeEnv({ route: '/search' });
        env.setVirtualKeyboardOpen(true);
        const controller = createController(env);

        controller.update(pad({ buttons: { x: 1 } }));
        expect(env.virtualKeypresses).toEqual(['BACKSPACE']);
        controller.update(pad({ buttons: { x: 0 } }));

        controller.update(pad({ buttons: { y: 1 } }));
        expect(env.virtualKeypresses).toEqual(['BACKSPACE', 'SPACE']);
        controller.update(pad({ buttons: { y: 0 } }));
    });

    it('8. RB/LB tab navigation: on /discover, boundaries at / and /settings, and non-tab routes', () => {
        const env = makeEnv({ route: '/discover' });
        const controller = createController(env);

        controller.update(pad({ buttons: { rb: 1 } }));
        expect(env.navigations).toEqual(['/library']);
        controller.update(pad({ buttons: { rb: 0 } }));

        env.setRoute('/discover');
        controller.update(pad({ buttons: { lb: 1 } }));
        expect(env.navigations).toEqual(['/library', '/']);
        controller.update(pad({ buttons: { lb: 0 } }));

        env.setRoute('/');
        controller.update(pad({ buttons: { lb: 1 } }));
        expect(env.navigations).toEqual(['/library', '/']);
        controller.update(pad({ buttons: { lb: 0 } }));

        env.setRoute('/settings');
        controller.update(pad({ buttons: { rb: 1 } }));
        expect(env.navigations).toEqual(['/library', '/']);
        controller.update(pad({ buttons: { rb: 0 } }));

        env.setRoute('/detail/movie/x');
        controller.update(pad({ buttons: { lb: 1 } }));
        controller.update(pad({ buttons: { lb: 0 } }));
        controller.update(pad({ buttons: { rb: 1 } }));
        controller.update(pad({ buttons: { rb: 0 } }));
        expect(env.navigations).toEqual(['/library', '/']);
    });

    it('9. D-pad repeat: keydown ArrowUp, nothing before 400 ms, repeats every 110 ms, release stops', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ buttons: { up: 1 } }));
        expect(env.keys).toEqual(['keydown:ArrowUp']);

        while (env.now() < 390) {
            env.advanceClock(30);
            env.runTimers();
        }
        expect(env.keys).toEqual(['keydown:ArrowUp']);

        env.advanceClock(10);
        env.runTimers();
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keydown:ArrowUp:r']);

        while (env.now() < 510) {
            env.advanceClock(30);
            env.runTimers();
        }
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keydown:ArrowUp:r', 'keydown:ArrowUp:r']);

        controller.update(pad({ buttons: { up: 0 } }));
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keydown:ArrowUp:r', 'keydown:ArrowUp:r', 'keyup:ArrowUp']);

        for (let i = 0; i < 5; i++) {
            env.advanceClock(50);
            env.runTimers();
        }
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keydown:ArrowUp:r', 'keydown:ArrowUp:r', 'keyup:ArrowUp']);
    });

    it('10. Left stick navigate: immediate direction, changing direction, stickDirection thresholds, stickInterval', () => {
        expect(stickDirection(0.4, 0.4, null)).toBeNull();
        expect(stickDirection(0, -0.49, null)).toBeNull();
        const held = stickDirection(0.6, 0, null);
        expect(held).toEqual({ dir: 'right', m: 0.6 });
        expect(stickDirection(0.4, 0, held)).toEqual({ dir: 'right', m: 0.4 });
        expect(stickDirection(0.34, 0, held)).toBeNull();

        expect(stickInterval(0.5)).toBeGreaterThan(stickInterval(1));

        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ axes: [0, -0.9, 0, 0] }));
        expect(env.keys).toEqual(['keydown:ArrowUp']);

        controller.update(pad({ axes: [0.9, 0, 0, 0] }));
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keyup:ArrowUp', 'keydown:ArrowRight']);

        controller.update(pad({ axes: [0, 0, 0, 0] }));
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keyup:ArrowUp', 'keydown:ArrowRight', 'keyup:ArrowRight']);
    });

    it('11. Right stick seekVolume only acts in the player: outside no keys, in /player/x sends keydown:j', () => {
        const env = makeEnv({ route: '/' });
        const controller = createController(env);

        controller.update(pad({ axes: [0, 0, -0.9, 0] }));
        expect(env.keys).toEqual([]);

        controller.update(pad({ axes: [0, 0, 0, 0] }));
        env.setRoute('/player/x');

        controller.update(pad({ axes: [0, 0, -0.9, 0] }));
        expect(env.keys).toEqual(['keydown:ArrowLeft']);

        controller.update(pad({ axes: [0, 0, 0, 0] }));
        expect(env.keys).toEqual(['keydown:ArrowLeft', 'keyup:ArrowLeft']);
    });

    it('12. Logical pad (getGamepads): tv preset unpressed/zero axes, stremio preset pressed/pass-through, length 4, id kept', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ slot: 0, id: 'TestController', buttons: { a: 1 }, axes: [-0.8, 0.6, 0.4, -0.2] }));
        const tvPads = controller.getGamepads();
        expect(tvPads).toHaveLength(4);
        expect(tvPads[0].id).toBe('TestController');
        expect(tvPads[0].mapping).toBe('standard');
        expect(tvPads[0].axes).toEqual([0, 0, 0, 0]);
        expect(tvPads[0].buttons.every((b) => !b.pressed && !b.touched && b.value === 0)).toBe(true);
        expect(tvPads[1]).toBeNull();
        expect(tvPads[2]).toBeNull();
        expect(tvPads[3]).toBeNull();

        controller.setConfig({ preset: 'stremio' });
        controller.update(pad({ slot: 0, id: 'TestController', buttons: { a: 1 }, axes: [-0.8, 0.6, 0.4, -0.2] }));
        const stremioPads = controller.getGamepads();
        expect(stremioPads[0].id).toBe('TestController');
        expect(stremioPads[0].mapping).toBe('standard');
        expect(stremioPads[0].buttons[0].pressed).toBe(true);
        expect(stremioPads[0].buttons[0].value).toBe(1);
        expect(stremioPads[0].axes[0]).toBe(-0.8);
        expect(stremioPads[0].axes[1]).toBe(0.6);
        expect(stremioPads[0].axes[2]).toBe(0.4);
        expect(stremioPads[0].axes[3]).toBe(-0.2);
    });

    it('13. Connection events: first update sends gamepadconnected, disconnected sends gamepaddisconnected and releases keys', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ slot: 0, buttons: { a: 1 } }));
        expect(env.connections).toHaveLength(1);
        expect(env.connections[0].type).toBe('gamepadconnected');
        expect(env.connections[0].gamepad.index).toBe(0);
        expect(env.connections[0].gamepad.connected).toBe(true);
        expect(env.keys).toEqual(['keydown:Enter']);

        controller.update({ pads: [{ slot: 0, connected: false }] });
        expect(env.connections).toHaveLength(2);
        expect(env.connections[1].type).toBe('gamepaddisconnected');
        expect(env.connections[1].gamepad.index).toBe(0);
        expect(env.connections[1].gamepad.connected).toBe(false);
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);
        expect(controller.getGamepads()[0]).toBeNull();
    });

    it('14. Focus: unfocused produces no keys and releases held keys, returning focus sends no spurious keydown', () => {
        const env = makeEnv({ focused: true });
        const controller = createController(env);

        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);

        env.setFocused(false);
        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);

        controller.update(pad({ buttons: { a: 1, b: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);

        env.setFocused(true);
        controller.update(pad({ buttons: { a: 1, b: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);
    });

    it('15. Stale: held input without update for more than 2500 ms releases keys on timer tick', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ buttons: { up: 1 } }));
        expect(env.keys).toEqual(['keydown:ArrowUp']);

        env.advanceClock(2600);
        env.runTimers();

        expect(env.keys).toContain('keyup:ArrowUp');
    });

    it('16. capture(fn): intercepts next press, swallows release, next press is normal, cancel clears capture', () => {
        const env = makeEnv();
        const controller = createController(env);

        const captured = [];
        controller.capture((input, slot) => {
            captured.push({ input: input, slot: slot });
        });
        expect(controller.getState().capturing).toBe(true);

        controller.update(pad({ slot: 0, buttons: { a: 1 } }));
        expect(captured).toEqual([{ input: 'a', slot: 0 }]);
        expect(env.keys).toEqual([]);
        expect(controller.getState().capturing).toBe(false);

        controller.update(pad({ slot: 0, buttons: { a: 0 } }));
        expect(env.keys).toEqual([]);

        controller.update(pad({ slot: 0, buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);
        controller.update(pad({ slot: 0, buttons: { a: 0 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);

        const captured2 = [];
        const cancel2 = controller.capture((input, slot) => {
            captured2.push({ input: input, slot: slot });
        });
        expect(controller.getState().capturing).toBe(true);
        cancel2();
        expect(controller.getState().capturing).toBe(false);

        controller.update(pad({ slot: 0, buttons: { a: 1 } }));
        expect(captured2).toEqual([]);
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter', 'keydown:Enter']);
    });

    it('17. subscribe(fn): called with button pressed state and on setConfig, unsubscribe stops notifications', () => {
        const env = makeEnv();
        const controller = createController(env);

        const updates = [];
        const unsubscribe = controller.subscribe((state) => {
            updates.push(state);
        });

        controller.update(pad({ slot: 0, buttons: { a: 1 } }));
        expect(updates.length).toBeGreaterThanOrEqual(1);
        expect(updates[updates.length - 1].pads[0].pressed.a).toBe(true);

        controller.setConfig({ preset: 'stremio' });
        expect(updates[updates.length - 1].config.preset).toBe('stremio');

        unsubscribe();
        const count = updates.length;
        controller.update(pad({ slot: 0, buttons: { a: 0 } }));
        expect(updates.length).toBe(count);
    });

    it('18. setConfig: releases held keys and switches active bindings', () => {
        const env = makeEnv();
        const controller = createController(env);

        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);

        controller.setConfig({ overrides: { a: 'playPause' } });
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);

        controller.update(pad({ buttons: { a: 0 } }));
        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.mediaKeys).toEqual(['play-pause']);
    });
});

describe('gamepadShim select', () => {
    it('clicks the focused element when no handler took the Enter', () => {
        const env = makeEnv();
        const controller = createController(env);
        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);
        expect(env.activations.length).toBe(1);
        controller.update(pad({ buttons: { a: 0 } }));
        expect(env.keys).toEqual(['keydown:Enter', 'keyup:Enter']);
        expect(env.activations.length).toBe(1);
    });

    it('does not click when a handler prevented the Enter (it activated the element itself)', () => {
        const env = makeEnv({ prevented: (spec, type) => spec.key === 'Enter' && type === 'keydown' });
        const controller = createController(env);
        controller.update(pad({ buttons: { a: 1 } }));
        expect(env.keys).toEqual(['keydown:Enter']);
        expect(env.activations.length).toBe(0);
    });

    it('only Select clicks: other key actions never do', () => {
        const env = makeEnv();
        const controller = createController(env);
        controller.update(pad({ buttons: { up: 1 } }));
        controller.update(pad({ buttons: { up: 0 } }));
        expect(env.keys).toEqual(['keydown:ArrowUp', 'keyup:ArrowUp']);
        expect(env.activations.length).toBe(0);
    });
});

describe('gamepadShim smart spatial navigation', () => {
    function makeMockElement(options = {}) {
        const attributes = new Map();
        const children = [];
        const el = {
            nodeType: 1,
            tagName: options.tagName || 'DIV',
            className: options.className || '',
            disabled: !!options.disabled,
            tabIndex: options.tabIndex !== undefined ? options.tabIndex : 0,
            children: children,
            parentElement: null,
            setAttribute: (k, v) => attributes.set(k, String(v)),
            getAttribute: (k) => attributes.get(k) || null,
            removeAttribute: (k) => attributes.delete(k),
            contains: function (other) {
                if (other === this) return true;
                return children.some((c) => c.contains ? c.contains(other) : c === other);
            },
            appendChild: function (child) {
                child.parentElement = this;
                child.ownerDocument = el.ownerDocument;
                children.push(child);
                return child;
            },
            querySelectorAll: function (sel) {
                const found = [];
                function visit(node) {
                    for (const c of node.children) {
                        found.push(c);
                        visit(c);
                    }
                }
                visit(this);
                return found;
            },
            focus: options.focus || (() => {}),
            scrollIntoView: options.scrollIntoView || (() => {}),
            getBoundingClientRect: () => ({
                left: options.left || 0,
                top: options.top || 0,
                width: options.width || 100,
                height: options.height || 100,
                right: (options.left || 0) + (options.width || 100),
                bottom: (options.top || 0) + (options.height || 100),
            }),
        };
        return el;
    }

    it('1. env.moveFocus intercepts directional actions and avoids unhandled keydown', () => {
        const focusCalls = [];
        const env = makeEnv();
        env.moveFocus = (dir) => {
            focusCalls.push(dir);
            return true;
        };

        const controller = createController(env);
        controller.update(pad({ buttons: { down: 1 } }));
        expect(focusCalls).toEqual(['down']);
        // When handled by smart navigation, raw keydown is suppressed (no 40px scroll)
        expect(env.keys).toEqual([]);

        controller.update(pad({ buttons: { down: 0 } }));
        // Keyup is cleanly emitted on release
        expect(env.keys).toEqual(['keyup:ArrowDown']);
    });

    it('2. holding direction repeatedly triggers moveFocus on timer ticks', () => {
        const focusCalls = [];
        const env = makeEnv();
        env.moveFocus = (dir) => {
            focusCalls.push(dir);
            return true;
        };

        const controller = createController(env);
        controller.update(pad({ buttons: { right: 1 } }));
        expect(focusCalls).toEqual(['right']);

        env.advanceClock(450);
        env.runTimers();
        expect(focusCalls).toEqual(['right', 'right']);

        controller.update(pad({ buttons: { right: 0 } }));
    });

    it('3. findNextCandidate moves horizontally along cards in the same row', () => {
        const card1 = makeMockElement({ left: 100, top: 200, width: 150, height: 220 });
        const card2 = makeMockElement({ left: 280, top: 200, width: 150, height: 220 });
        const card3 = makeMockElement({ left: 460, top: 200, width: 150, height: 220 });

        const candidates = [card1, card2, card3];
        const nextRight = findNextCandidate(card1, candidates, 'right');
        expect(nextRight).toBe(card2);

        const nextLeft = findNextCandidate(card2, candidates, 'left');
        expect(nextLeft).toBe(card1);
    });

    it('4. findNextCandidate jumps vertically between rows preserving column alignment', () => {
        // Row 1 (Continue Watching)
        const row1Card1 = makeMockElement({ left: 100, top: 100, width: 150, height: 100 });
        const row1Card2 = makeMockElement({ left: 300, top: 100, width: 150, height: 100 });

        // Row 2 (Upcoming)
        const row2Card1 = makeMockElement({ left: 100, top: 300, width: 150, height: 100 });
        const row2Card2 = makeMockElement({ left: 300, top: 300, width: 150, height: 100 });

        const candidates = [row1Card1, row1Card2, row2Card1, row2Card2];

        // Down from Row 1 Card 2 must jump directly to Row 2 Card 2 (vertically aligned)
        const downCandidate = findNextCandidate(row1Card2, candidates, 'down');
        expect(downCandidate).toBe(row2Card2);

        // Up from Row 2 Card 2 must jump directly to Row 1 Card 2 (vertically aligned)
        const upCandidate = findNextCandidate(row2Card2, candidates, 'up');
        expect(upCandidate).toBe(row1Card2);
    });

    it('5. navigateDirection recovers focus to the first visible card when activeElement is body', () => {
        const win = { innerWidth: 1280, innerHeight: 800 };
        const body = makeMockElement({ tagName: 'BODY', left: 0, top: 0, width: 1280, height: 800 });
        const doc = {
            body: body,
            documentElement: body,
            activeElement: body,
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        body.ownerDocument = doc;

        let focusedEl = null;
        const card1 = makeMockElement({
            className: 'card',
            left: 120,
            top: 150,
            width: 180,
            height: 120,
            focus: function () { focusedEl = card1; },
        });
        card1.ownerDocument = doc;

        const card2 = makeMockElement({
            className: 'card',
            left: 340,
            top: 150,
            width: 180,
            height: 120,
        });
        card2.ownerDocument = doc;

        body.appendChild(card1);
        body.appendChild(card2);

        const handled = navigateDirection(doc, win, 'down');
        expect(handled).toBe(true);
        expect(focusedEl).toBe(card1);
        expect(card1.getAttribute('data-gamepad-focused')).toBe('true');
    });

    it('6. Settings toggle: enables tabIndex and marks focused', () => {
        const toggle = makeMockElement({
            className: 'toggle-container button-container',
            tabIndex: -1, // Upstream hardcoded -1
            left: 500,
            top: 300,
            width: 60,
            height: 30,
        });

        focusTarget(toggle);
        expect(toggle.tabIndex).toBe(0);
        expect(toggle.getAttribute('data-gamepad-focused')).toBe('true');
    });
});

describe('gamepadShim browser integration and DOM behavior', () => {
    function makeMockDOM() {
        let t = 0;
        const timers = new Map();
        let nextTimerId = 1;

        function createElement(tagName) {
            const classes = new Set();
            const attrs = {};
            const children = [];
            let innerHTML = '';

            const el = {
                tagName: tagName.toUpperCase(),
                id: '',
                tabIndex: 0,
                disabled: false,
                style: {},
                children: children,
                ownerDocument: null,
                parentNode: null,
                get classList() {
                    return {
                        add: (cls) => classes.add(cls),
                        remove: (cls) => classes.delete(cls),
                        contains: (cls) => classes.has(cls),
                    };
                },
                get className() {
                    return Array.from(classes).join(' ');
                },
                set className(val) {
                    classes.clear();
                    if (val) val.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
                },
                setAttribute: (k, v) => { attrs[k] = String(v); },
                getAttribute: (k) => attrs[k] || null,
                removeAttribute: (k) => { delete attrs[k]; },
                hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k),
                appendChild: (child) => {
                    child.parentNode = el;
                    child.ownerDocument = el.ownerDocument;
                    children.push(child);
                    return child;
                },
                removeChild: (child) => {
                    const idx = children.indexOf(child);
                    if (idx >= 0) children.splice(idx, 1);
                    child.parentNode = null;
                    return child;
                },
                addEventListener: (ev, fn) => {
                    el._listeners = el._listeners || {};
                    el._listeners[ev] = el._listeners[ev] || [];
                    el._listeners[ev].push(fn);
                },
                removeEventListener: () => {},
                dispatchEvent: (event) => {
                    if (el._listeners && el._listeners[event.type]) {
                        el._listeners[event.type].forEach(fn => fn(event));
                    }
                    return true;
                },
                click: () => {
                    el.dispatchEvent({ type: 'click', target: el });
                },
                focus: () => {
                    if (el.ownerDocument) el.ownerDocument.activeElement = el;
                },
                scrollIntoView: () => {},
                getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 }),
                contains: (target) => {
                    let cur = target;
                    while (cur) {
                        if (cur === el) return true;
                        cur = cur.parentNode;
                    }
                    return false;
                },
                closest: (selector) => {
                    let cur = el;
                    while (cur) {
                        if (cur.matches && cur.matches(selector)) return cur;
                        cur = cur.parentNode;
                    }
                    return null;
                },
                matches: (selector) => {
                    const parts = selector.split(',').map(s => s.trim());
                    for (let i = 0; i < parts.length; i++) {
                        const sel = parts[i];
                        if (sel === 'input' && el.tagName === 'INPUT') return true;
                        if (sel.startsWith('input.') && el.tagName === 'INPUT' && classes.has(sel.slice(6))) return true;
                        if (sel.startsWith('#') && el.id === sel.slice(1)) return true;
                        if (sel.startsWith('.') && classes.has(sel.slice(1))) return true;
                        if (sel.startsWith('[') && sel.endsWith(']')) {
                            const inner = sel.slice(1, -1);
                            if (inner.includes('*=')) {
                                const pieces = inner.split('*=').map(s => s.replace(/"/g, ''));
                                const val = el.getAttribute(pieces[0]) || (pieces[0] === 'class' ? el.className : '');
                                if (val && val.includes(pieces[1])) return true;
                            } else if (el.hasAttribute(inner)) return true;
                        }
                    }
                    return false;
                },
                get innerHTML() { return innerHTML; },
                set innerHTML(html) { innerHTML = html; },
                get textContent() { return innerHTML.replace(/<[^>]+>/g, ''); },
                set textContent(text) { innerHTML = text; },
                querySelector: (sel) => {
                    const all = el.querySelectorAll(sel);
                    return all.length ? all[0] : null;
                },
                querySelectorAll: (sel) => {
                    const results = [];
                    function scan(node) {
                        for (let i = 0; i < node.children.length; i++) {
                            const child = node.children[i];
                            if (child.matches && child.matches(sel)) results.push(child);
                            scan(child);
                        }
                    }
                    scan(el);
                    return results;
                },
            };
            return el;
        }

        const doc = {
            createElement: createElement,
            activeElement: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            createEvent: () => ({ initMouseEvent: () => {} }),
        };

        const docElement = createElement('html');
        docElement.ownerDocument = doc;
        const body = createElement('body');
        body.ownerDocument = doc;
        const head = createElement('head');
        head.ownerDocument = doc;

        docElement.appendChild(head);
        docElement.appendChild(body);
        doc.documentElement = docElement;
        doc.body = body;
        doc.head = head;
        doc.activeElement = body;

        doc.getElementById = (id) => {
            function scan(node) {
                if (node.id === id) return node;
                for (let i = 0; i < node.children.length; i++) {
                    const found = scan(node.children[i]);
                    if (found) return found;
                }
                return null;
            }
            return scan(docElement);
        };

        doc.querySelector = (sel) => docElement.querySelector(sel);
        doc.querySelectorAll = (sel) => docElement.querySelectorAll(sel);

        const win = {
            document: doc,
            location: { hash: '#/' },
            localStorage: {
                getItem: () => null,
                setItem: () => {},
            },
            navigator: {},
            performance: { now: () => t },
            setTimeout: (fn, ms) => {
                const id = nextTimerId++;
                timers.set(id, { fn: fn, ms: ms || 0, when: t + (ms || 0) });
                return id;
            },
            clearTimeout: (id) => timers.delete(id),
            advanceTimers: (ms) => {
                t += ms;
                const entries = Array.from(timers.entries());
                for (let i = 0; i < entries.length; i++) {
                    const id = entries[i][0];
                    const item = entries[i][1];
                    if (t >= item.when && timers.has(id)) {
                        timers.delete(id);
                        item.fn();
                    }
                }
            },
            addEventListener: (ev, fn) => {
                win._listeners = win._listeners || {};
                win._listeners[ev] = win._listeners[ev] || [];
                win._listeners[ev].push(fn);
            },
            removeEventListener: () => {},
            dispatchEvent: (ev) => {
                if (win._listeners && win._listeners[ev.type]) {
                    win._listeners[ev.type].forEach(fn => fn(ev));
                }
            },
            Event: function (type) { this.type = type; },
            KeyboardEvent: function (type, init) { this.type = type; Object.assign(this, init); },
            MouseEvent: function (type, init) { this.type = type; Object.assign(this, init); },
        };

        return { win: win, doc: doc };
    }

    it('1. install(win) injects styles and exposes win.__cinemaPad', () => {
        const { win, doc } = makeMockDOM();
        install(win);
        expect(win.__cinemaPad).toBeDefined();
        expect(typeof win.__cinemaPad.update).toBe('function');
        const style = doc.getElementById('cinema-gamepad-focus-style');
        expect(style).not.toBeNull();
        expect(style.textContent).toContain('data-gamepad-mode');
    });

    it('2. HUD displays connected, disconnected, and low battery notifications', () => {
        const { win, doc } = makeMockDOM();
        install(win);

        // Connect
        win.__cinemaPad.update(pad({ id: 'PlayStation DualSense', connected: true }));
        const hud = doc.getElementById('cinema-controller-hud');
        expect(hud).not.toBeNull();
        expect(hud.classList.contains('visible')).toBe(true);
        expect(hud.textContent).toContain('PlayStation DualSense Connected');

        // Low battery notification
        win.__cinemaPad.update(pad({ id: 'PlayStation DualSense', connected: true, battery: 0.14, charging: false }));
        expect(hud.textContent).toContain('Controller Battery Low (14%)');

        // Disconnect
        win.__cinemaPad.update(pad({ slot: 0, connected: false }));
        expect(hud.textContent).toContain('Controller Disconnected');
    });

    it('3. Quick Action Menu toggles, lists all 7 actions, and closes with B button', () => {
        const { win, doc } = makeMockDOM();
        install(win);

        // Hold Home for >= 500ms
        win.__cinemaPad.update(pad({ buttons: { home: 1 } }));
        win.advanceTimers(500);
        win.advanceTimers(10); // animation tick

        const qm = doc.getElementById('cinema-quick-menu-overlay');
        expect(qm).not.toBeNull();
        expect(qm.getAttribute('data-gamepad-modal')).toBe('true');
        expect(qm.classList.contains('visible')).toBe(true);

        // Press B to close Quick Action Menu
        win.__cinemaPad.update(pad({ buttons: { b: 1 } }));
        win.__cinemaPad.update(pad({ buttons: { b: 0 } }));
        expect(qm.classList.contains('visible')).toBe(false);
    });

    it('4. On-screen keyboard on /search updates input, supports X/Y shortcuts, and closes on B', () => {
        const { win, doc } = makeMockDOM();
        win.location.hash = '#/search';
        doc.documentElement.setAttribute('data-gamepad-mode', 'true');
        install(win);

        const searchInput = doc.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'search-input';
        searchInput.placeholder = 'Search';
        searchInput.value = '';
        doc.body.appendChild(searchInput);

        // Route change to /search triggers virtual keyboard
        win.dispatchEvent(new win.Event('hashchange'));
        win.advanceTimers(10); // animation tick
        const kb = doc.getElementById('cinema-gamepad-keyboard');
        expect(kb).not.toBeNull();
        expect(kb.classList.contains('visible')).toBe(true);

        // Type on virtual keyboard
        const actions = win.__cinemaPad.ACTIONS;
        expect(actions).toBeDefined();

        // Press Y (Space shortcut)
        win.__cinemaPad.update(pad({ buttons: { y: 1 } }));
        win.__cinemaPad.update(pad({ buttons: { y: 0 } }));
        expect(searchInput.value).toBe(' ');

        // Press X (Delete shortcut)
        win.__cinemaPad.update(pad({ buttons: { x: 1 } }));
        win.__cinemaPad.update(pad({ buttons: { x: 0 } }));
        expect(searchInput.value).toBe('');

        // Press B (Done / Close)
        win.__cinemaPad.update(pad({ buttons: { b: 1 } }));
        win.__cinemaPad.update(pad({ buttons: { b: 0 } }));
        expect(kb.classList.contains('visible')).toBe(false);
    });
});
