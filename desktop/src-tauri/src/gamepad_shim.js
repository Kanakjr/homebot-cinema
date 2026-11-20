// Game controllers in the desktop app.
//
// The app reads controllers natively (GameController framework: gamepad.rs, gamepad/gamepad_bridge.m) and calls
// window.__cinemaPad.update({ pads: [...] }) with W3C "standard mapping" values whenever they change, plus once a
// second while a controller is connected. This script:
//   - turns presses into app actions, using a layout people can change (Settings > Controllers): key presses the web
//     UI already understands (arrows, Enter, Escape, Backspace, player shortcuts) or shell media keys;
//   - serves navigator.getGamepads() and gamepadconnected / gamepaddisconnected from the native state, so the web
//     UI's own gamepad support (Settings > Interface > Gamepad) still works for buttons bound to "pad.*" actions;
//   - keeps WebKit's own Gamepad API idle: its provider runs in the same process as the native reader and would
//     deliver every press a second time.
// Injected at document start into every page of the main window (main.rs). Also loaded by jest (module.exports),
// which tests createController() with a fake environment.
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module && module.exports) {
        module.exports = api;
    } else if (root && root.document && !root.__cinemaPad) {
        api.install(root);
    }
})(typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    var MAX_PADS = 4;
    // Physical inputs in standard-mapping order (index = button index). 17 = Xbox Share / PlayStation touchpad.
    var INPUTS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'ls', 'rs', 'up', 'down', 'left', 'right', 'home', 'share'];
    var INPUT_LABELS = {
        a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: 'View', menu: 'Menu',
        ls: 'Left stick press', rs: 'Right stick press', up: 'D-pad up', down: 'D-pad down', left: 'D-pad left',
        right: 'D-pad right', home: 'Xbox / Home', share: 'Share',
    };
    var STICKS = ['leftStick', 'rightStick'];
    var STICK_LABELS = { leftStick: 'Left stick', rightStick: 'Right stick' };
    var STICK_MODES = {
        navigate: 'Move around',
        seekVolume: 'Seek and volume (player)',
        pad: 'Gamepad stick (built-in navigation)',
        none: 'Nothing',
    };

    var PRESS = 0.5; // a button or trigger counts as pressed above this...
    var RELEASE = 0.35; // ...and as released below this (no flicker on half-pressed triggers)
    var REPEAT_DELAY = 400; // ms before a held D-pad direction starts repeating
    var REPEAT_EVERY = 110;
    var STALE_MS = 2500; // no update for this long while something is held: release it (the app lost the controller)

    var KEYS = {
        enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
        escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
        backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        a: { key: 'a', code: 'KeyA', keyCode: 65 },
        c: { key: 'c', code: 'KeyC', keyCode: 67 },
        f: { key: 'f', code: 'KeyF', keyCode: 70 },
        i: { key: 'i', code: 'KeyI', keyCode: 73 },
        j: { key: 'j', code: 'KeyJ', keyCode: 74 },
        l: { key: 'l', code: 'KeyL', keyCode: 76 },
        m: { key: 'm', code: 'KeyM', keyCode: 77 },
        s: { key: 's', code: 'KeyS', keyCode: 83 },
    };

    // What a button can do. key = a key press (keyup on release), repeat = repeats while held, player = only in the
    // player, run = a function below, pad = a button of the web UI's own gamepad support (standard index).
    var ACTIONS = {
        none: { label: 'Nothing' },
        // A synthetic Enter does not activate native buttons and links (only real key presses do), so when no
        // handler took the Enter, the focused element is clicked, as the web UI's own gamepad support does.
        select: { label: 'Select', key: 'enter', click: true },
        back: { label: 'Back', run: 'back' },
        up: { label: 'Move up', key: 'up', repeat: true, dir: 'up' },
        down: { label: 'Move down', key: 'down', repeat: true, dir: 'down' },
        left: { label: 'Move left', key: 'left', repeat: true, dir: 'left' },
        right: { label: 'Move right', key: 'right', repeat: true, dir: 'right' },
        home: { label: 'Home', run: 'home' },
        search: { label: 'Search', run: 'search' },
        prevTab: { label: 'Previous tab', run: 'prevTab' },
        nextTab: { label: 'Next tab', run: 'nextTab' },
        fullscreen: { label: 'Fullscreen', key: 'f' },
        playPause: { label: 'Play / pause', run: 'playPause' },
        nextEpisode: { label: 'Next episode', run: 'nextEpisode' },
        seekBack: { label: 'Seek back', key: 'j', repeat: true, player: true },
        seekForward: { label: 'Seek forward', key: 'l', repeat: true, player: true },
        volumeUp: { label: 'Volume up', key: 'up', repeat: true, player: true },
        volumeDown: { label: 'Volume down', key: 'down', repeat: true, player: true },
        mute: { label: 'Mute', key: 'm', player: true },
        subtitlesMenu: { label: 'Subtitles menu', key: 's', player: true },
        toggleSubtitles: { label: 'Subtitles on / off', key: 'c', player: true },
        audioMenu: { label: 'Audio tracks menu', key: 'a', player: true },
        infoMenu: { label: 'Episode info', key: 'i', player: true },
        'pad.a': { label: 'Gamepad A (built-in navigation)', pad: 0 },
        'pad.b': { label: 'Gamepad B (built-in navigation)', pad: 1 },
        'pad.x': { label: 'Gamepad X (built-in navigation)', pad: 2 },
        'pad.y': { label: 'Gamepad Y (built-in navigation)', pad: 3 },
        'pad.lb': { label: 'Gamepad LB (built-in navigation)', pad: 4 },
        'pad.rb': { label: 'Gamepad RB (built-in navigation)', pad: 5 },
    };

    var DPAD = { up: 'up', down: 'down', left: 'left', right: 'right' };
    var PRESETS = {
        tv: {
            label: 'TV remote (recommended)',
            buttons: {
                a: 'select', b: 'back', x: 'playPause', y: 'search', lb: 'prevTab', rb: 'nextTab',
                lt: 'seekBack', rt: 'seekForward', view: 'subtitlesMenu', menu: 'playPause',
                ls: 'toggleSubtitles', rs: 'mute', up: DPAD.up, down: DPAD.down, left: DPAD.left, right: DPAD.right,
                home: 'home', share: 'none',
            },
            sticks: { leftStick: 'navigate', rightStick: 'seekVolume' },
        },
        stremio: {
            label: 'Stremio gamepad (needs Settings > Interface > Gamepad)',
            buttons: {
                a: 'pad.a', b: 'pad.b', x: 'pad.x', y: 'pad.y', lb: 'pad.lb', rb: 'pad.rb',
                lt: 'seekBack', rt: 'seekForward', view: 'subtitlesMenu', menu: 'playPause',
                ls: 'none', rs: 'none', up: DPAD.up, down: DPAD.down, left: DPAD.left, right: DPAD.right,
                home: 'home', share: 'none',
            },
            sticks: { leftStick: 'pad', rightStick: 'pad' },
        },
    };

    // Main tabs, in the order of the top bar (src/components/MainNavBars).
    var TABS = ['/', '/discover', '/library', '/calendar', '/downloads', '/settings'];

    function normalizeConfig(cfg) {
        var c = cfg && typeof cfg === 'object' ? cfg : {};
        var preset = Object.prototype.hasOwnProperty.call(PRESETS, c.preset) ? c.preset : 'tv';
        var overrides = {};
        var sticks = {};
        INPUTS.forEach(function (input) {
            var v = c.overrides && c.overrides[input];
            if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, v)) overrides[input] = v;
        });
        STICKS.forEach(function (stick) {
            var v = c.sticks && c.sticks[stick];
            if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(STICK_MODES, v)) sticks[stick] = v;
        });
        return { version: 1, preset: preset, overrides: overrides, sticks: sticks };
    }

    function resolveBindings(cfg) {
        var c = normalizeConfig(cfg);
        var p = PRESETS[c.preset];
        var buttons = {};
        var sticks = {};
        INPUTS.forEach(function (input) { buttons[input] = c.overrides[input] || p.buttons[input]; });
        STICKS.forEach(function (stick) { sticks[stick] = c.sticks[stick] || p.sticks[stick]; });
        return { buttons: buttons, sticks: sticks };
    }

    function tabIndex(route) {
        var r = route || '/';
        if (r === '/' || r === '/board') return 0;
        for (var i = 1; i < TABS.length; i++) {
            if (r === TABS[i] || r.indexOf(TABS[i] + '/') === 0) return i;
        }
        return -1;
    }

    function numbers(list, n) {
        var out = [];
        for (var i = 0; i < n; i++) {
            var v = list && Number(list[i]);
            out.push(typeof v === 'number' && isFinite(v) ? v : 0);
        }
        return out;
    }

    // Dominant stick direction, with hysteresis: a direction starts above PRESS and holds above RELEASE.
    function stickDirection(x, y, current) {
        var ax = Math.abs(x);
        var ay = Math.abs(y);
        var m = Math.max(ax, ay);
        if (m < (current ? RELEASE : PRESS)) return null;
        var dir = ax > ay ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
        return { dir: dir, m: Math.min(1, m) };
    }

    // Stick repeat speed: slow near the threshold, fast at full tilt.
    function stickInterval(m) {
        var t = Math.max(0, Math.min(1, (m - PRESS) / (1 - PRESS)));
        return Math.round(420 - t * 330);
    }

    var STICK_ACTIONS = {
        navigate: { up: 'up', down: 'down', left: 'left', right: 'right' },
        seekVolume: { up: 'volumeUp', down: 'volumeDown', left: 'seekBack', right: 'seekForward' },
    };

    // env: now(), setTimer(fn, ms), clearTimer(id), focused(), route(), navigate(path), mediaKey(action),
    //      overlayOpen(), key(spec, type, repeat) -> false when a handler called preventDefault,
    //      activate() clicks the focused element, connection(type, gamepad) for gamepad(dis)connected.
    function createController(env, initialConfig) {
        var config = normalizeConfig(initialConfig);
        var bindings = resolveBindings(config);
        var pads = [];
        var pressed = []; // [slot][input] = bool
        var active = {}; // "slot:input" or "slot:leftStick" -> { spec, repeat, next, dir, m, stick }
        var swallow = {}; // "slot:input" pressed during capture: ignore its release
        var timer = null;
        var lastUpdate = 0;
        var capture = null;
        var listeners = [];

        function inPlayer() {
            return String(env.route() || '').indexOf('/player/') === 0;
        }

        function tap(name) {
            env.key(KEYS[name], 'keydown', false);
            env.key(KEYS[name], 'keyup', false);
        }

        var RUNS = {
            back: function () {
                // If a modal or player menu is open, close it; in player without open menus, exit player;
                // elsewhere Backspace goes back a page in router history.
                if (env.overlayOpen()) {
                    if (typeof env.closeOverlay === 'function' && env.closeOverlay()) {
                        return;
                    }
                    tap('escape');
                } else if (inPlayer()) {
                    if (typeof env.exitPlayer === 'function') {
                        env.exitPlayer();
                    } else {
                        tap('backspace');
                    }
                } else {
                    tap('backspace');
                }
            },
            home: function () { env.navigate('/'); },
            search: function () { env.navigate('/search'); },
            prevTab: function () {
                var i = tabIndex(env.route());
                if (i > 0) env.navigate(TABS[i - 1]);
            },
            nextTab: function () {
                var i = tabIndex(env.route());
                if (i >= 0 && i < TABS.length - 1) env.navigate(TABS[i + 1]);
            },
            playPause: function () { env.mediaKey('play-pause'); },
            nextEpisode: function () { env.mediaKey('next-track'); },
        };

        function start(id, actionId, extra) {
            if (typeof env.setGamepadMode === 'function') env.setGamepadMode(true);
            if (typeof env.ensureFocus === 'function') env.ensureFocus();
            var a = ACTIONS[actionId];
            if (!a || actionId === 'none' || a.pad !== undefined) return;
            if (a.player && !inPlayer()) return;
            if (a.run) {
                RUNS[a.run]();
                return;
            }
            if (a.dir && !inPlayer() && typeof env.moveFocus === 'function') {
                var handled = env.moveFocus(a.dir);
                if (handled) {
                    var now = env.now();
                    var entry = { spec: KEYS[a.key], repeat: !!a.repeat, next: now + REPEAT_DELAY, dir: a.dir };
                    if (extra) {
                        entry.stick = true;
                        entry.m = extra.m;
                        entry.next = now + stickInterval(extra.m);
                    }
                    active[id] = entry;
                    return;
                }
            }
            var spec = KEYS[a.key];
            var unhandled = env.key(spec, 'keydown', false);
            if (a.click && unhandled !== false) env.activate();
            var now = env.now();
            var entry = { spec: spec, repeat: !!a.repeat, next: now + REPEAT_DELAY };
            if (extra) {
                entry.stick = true;
                entry.dir = extra.dir;
                entry.m = extra.m;
                entry.next = now + stickInterval(extra.m);
            }
            active[id] = entry;
        }

        function stop(id) {
            var entry = active[id];
            if (!entry) return;
            delete active[id];
            if (entry.spec) env.key(entry.spec, 'keyup', false);
        }

        function releaseSlot(slot) {
            Object.keys(active).forEach(function (id) {
                if (id.indexOf(slot + ':') === 0) stop(id);
            });
            pressed[slot] = {};
        }

        function releaseAll() {
            for (var s = 0; s < MAX_PADS; s++) releaseSlot(s);
        }

        function handleButtons(slot, pad, act) {
            var state = pressed[slot] || (pressed[slot] = {});
            INPUTS.forEach(function (input, i) {
                var v = pad.buttons[i];
                var was = !!state[input];
                var is = was ? v > RELEASE : v > PRESS;
                if (is === was) return;
                state[input] = is;
                var id = slot + ':' + input;
                if (!act) return;
                if (is) {
                    if (typeof env.setGamepadMode === 'function') env.setGamepadMode(true);
                    if (capture) {
                        var fn = capture;
                        capture = null;
                        swallow[id] = true;
                        fn(input, slot);
                        return;
                    }
                    start(id, bindings.buttons[input]);
                } else if (swallow[id]) {
                    delete swallow[id];
                } else {
                    stop(id);
                }
            });
        }

        function handleStick(slot, pad, stick, act) {
            var mode = bindings.sticks[stick];
            var id = slot + ':' + stick;
            var map = STICK_ACTIONS[mode];
            var cur = active[id];
            if (!map || !act || capture) {
                if (cur) stop(id);
                return;
            }
            var base = stick === 'leftStick' ? 0 : 2;
            var d = stickDirection(pad.axes[base], pad.axes[base + 1], cur);
            if (!d) {
                if (cur) stop(id);
                return;
            }
            if (typeof env.setGamepadMode === 'function') env.setGamepadMode(true);
            if (cur && cur.dir === d.dir) {
                cur.m = d.m;
                return;
            }
            if (cur) stop(id);
            start(id, map[d.dir], d);
        }

        function snapshot(p) {
            return {
                slot: p.slot, id: p.id, buttons: p.buttons.slice(), axes: p.axes.slice(), battery: p.battery,
                charging: p.charging, connectedAt: p.connectedAt, pressed: Object.assign({}, pressed[p.slot] || {}),
            };
        }

        function getState() {
            return {
                pads: pads.filter(Boolean).map(snapshot),
                config: JSON.parse(JSON.stringify(config)),
                bindings: JSON.parse(JSON.stringify(bindings)),
                capturing: !!capture,
            };
        }

        function notify() {
            if (!listeners.length) return;
            var state = getState();
            listeners.slice().forEach(function (fn) {
                try { fn(state); } catch (e) { void e; }
            });
        }

        function anyRepeating() {
            return Object.keys(active).some(function (id) { return active[id].repeat || active[id].stick; });
        }

        function tick() {
            timer = null;
            var now = env.now();
            if (now - lastUpdate > STALE_MS) {
                releaseAll();
                return;
            }
            Object.keys(active).forEach(function (id) {
                var e = active[id];
                if (!(e.repeat || e.stick) || now < e.next) return;
                if (e.dir && !inPlayer() && typeof env.moveFocus === 'function') {
                    env.moveFocus(e.dir);
                } else if (e.spec) {
                    env.key(e.spec, 'keydown', true);
                }
                e.next = now + (e.stick ? stickInterval(e.m) : REPEAT_EVERY);
            });
            schedule();
        }

        function schedule() {
            if (timer === null && anyRepeating()) timer = env.setTimer(tick, 30);
        }

        function update(payload) {
            var list = payload && Array.isArray(payload.pads) ? payload.pads : [];
            var now = env.now();
            var act = !!env.focused();
            lastUpdate = now;
            if (!act) releaseAll();
            list.forEach(function (p) {
                var slot = Number(p && p.slot);
                if (!(slot >= 0 && slot < MAX_PADS)) return;
                var prev = pads[slot];
                if (!p.connected) {
                    if (prev) {
                        releaseSlot(slot);
                        pads[slot] = null;
                        var gone = gamepadObject(prev);
                        gone.connected = false;
                        env.connection('gamepaddisconnected', gone);
                    }
                    return;
                }
                var cur = {
                    slot: slot,
                    id: String(p.id || 'Game controller'),
                    buttons: numbers(p.b, INPUTS.length),
                    axes: numbers(p.a, 4),
                    battery: typeof p.battery === 'number' ? p.battery : null,
                    charging: !!p.charging,
                    connectedAt: typeof p.since === 'number' ? p.since : null, // Unix ms, from the app
                    timestamp: now,
                };
                pads[slot] = cur;
                if (!prev) env.connection('gamepadconnected', gamepadObject(cur));
                handleButtons(slot, cur, act);
                STICKS.forEach(function (stick) { handleStick(slot, cur, stick, act); });
            });
            schedule();
            notify();
        }

        // The Gamepad object the web UI sees: only buttons bound to "pad.*" and sticks in "pad" mode.
        function gamepadObject(p) {
            var logical = [];
            for (var i = 0; i < INPUTS.length; i++) logical.push(0);
            INPUTS.forEach(function (input, i) {
                var a = ACTIONS[bindings.buttons[input]];
                if (a && a.pad !== undefined) logical[a.pad] = Math.max(logical[a.pad], p.buttons[i]);
            });
            var axes = [0, 0, 0, 0];
            if (bindings.sticks.leftStick === 'pad') { axes[0] = p.axes[0]; axes[1] = p.axes[1]; }
            if (bindings.sticks.rightStick === 'pad') { axes[2] = p.axes[2]; axes[3] = p.axes[3]; }
            return {
                id: p.id,
                index: p.slot,
                connected: true,
                mapping: 'standard',
                timestamp: p.timestamp,
                axes: axes,
                buttons: logical.map(function (v) { return { pressed: v > PRESS, touched: v > 0, value: v }; }),
                vibrationActuator: null,
                hapticActuators: [],
            };
        }

        function getGamepads() {
            var out = [];
            for (var s = 0; s < MAX_PADS; s++) out.push(pads[s] ? gamepadObject(pads[s]) : null);
            return out;
        }

        return {
            update: update,
            getGamepads: getGamepads,
            getState: getState,
            getConfig: function () { return JSON.parse(JSON.stringify(config)); },
            setConfig: function (cfg) {
                releaseAll();
                config = normalizeConfig(cfg);
                bindings = resolveBindings(config);
                notify();
                return JSON.parse(JSON.stringify(config));
            },
            // The next button press goes to fn(input, slot) instead of its action (for "press the button to change").
            capture: function (fn) {
                capture = typeof fn === 'function' ? fn : null;
                notify();
                return function cancel() {
                    if (capture === fn) {
                        capture = null;
                        notify();
                    }
                };
            },
            subscribe: function (fn) {
                listeners.push(fn);
                return function unsubscribe() {
                    listeners = listeners.filter(function (l) { return l !== fn; });
                };
            },
            releaseAll: releaseAll,
        };
    }

    var CANDIDATE_SELECTOR = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[role="button"]:not([disabled])',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="link"]',
        '[class*="toggle-container"]',
        '[class*="meta-item-link"]',
        '[class*="continue-watching-card"]',
        '[class*="card"]',
        '[class*="nav-tab-button"]',
        '[class*="button-container"]'
    ].join(',');

    function isNavigable(el, win) {
        if (!el || el.nodeType !== 1) return false;
        if (el.disabled) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (win && typeof win.getComputedStyle === 'function') {
            var style = win.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) {
                return false;
            }
        }
        return true;
    }

    function getScope(doc) {
        if (!doc) return null;
        var modal = doc.querySelector('.modals-container > *, [data-gamepad-modal]');
        if (modal) return modal;
        var dropdown = doc.querySelector('[class*="dropdown"][class*="open"], [class*="menu-container"][class*="open"], [class*="context-menu"]');
        if (dropdown) return dropdown;
        return doc.body || doc.documentElement;
    }

    function getCandidates(scope, win) {
        if (!scope) return [];
        var raw = scope.querySelectorAll(CANDIDATE_SELECTOR);
        var list = [];
        for (var i = 0; i < raw.length; i++) {
            var el = raw[i];
            if (isNavigable(el, win)) list.push(el);
        }
        return list.filter(function (el) {
            for (var j = 0; j < list.length; j++) {
                if (list[j] !== el && el.contains(list[j])) {
                    return false;
                }
            }
            return true;
        });
    }

    function findInitialCandidate(candidates, win) {
        if (!candidates || !candidates.length) return null;
        var vh = win && win.innerHeight ? win.innerHeight : 800;
        var vw = win && win.innerWidth ? win.innerWidth : 1200;
        var visible = [];
        for (var i = 0; i < candidates.length; i++) {
            var r = candidates[i].getBoundingClientRect();
            if (r.bottom > 20 && r.top < vh - 20 && r.right > 20 && r.left < vw - 20) {
                visible.push(candidates[i]);
            }
        }
        var pool = visible.length ? visible : candidates;
        var best = null;
        var bestScore = Infinity;
        for (var j = 0; j < pool.length; j++) {
            var box = pool[j].getBoundingClientRect();
            var score = Math.max(0, box.top) * 3 + Math.max(0, box.left);
            if (score < bestScore) {
                bestScore = score;
                best = pool[j];
            }
        }
        return best;
    }

    function findNextCandidate(current, candidates, dir) {
        if (!current || !candidates || !candidates.length) return null;
        var cur = current.getBoundingClientRect();
        var cx = cur.left + cur.width / 2;
        var cy = cur.top + cur.height / 2;

        var best = null;
        var bestScore = Infinity;

        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (el === current || el.contains(current) || current.contains(el)) continue;

            var r = el.getBoundingClientRect();
            var ex = r.left + r.width / 2;
            var ey = r.top + r.height / 2;

            var valid = false;
            if (dir === 'down') {
                valid = (r.top >= cur.top + 6 && ey > cy + 4);
            } else if (dir === 'up') {
                valid = (r.bottom <= cur.bottom - 6 && ey < cy - 4);
            } else if (dir === 'right') {
                valid = (r.left >= cur.left + 6 && ex > cx + 4);
            } else if (dir === 'left') {
                valid = (r.right <= cur.right - 6 && ex < cx - 4);
            }
            if (!valid) continue;

            var isHorizontal = (dir === 'left' || dir === 'right');
            var score;

            if (isHorizontal) {
                var overlapY = Math.max(0, Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top));
                var dx = dir === 'right' ? (r.left >= cur.right ? r.left - cur.right : ex - cx)
                                         : (cur.left >= r.right ? cur.left - r.right : cx - ex);
                var dy = Math.abs(ey - cy);
                var primaryH = Math.max(0, dx);
                if (overlapY > 0) {
                    score = primaryH * 1.0 + dy * 0.5;
                } else {
                    score = primaryH * 1.0 + dy * 3.0 + 3000;
                }
            } else {
                var overlapX = Math.max(0, Math.min(cur.right, r.right) - Math.max(cur.left, r.left));
                var dyV = dir === 'down' ? (r.top >= cur.bottom ? r.top - cur.bottom : ey - cy)
                                         : (cur.top >= r.bottom ? cur.top - r.bottom : cy - ey);
                var dxV = Math.abs(ex - cx);
                var primaryV = Math.max(0, dyV);
                if (overlapX > 0) {
                    score = primaryV * 2.0 + dxV * 0.8;
                } else {
                    score = primaryV * 2.0 + dxV * 1.6 + 80;
                }
            }

            if (score < bestScore) {
                bestScore = score;
                best = el;
            }
        }
        return best;
    }

    function focusTarget(el, win) {
        if (!el) return false;
        var doc = el.ownerDocument || (win && win.document);
        if (doc) {
            var prev = doc.querySelectorAll('[data-gamepad-focused="true"]');
            for (var i = 0; i < prev.length; i++) {
                prev[i].removeAttribute('data-gamepad-focused');
            }
        }
        if (el.tabIndex < 0) {
            el.tabIndex = 0;
        }
        el.setAttribute('data-gamepad-focused', 'true');
        if (typeof el.focus === 'function') {
            try {
                el.focus({ preventScroll: true });
            } catch (_) {
                el.focus();
            }
        }
        try {
            el.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        } catch (_) {
            if (typeof el.scrollIntoView === 'function') {
                el.scrollIntoView(false);
            }
        }
        return true;
    }

    function navigateDirection(doc, win, dir) {
        if (!doc) return false;
        var scope = getScope(doc);
        var candidates = getCandidates(scope, win);
        if (!candidates.length) return false;

        var cur = doc.activeElement;
        if (!cur || cur === doc.body || cur === doc.documentElement || !isNavigable(cur, win) || !scope.contains(cur)) {
            var initial = findInitialCandidate(candidates, win);
            if (initial) {
                return focusTarget(initial, win);
            }
            return false;
        }

        var next = findNextCandidate(cur, candidates, dir);
        if (next) {
            return focusTarget(next, win);
        }

        if (dir === 'up' && scope === (doc.body || doc.documentElement)) {
            var header = doc.querySelector('.horizontal-nav-bar, [class*="horizontal-nav-bar"], header');
            if (header) {
                var headerCandidates = getCandidates(header, win);
                var headerTarget = findInitialCandidate(headerCandidates, win);
                if (headerTarget && headerTarget !== cur) {
                    return focusTarget(headerTarget, win);
                }
            }
        }

        return false;
    }

    function install(win) {
        var doc = win.document;
        var STORAGE_KEY = 'cinema.controller.v1';
        var saved = null;
        try { saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { void e; }

        try {
            var styleEl = doc.createElement('style');
            styleEl.id = 'cinema-gamepad-focus-style';
            styleEl.textContent = [
                ':focus-visible, [data-gamepad-focused="true"] {',
                '    outline: 2px solid var(--primary-accent-color, #7b5bf5) !important;',
                '    outline-offset: 2px !important;',
                '}',
                '[class*="toggle-container"][data-gamepad-focused="true"] {',
                '    outline: 2px solid var(--primary-accent-color, #7b5bf5) !important;',
                '    outline-offset: 3px !important;',
                '    border-radius: 1rem !important;',
                '}',
                '[class*="card"][data-gamepad-focused="true"] {',
                '    transform: scale(1.03) !important;',
                '}',
                'html[data-gamepad-mode="true"], html[data-gamepad-mode="true"] * {',
                '    cursor: none !important;',
                '}',
                'html[data-gamepad-mode="true"] {',
                '    pointer-events: none !important;',
                '}',
                'html[data-gamepad-mode="true"] [data-gamepad-focused="true"],',
                'html[data-gamepad-mode="true"] :focus,',
                'html[data-gamepad-mode="true"] :focus-within {',
                '    pointer-events: auto !important;',
                '}',
                'html[data-gamepad-mode="true"] .meta-item-container.hovered:not(:focus-within):not([data-gamepad-focused="true"]) .poster-container {',
                '    box-shadow: none !important;',
                '}',
                'html[data-gamepad-mode="true"] .meta-item-container.hovered:not(:focus-within):not([data-gamepad-focused="true"]) .poster-image-layer {',
                '    transform: none !important;',
                '}',
                'html[data-gamepad-mode="true"] [class*="card"]:not(:focus):not(:focus-within):not([data-gamepad-focused="true"]) {',
                '    transform: none !important;',
                '}'
            ].join('\n');
            if (doc.head) doc.head.appendChild(styleEl);
            else if (doc.documentElement) doc.documentElement.appendChild(styleEl);
        } catch (_) { void 0; }

        function setGamepadMode(active) {
            if (!doc || !doc.documentElement || typeof doc.documentElement.setAttribute !== 'function') return;
            try {
                if (active) {
                    if (doc.documentElement.getAttribute('data-gamepad-mode') !== 'true') {
                        doc.documentElement.setAttribute('data-gamepad-mode', 'true');
                    }
                } else {
                    if (doc.documentElement.hasAttribute && doc.documentElement.hasAttribute('data-gamepad-mode')) {
                        doc.documentElement.removeAttribute('data-gamepad-mode');
                    }
                }
            } catch (_) { void 0; }
        }

        try {
            var onMouseMove = function (e) {
                if (e && (Math.abs(e.movementX || 0) > 1 || Math.abs(e.movementY || 0) > 1)) {
                    setGamepadMode(false);
                }
            };
            var onMouseDown = function () {
                setGamepadMode(false);
            };
            if (doc && typeof doc.addEventListener === 'function') {
                doc.addEventListener('mousemove', onMouseMove, true);
                doc.addEventListener('mousedown', onMouseDown, true);
            }
        } catch (_) { void 0; }

        try {
            var onFullscreenChange = function () {
                try {
                    if (win && typeof win.focus === 'function') win.focus();
                } catch (_) { void 0; }
                if (win && typeof win.setTimeout === 'function') {
                    win.setTimeout(function () {
                        try {
                            if (win && typeof win.focus === 'function') win.focus();
                            if (doc && (!doc.activeElement || doc.activeElement === doc.body)) {
                                var scope = getScope(doc);
                                var candidates = getCandidates(scope, win);
                                var target = findInitialCandidate(candidates, win);
                                if (target) focusTarget(target, win);
                            }
                        } catch (_) { void 0; }
                    }, 50);
                }
            };
            if (doc && typeof doc.addEventListener === 'function') {
                doc.addEventListener('fullscreenchange', onFullscreenChange);
                doc.addEventListener('webkitfullscreenchange', onFullscreenChange);
            }
        } catch (_) { void 0; }

        function closePlayerOverlay(doc) {
            if (!doc || typeof doc.querySelector !== 'function') return false;
            try {
                var shortcutsOverlay = doc.querySelector('[class*="shortcuts-modal-overlay"]');
                if (shortcutsOverlay && typeof shortcutsOverlay.click === 'function') {
                    shortcutsOverlay.click();
                    return true;
                }
                var drawerClose = doc.querySelector('[class*="side-drawer"] [class*="close-button"]');
                if (drawerClose && typeof drawerClose.click === 'function') {
                    drawerClose.click();
                    return true;
                }
                var backdropLayer = doc.querySelector('.player-container > div[class*="layer"]:not([class*="-layer"])');
                if (backdropLayer && typeof backdropLayer.click === 'function') {
                    backdropLayer.click();
                    return true;
                }
                var modalClose = doc.querySelector('.modals-container [class*="close"], [data-gamepad-modal] [class*="close"]');
                if (modalClose && typeof modalClose.click === 'function') {
                    modalClose.click();
                    return true;
                }
            } catch (_) { void 0; }
            return false;
        }

        doc.addEventListener('focusout', function (e) {
            if (e.target && typeof e.target.removeAttribute === 'function') {
                e.target.removeAttribute('data-gamepad-focused');
            }
        }, true);

        // gamepadconnected / gamepaddisconnected listeners are kept here, away from WebKit: a DOM listener for them
        // (or a call to WebKit's getGamepads) would start WebKit's own gamepad provider.
        var gamepadListeners = { gamepadconnected: [], gamepaddisconnected: [] };
        var add = win.addEventListener;
        var remove = win.removeEventListener;
        win.addEventListener = function (type, fn) {
            if (gamepadListeners[type]) {
                if (fn && gamepadListeners[type].indexOf(fn) < 0) gamepadListeners[type].push(fn);
                return undefined;
            }
            return add.apply(this || win, arguments);
        };
        win.removeEventListener = function (type, fn) {
            if (gamepadListeners[type]) {
                gamepadListeners[type] = gamepadListeners[type].filter(function (l) { return l !== fn; });
                return undefined;
            }
            return remove.apply(this || win, arguments);
        };

        function connection(type, gamepad) {
            var ev;
            try { ev = new win.Event(type); } catch (e) { ev = { type: type }; }
            try { Object.defineProperty(ev, 'gamepad', { value: gamepad }); } catch (e) { ev.gamepad = gamepad; }
            var handlers = gamepadListeners[type].slice();
            if (typeof win['on' + type] === 'function') handlers.push(win['on' + type]);
            handlers.forEach(function (h) {
                try {
                    if (typeof h === 'function') h.call(win, ev);
                    else if (h && typeof h.handleEvent === 'function') h.handleEvent(ev);
                } catch (e) {
                    console.error('[gamepad] listener failed', e);
                }
            });
        }

        function key(spec, type, repeat) {
            var target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : (doc.body || doc.documentElement);
            var ev = new win.KeyboardEvent(type, {
                key: spec.key, code: spec.code, shiftKey: !!spec.shiftKey, repeat: !!repeat,
                bubbles: true, cancelable: true, composed: true,
            });
            // spatial-navigation-polyfill and older handlers read keyCode, which KeyboardEvent's init cannot set.
            try {
                Object.defineProperty(ev, 'keyCode', { get: function () { return spec.keyCode; } });
                Object.defineProperty(ev, 'which', { get: function () { return spec.keyCode; } });
            } catch (e) { void e; }
            return target.dispatchEvent(ev);
        }

        var controller = createController({
            now: function () { return Date.now(); },
            setTimer: function (fn, ms) { return win.setTimeout(fn, ms); },
            clearTimer: function (id) { win.clearTimeout(id); },
            focused: function () {
                return typeof doc.hidden === 'boolean' ? !doc.hidden : (!doc.hasFocus || doc.hasFocus());
            },
            ensureFocus: function () {
                try {
                    if (win && typeof win.focus === 'function') win.focus();
                    if (doc && doc.body && typeof doc.body.focus === 'function' && (!doc.activeElement || doc.activeElement === doc.body)) {
                        doc.body.focus();
                    }
                } catch (_) { void 0; }
            },
            setGamepadMode: setGamepadMode,
            route: function () { return String(win.location.hash || '#/').slice(1).split('?')[0] || '/'; },
            navigate: function (path) { win.location.hash = '#' + path; },
            mediaKey: function (action) {
                // The same signal the shell sends for keyboard media keys; the player handles it (Player.js).
                if (typeof win.__shellDispatch === 'function') {
                    win.__shellDispatch(JSON.stringify({ id: 0, type: 1, args: ['media-key', action] }));
                }
            },
            overlayOpen: function () {
                if (!doc || typeof doc.querySelector !== 'function') return false;
                return !!doc.querySelector(
                    '.modals-container > *, [data-gamepad-modal], [class*="dropdown"][class*="open"], [class*="context-menu"], ' +
                    '[class*="menu-layer"], [class*="side-drawer-layer"], [class*="shortcuts-modal"], [class*="next-video-popup"]'
                );
            },
            closeOverlay: function () {
                return closePlayerOverlay(doc);
            },
            exitPlayer: function () {
                try {
                    var backBtn = doc.querySelector && doc.querySelector('[class*="back-button-container"], .back-button-container');
                    if (backBtn && typeof backBtn.click === 'function') {
                        backBtn.click();
                    } else if (win.history && typeof win.history.back === 'function') {
                        win.history.back();
                    } else {
                        key(KEYS.backspace, 'keydown', false);
                        key(KEYS.backspace, 'keyup', false);
                    }
                } catch (_) {
                    key(KEYS.backspace, 'keydown', false);
                    key(KEYS.backspace, 'keyup', false);
                }
                try {
                    if (win && typeof win.focus === 'function') win.focus();
                    if (doc && doc.body && typeof doc.body.focus === 'function') doc.body.focus();
                } catch (_) { void 0; }
                if (win && typeof win.setTimeout === 'function') {
                    win.setTimeout(function () {
                        try {
                            if (win && typeof win.focus === 'function') win.focus();
                            var scope = getScope(doc);
                            var candidates = getCandidates(scope, win);
                            var target = findInitialCandidate(candidates, win);
                            if (target) focusTarget(target, win);
                        } catch (_) { void 0; }
                    }, 100);
                }
            },
            key: key,
            moveFocus: function (dir) {
                return navigateDirection(doc, win, dir);
            },
            activate: function () {
                var el = doc.activeElement;
                if (!el || el === doc.body || el === doc.documentElement || el.isContentEditable) return;
                // Form fields are left alone: the app's Checkbox toggles on Enter without preventDefault, so a click
                // would toggle it straight back, and text fields have nothing to click.
                var tag = el.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                if (typeof el.click === 'function') el.click();
            },
            connection: connection,
        }, saved);

        try {
            Object.defineProperty(win.navigator, 'getGamepads', {
                configurable: true,
                writable: true,
                value: function getGamepads() { return controller.getGamepads(); },
            });
        } catch (e) {
            console.error('[gamepad] could not replace navigator.getGamepads', e);
        }
        add.call(win, 'blur', function () { controller.releaseAll(); });

        win.__cinemaPad = {
            update: controller.update,
            getState: controller.getState,
            getConfig: controller.getConfig,
            setConfig: function (cfg) {
                var c = controller.setConfig(cfg);
                try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) { void e; }
                return c;
            },
            resetConfig: function () { return win.__cinemaPad.setConfig({}); },
            capture: controller.capture,
            subscribe: controller.subscribe,
            INPUTS: INPUTS,
            INPUT_LABELS: INPUT_LABELS,
            STICKS: STICKS,
            STICK_LABELS: STICK_LABELS,
            STICK_MODES: STICK_MODES,
            ACTIONS: Object.keys(ACTIONS).map(function (id) { return { id: id, label: ACTIONS[id].label, player: !!ACTIONS[id].player }; }),
            PRESETS: Object.keys(PRESETS).map(function (id) { return { id: id, label: PRESETS[id].label }; }),
        };
    }

    return {
        INPUTS: INPUTS,
        STICKS: STICKS,
        STICK_MODES: STICK_MODES,
        ACTIONS: ACTIONS,
        PRESETS: PRESETS,
        KEYS: KEYS,
        TABS: TABS,
        normalizeConfig: normalizeConfig,
        resolveBindings: resolveBindings,
        stickDirection: stickDirection,
        stickInterval: stickInterval,
        tabIndex: tabIndex,
        createController: createController,
        install: install,
        findNextCandidate: findNextCandidate,
        findInitialCandidate: findInitialCandidate,
        getCandidates: getCandidates,
        focusTarget: focusTarget,
        navigateDirection: navigateDirection,
    };
});
