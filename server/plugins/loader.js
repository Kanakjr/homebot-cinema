'use strict';
// Plugin loader. A plugin is a folder with plugin.json (+ server/index.js exporting register(ctx), + optional ui/index.js).
// Sources, in order: <repo>/plugins/<id> (public, in git) and <data>/plugins/<id> (private, gitignored, server-only).
// Which plugins run: CINEMA_PLUGINS (env) > data/plugins.json > each manifest's defaultEnabled. Nothing is installed at runtime.
// A plugin that throws while registering is marked failed and skipped; the server keeps running.

const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
        return null;
    }
}

/** Every plugin folder that has a valid plugin.json. Later sources do not override earlier ids (repo wins). */
function discover(dirs) {
    const found = new Map();
    const problems = [];
    for (const { dir, source } of dirs) {
        let names = [];
        try {
            names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
        } catch (_) {
            continue;
        }
        for (const name of names) {
            const root = path.join(dir, name);
            const manifest = readJson(path.join(root, 'plugin.json'));
            if (!manifest) continue;
            if (!ID_RE.test(String(manifest.id)) || manifest.id !== name) {
                problems.push(`${root}: plugin.json "id" must equal the folder name and match ${ID_RE}`);
                continue;
            }
            if (found.has(manifest.id)) {
                problems.push(`${root}: id "${manifest.id}" already provided by ${found.get(manifest.id).root}`);
                continue;
            }
            found.set(manifest.id, {
                id: manifest.id, root, source,
                manifest: {
                    name: manifest.name || manifest.id,
                    description: manifest.description || '',
                    version: manifest.version || '0.0.0',
                    defaultEnabled: !!manifest.defaultEnabled,
                    requires: Array.isArray(manifest.requires) ? manifest.requires : [],
                    env: Array.isArray(manifest.env) ? manifest.env : [],
                    server: manifest.server === undefined ? 'server/index.js' : manifest.server,
                    // private (data/) plugins cannot ship UI: the UI is compiled into the image
                    ui: source === 'repo' && fs.existsSync(path.join(root, 'ui', 'index.js')),
                },
            });
        }
    }
    return { plugins: found, problems };
}

/**
 * Which ids are switched on, and why.
 * env CINEMA_PLUGINS: "ai,find" | "all" | "none" | "" (unset = not used). Also "-gdrive" removes one from the defaults/all.
 * file data/plugins.json: { "enabled": [...], "disabled": [...] }.
 */
function resolveEnabled(all, { env, file }) {
    const ids = [...all.keys()];
    const defaults = ids.filter((id) => all.get(id).manifest.defaultEnabled);
    let set; let from;
    const raw = env === undefined || env === null ? '' : String(env).trim();
    if (raw) {
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        const minus = parts.filter((p) => p.startsWith('-')).map((p) => p.slice(1));
        const plus = parts.filter((p) => !p.startsWith('-'));
        if (plus.includes('none')) set = new Set();
        else if (plus.includes('all')) set = new Set(ids);
        else if (plus.length) set = new Set(plus);
        else set = new Set(defaults);
        minus.forEach((m) => set.delete(m));
        from = 'env CINEMA_PLUGINS';
    } else if (file && (Array.isArray(file.enabled) || Array.isArray(file.disabled))) {
        set = new Set(Array.isArray(file.enabled) ? file.enabled : defaults);
        (file.disabled || []).forEach((m) => set.delete(m));
        from = 'data/plugins.json';
    } else {
        set = new Set(defaults);
        from = 'defaults';
    }
    const unknown = [...set].filter((id) => !all.has(id));
    unknown.forEach((id) => set.delete(id));
    return { enabled: set, from, unknown };
}

/** Dependency order (requires first). Cycles or missing requirements leave a plugin out with a reason. */
function order(all, enabled) {
    const out = []; const reasons = new Map(); const state = new Map();
    const visit = (id, trail) => {
        if (state.get(id) === 'done') return reasons.has(id) ? false : true;
        if (state.get(id) === 'visiting') { reasons.set(id, `dependency cycle: ${[...trail, id].join(' -> ')}`); return false; }
        state.set(id, 'visiting');
        let ok = true;
        for (const req of all.get(id).manifest.requires) {
            if (!all.has(req)) { reasons.set(id, `requires unknown plugin "${req}"`); ok = false; break; }
            if (!enabled.has(req)) { reasons.set(id, `requires plugin "${req}", which is off`); ok = false; break; }
            if (!visit(req, [...trail, id])) { reasons.set(id, reasons.get(id) || `requires plugin "${req}", which could not load`); ok = false; break; }
        }
        state.set(id, 'done');
        if (ok) out.push(id);
        return ok;
    };
    [...enabled].sort().forEach((id) => visit(id, []));
    return { ids: out, reasons };
}

/**
 * Discover, pick and register plugins.
 * makeCtx(plugin, api) builds the ctx a plugin gets; api has disable(reason) and the exports of plugins registered before it.
 * Returns { status(), get(id), active(id) }.
 */
function loadPlugins({ dirs, env = process.env.CINEMA_PLUGINS, dataFile, makeCtx, log = console, requireFn = require }) {
    const { plugins: all, problems } = discover(dirs);
    problems.forEach((p) => log.warn(`[plugins] ${p}`));
    const file = dataFile ? readJson(dataFile) : null;
    const { enabled, from, unknown } = resolveEnabled(all, { env, file });
    unknown.forEach((id) => log.warn(`[plugins] "${id}" is switched on in ${from} but no such plugin exists`));
    const { ids, reasons } = order(all, enabled);

    const status = new Map();
    const exportsById = new Map();
    for (const [id, p] of all) {
        status.set(id, { id, ...p.manifest, source: p.source, enabled: enabled.has(id), active: false, reason: enabled.has(id) ? (reasons.get(id) || null) : `off (${from})`, error: null });
    }
    for (const id of ids) {
        const p = all.get(id);
        const st = status.get(id);
        const missing = p.manifest.requires.find((req) => !status.get(req) || !status.get(req).active);
        if (missing) { st.reason = `requires plugin "${missing}", which is not active`; continue; }
        if (!p.manifest.server) { st.active = true; exportsById.set(id, {}); continue; } // UI-only plugin
        let disabledReason = null;
        const api = {
            disable: (reason) => { disabledReason = String(reason || 'disabled by the plugin'); },
            get: (other) => exportsById.get(other),
        };
        try {
            const mod = requireFn(path.join(p.root, p.manifest.server));
            if (!mod || typeof mod.register !== 'function') throw new Error(`${p.manifest.server} must export register(ctx)`);
            const result = mod.register(makeCtx(p, api));
            if (result && typeof result.then === 'function') throw new Error('register(ctx) must be synchronous (start async work inside it instead)');
            if (disabledReason) {
                st.reason = disabledReason;
                log.info(`[plugins] ${id}: inactive (${disabledReason})`);
                continue;
            }
            exportsById.set(id, result || {});
            st.active = true;
            log.info(`[plugins] ${id} ${p.manifest.version} active (${p.source})`);
        } catch (e) {
            st.error = e.message;
            st.reason = 'failed to load';
            log.error(`[plugins] ${id} failed to load: ${e.stack || e.message}`);
        }
    }
    return {
        status: () => [...status.values()].map((s) => ({ ...s })),
        get: (id) => exportsById.get(id),
        active: (id) => !!(status.get(id) && status.get(id).active),
        from,
    };
}

module.exports = { loadPlugins, discover, resolveEnabled, order, ID_RE };
