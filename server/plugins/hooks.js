'use strict';
// Named extension points between core and plugins. Core calls emit()/collect(); plugins call on()/provide().
// Every hook is declared here, so a typo throws instead of silently never firing. Adding a hook = one line in HOOKS plus the
// core call site; list it in docs/plugins.md.

const HOOKS = {
    // events: emit(name, payload) -> every listener runs (errors are logged, never thrown into core)
    'notify': { kind: 'event', doc: 'Something worth telling the household happened. payload: { source, title, text }' },
    // providers: collect(name) -> array of every provider's return value
    'library.roots': { kind: 'provider', doc: 'Extra library roots. return { movie: [dir], series: [dir] }. Each must hold the .cinema-root marker to count as online.' },
};

function createHooks({ log = console } = {}) {
    const listeners = new Map(Object.keys(HOOKS).map((k) => [k, []]));
    const known = (name, kind) => {
        const h = HOOKS[name];
        if (!h) throw new Error(`unknown hook "${name}" (known: ${Object.keys(HOOKS).join(', ')})`);
        if (h.kind !== kind) throw new Error(`hook "${name}" is a ${h.kind}, not a ${kind}`);
    };
    const add = (name, kind, fn, owner) => {
        known(name, kind);
        if (typeof fn !== 'function') throw new TypeError(`hook "${name}" needs a function`);
        listeners.get(name).push({ fn, owner });
        return () => {
            const arr = listeners.get(name);
            const i = arr.findIndex((l) => l.fn === fn);
            if (i >= 0) arr.splice(i, 1);
        };
    };
    return {
        on: (name, fn, owner = null) => add(name, 'event', fn, owner),
        provide: (name, fn, owner = null) => add(name, 'provider', fn, owner),
        /** Fire an event. Resolves when every listener settled; a failing listener is logged and skipped. */
        async emit(name, payload) {
            known(name, 'event');
            await Promise.all(listeners.get(name).map(async ({ fn, owner }) => {
                try {
                    await fn(payload);
                } catch (e) {
                    log.warn(`[hooks] ${name} listener${owner ? ` (${owner})` : ''} failed: ${e.message}`);
                }
            }));
        },
        /** Synchronous: every provider's value (a throwing provider is logged and skipped). */
        collect(name, ...args) {
            known(name, 'provider');
            const out = [];
            for (const { fn, owner } of listeners.get(name)) {
                try {
                    const v = fn(...args);
                    if (v !== undefined && v !== null) out.push(v);
                } catch (e) {
                    log.warn(`[hooks] ${name} provider${owner ? ` (${owner})` : ''} failed: ${e.message}`);
                }
            }
            return out;
        },
        count: (name) => (listeners.get(name) || []).length,
    };
}

module.exports = { createHooks, HOOKS };
