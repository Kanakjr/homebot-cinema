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
} = require('../desktop/src-tauri/src/gamepad_shim.js');

function makeEnv(options = {}) {
    let t = options.initialTime || 0;
    let currentRoute = options.route !== undefined ? options.route : '/';
    let isFocused = options.focused !== undefined ? options.focused : true;
    let isOverlayOpen = options.overlayOpen !== undefined ? options.overlayOpen : false;

    const keys = [];
    const navigations = [];
    const mediaKeys = [];
    const connections = [];
    const activations = [];

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
        activate: function () { activations.push(t); },
        activations: activations,
        keys: keys,
        navigations: navigations,
        mediaKeys: mediaKeys,
        connections: connections,
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
        expect(env.keys).toEqual(['keydown:l']);

        controller.update(pad({ buttons: { rt: 0.4 } }));
        expect(env.keys).toEqual(['keydown:l']);

        controller.update(pad({ buttons: { rt: 0.3 } }));
        expect(env.keys).toEqual(['keydown:l', 'keyup:l']);
    });

    it('5. Player-only actions do nothing outside the player (route /)', () => {
        const env = makeEnv({ route: '/' });
        const controller = createController(env);

        controller.update(pad({ buttons: { rt: 1.0 } }));
        expect(env.keys).toEqual([]);

        controller.update(pad({ buttons: { rt: 0 } }));
        expect(env.keys).toEqual([]);
    });

    it('6. B (back): Escape in player, Escape with overlayOpen, Backspace outside without overlay', () => {
        const envPlayer = makeEnv({ route: '/player/123' });
        const cPlayer = createController(envPlayer);
        cPlayer.update(pad({ buttons: { b: 1 } }));
        expect(envPlayer.keys).toEqual(['keydown:Escape', 'keyup:Escape']);

        const envOverlay = makeEnv({ route: '/', overlayOpen: true });
        const cOverlay = createController(envOverlay);
        cOverlay.update(pad({ buttons: { b: 1 } }));
        expect(envOverlay.keys).toEqual(['keydown:Escape', 'keyup:Escape']);

        const envNormal = makeEnv({ route: '/', overlayOpen: false });
        const cNormal = createController(envNormal);
        cNormal.update(pad({ buttons: { b: 1 } }));
        expect(envNormal.keys).toEqual(['keydown:Backspace', 'keyup:Backspace']);
    });

    it('7. X (playPause) calls mediaKey, Home navigates to /, Y navigates to /search', () => {
        const env = makeEnv({ route: '/library' });
        const controller = createController(env);

        controller.update(pad({ buttons: { x: 1 } }));
        expect(env.mediaKeys).toEqual(['play-pause']);
        controller.update(pad({ buttons: { x: 0 } }));

        controller.update(pad({ buttons: { home: 1 } }));
        expect(env.navigations).toEqual(['/']);
        controller.update(pad({ buttons: { home: 0 } }));

        controller.update(pad({ buttons: { y: 1 } }));
        expect(env.navigations).toEqual(['/', '/search']);
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
        expect(env.keys).toEqual(['keydown:j']);

        controller.update(pad({ axes: [0, 0, 0, 0] }));
        expect(env.keys).toEqual(['keydown:j', 'keyup:j']);
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
