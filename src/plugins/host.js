// Copyright (C) 2017-2026 HomeBot Cinema
// Runtime side of UI plugins. Boot (src/index.js) awaits loadPlugins() before rendering; core files then read contributions
// through slot(name) or <PluginSlot name=...>. Slots (what a plugin's ui/index.js may export, each an array):
//   routes           { path, view (1-3), Component }                 -> router (src/router/routerPaths.tsx)
//   appOverlays      { id, Component }                               -> always mounted inside the app (src/App/App.js)
//   navButtons       { id, Component, order }                        -> top bar, left of the menu (HorizontalNavBar)
//   discoverActions  { id, Component }                               -> Discover header (src/routes/Discover/Discover.js)
//   playerOverlays   { id, Component(player props) }                 -> over the video, above the control bar (src/routes/Player/Player.js)
//   settingsSections { id, label, Component (forwardRef) }           -> Settings, after General (Settings.tsx + Menu.tsx)
//   adminTabs        { id, label, order, Component({ onError }) }      -> Admin, after Overview (src/routes/Admin/Admin.js)
//   metaDetailsSections { id, Component({ type, id, videoId, meta }) } -> title page, under the description (MetaDetails.js)
//   accents          { key, label, color, secondary }                -> accent palette (src/common/theme.js)
// Adding a slot = one entry here + one call site in core; list it in docs/plugins.md.

const registry = require('./registry');

const SLOTS = ['routes', 'appOverlays', 'navButtons', 'discoverActions', 'playerOverlays', 'settingsSections', 'adminTabs', 'metaDetailsSections', 'accents'];

let active = new Set();
let loaded = false;
const waiters = [];

/** Fetch which plugins are active for this login. Never throws: on error the app runs with no plugins. */
async function loadPlugins(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
    try {
        const res = await fetchImpl('/api/plugins', { credentials: 'same-origin', cache: 'no-store' });
        const json = res.ok ? await res.json() : { plugins: [] };
        active = new Set((json.plugins || []).filter((p) => p && p.active).map((p) => p.id));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[plugins] could not load the plugin list, running without plugins:', e && e.message);
        active = new Set();
    }
    loaded = true;
    waiters.splice(0).forEach((fn) => fn());
    return [...active];
}

/** Run fn once the active list is known (immediately when it already is). */
function onPluginsLoaded(fn) {
    if (loaded) fn(); else waiters.push(fn);
}

const isActive = (id) => active.has(id);
const activeIds = () => Object.keys(registry).filter((id) => active.has(id)).sort();

/** Contributions of every active plugin to one slot, ordered by `order` then plugin id. */
function slot(name, reg = registry, ids = activeIds()) {
    if (!SLOTS.includes(name)) throw new Error(`unknown plugin slot "${name}" (known: ${SLOTS.join(', ')})`);
    const out = [];
    ids.forEach((pluginId) => {
        const list = (reg[pluginId] && reg[pluginId][name]) || [];
        list.forEach((item, i) => out.push({ pluginId, id: item.id || item.key || `${name}-${i}`, order: 100, ...item }));
    });
    return out.sort((a, b) => (a.order - b.order) || a.pluginId.localeCompare(b.pluginId));
}

module.exports = { loadPlugins, onPluginsLoaded, isActive, activeIds, slot, SLOTS };
