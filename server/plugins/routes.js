'use strict';
// GET  /api/plugins          -> which plugins are active (everyone: the UI loads only those). Admins also get reasons/errors.
// POST /api/plugins/:id      -> admin: switch one on/off in data/plugins.json. Takes effect on the next server restart.

const fs = require('fs');

function registerPluginRoutes(app, { loader, dataFile, requireAdmin, audit = () => {}, env = process.env }) {
    app.get('/api/plugins', (req, res) => {
        const all = loader.status();
        if (!req.login || !req.login.isAdmin) {
            return res.json({ plugins: all.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, ui: p.ui, active: true })) });
        }
        res.json({
            from: loader.from,
            envOverride: !!String(env.CINEMA_PLUGINS || '').trim(),
            plugins: all.map((p) => ({
                id: p.id, name: p.name, description: p.description, version: p.version, source: p.source, ui: p.ui,
                enabled: p.enabled, active: p.active, reason: p.reason, error: p.error,
                env: p.env.map((e) => ({ name: e.name, required: !!e.required, description: e.description || '', set: !!(env[e.name] && String(env[e.name]).trim()) })),
            })),
        });
    });

    app.post('/api/plugins/:id', requireAdmin, (req, res) => {
        const id = req.params.id;
        const known = loader.status().find((p) => p.id === id);
        if (!known) return res.status(404).json({ error: 'unknown_plugin' });
        if (typeof (req.body && req.body.enabled) !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false' });
        let file = {};
        try { file = JSON.parse(fs.readFileSync(dataFile, 'utf8')) || {}; } catch (_) { file = {}; }
        const current = new Set(Array.isArray(file.enabled) ? file.enabled : loader.status().filter((p) => p.enabled).map((p) => p.id));
        if (req.body.enabled) current.add(id); else current.delete(id);
        file.enabled = [...current].sort();
        if (Array.isArray(file.disabled)) file.disabled = file.disabled.filter((x) => x !== id);
        const tmp = `${dataFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
        fs.renameSync(tmp, dataFile);
        audit(req.login.email, null, 'plugin.toggle', { id, enabled: req.body.enabled });
        res.json({ success: true, enabled: file.enabled, restartRequired: true, envOverride: !!String(env.CINEMA_PLUGINS || '').trim() });
    });
}

module.exports = { registerPluginRoutes };
