'use strict';
// The ctx object a plugin's register(ctx) receives: the whole contract between core and a plugin.
// Plugins get core through ctx (live objects) and through server/sdk.js (pure helpers); they never require core internals.
// Changing this shape is a breaking change for plugins: update docs/plugins.md and the test double in server/plugins/testing.js.

const fs = require('fs');
const path = require('path');
const sdk = require('../sdk');

/**
 * base: { app, auth: { requireLogin, requireAdmin, requireProfile }, db, hooks, events: { emit }, services, dataPath, settings, env, log }
 * settings: the "settings" object of data/plugins.json ({ <id>: { NAME: value } }), used when the env var is not set.
 */
function createContextFactory(base) {
    const env = base.env || process.env;
    const settings = base.settings || {};
    const rootLog = base.log || console;

    return function makeCtx(plugin, api) {
        const id = plugin.id;
        const tag = `[plugin:${id}]`;
        const log = {
            info: (...a) => rootLog.info(tag, ...a),
            warn: (...a) => rootLog.warn(tag, ...a),
            error: (...a) => rootLog.error(tag, ...a),
        };
        const own = settings[id] && typeof settings[id] === 'object' ? settings[id] : {};
        const get = (name, def) => {
            if (env[name] !== undefined && env[name] !== '') return String(env[name]);
            if (own[name] !== undefined && own[name] !== null && own[name] !== '') return String(own[name]);
            return def;
        };
        const config = Object.freeze({
            get,
            /** list('LIBRARY_EXTRA_TV_DIRS') -> ['/a', '/b'] (colon or comma separated) */
            list: (name, sep = /[:,]/) => String(get(name, '') || '').split(sep).map((s) => s.trim()).filter(Boolean),
            bool: (name, def = false) => { const v = get(name); return v === undefined ? def : /^(1|true|yes|on)$/i.test(v); },
            int: (name, def) => { const n = Number(get(name)); return Number.isFinite(n) ? n : def; },
        });
        const dataDir = path.join(base.dataPath, 'plugin-data', id);
        return Object.freeze({
            id,
            manifest: plugin.manifest,
            root: plugin.root,
            app: base.app,
            auth: Object.freeze({ ...base.auth }),
            db: Object.freeze({
                raw: base.db.raw,
                audit: base.db.audit,
                /** Own tables, versioned per plugin. Prefix table names with the plugin id. */
                migrate: (steps) => base.db.migratePlugin(id, steps),
            }),
            hooks: Object.freeze({
                on: (name, fn) => base.hooks.on(name, fn, id),
                provide: (name, fn) => base.hooks.provide(name, fn, id),
            }),
            events: Object.freeze({
                emit: (type, data) => base.events.emit(type, data),
                emitScoped: (type, data, filter) => (typeof base.events.emitScoped === 'function' ? base.events.emitScoped(type, data, filter) : undefined),
                onConnect: (fn) => (typeof base.events.onConnect === 'function' ? base.events.onConnect(fn) : undefined),
            }),
            services: Object.freeze({ ...base.services }),
            /** server/sdk.js (pure helpers). Private plugins in data/plugins/ must use this: no relative path reaches core from there */
            sdk,
            config,
            /** data/plugin-data/<id>/ (gitignored, backed up with data/); created on first call */
            dataDir: () => { fs.mkdirSync(dataDir, { recursive: true }); return dataDir; },
            log,
            disable: api.disable,
            plugins: Object.freeze({ get: api.get }),
        });
    };
}

module.exports = { createContextFactory };
