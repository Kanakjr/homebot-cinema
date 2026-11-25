'use strict';
// Plugin "getapp": a signed-in download page for the household's app installers (data/plugin-data/getapp/).

const fs = require('fs');
const path = require('path');
const { renderPage } = require('./page');

const KINDS = [
    { ext: '.dmg', platform: 'mac', label: 'macOS app' },
    { ext: '.apk', platform: 'android', label: 'Android app' },
];
const SHOTS = ['screenshot.png', 'screenshot.jpg'];
const NO_STORE = 'private, no-store';

/** Installers in dir, newest first: [{ name, platform, label, size, mtime }]. */
function listInstallers(dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    return names
        .filter((n) => !n.startsWith('.'))
        .map((name) => {
            const kind = KINDS.find((k) => name.toLowerCase().endsWith(k.ext));
            if (!kind) return null;
            let st;
            try { st = fs.statSync(path.join(dir, name)); } catch (_) { return null; }
            return st.isFile() ? { name, platform: kind.platform, label: kind.label, size: st.size, mtime: st.mtimeMs } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
}

const findShot = (dir) => SHOTS.find((n) => { try { return fs.statSync(path.join(dir, n)).isFile(); } catch (_) { return false; } }) || null;

function register(ctx) {
    const { app, auth } = ctx;
    const dir = ctx.dataDir();
    const title = ctx.config.get('GETAPP_TITLE', 'Get the app');

    // Express matches /api/getapp with or without the slash; the page's relative links need the slash.
    app.get('/api/getapp/', auth.requireLogin, (req, res) => {
        res.set('Cache-Control', NO_STORE);
        if (!req.path.endsWith('/')) return res.redirect(302, '/api/getapp/');
        res.type('html').send(renderPage({
            title,
            email: req.login.email,
            installers: listInstallers(dir),
            screenshot: findShot(dir) ? 'screenshot' : null,
        }));
    });

    app.get('/api/getapp/screenshot', auth.requireLogin, (_req, res) => {
        const shot = findShot(dir);
        if (!shot) return res.status(404).json({ error: 'not_found' });
        res.set('Cache-Control', NO_STORE);
        res.sendFile(path.join(dir, shot));
    });

    // Only a name from the current listing is served: no paths, no traversal.
    app.get('/api/getapp/file/:name', auth.requireLogin, (req, res) => {
        const item = listInstallers(dir).find((i) => i.name === req.params.name);
        if (!item) return res.status(404).json({ error: 'not_found' });
        res.set('Cache-Control', NO_STORE);
        ctx.log.info(`download ${item.name} by ${req.login.email}`);
        res.download(path.join(dir, item.name), item.name, { cacheControl: false });
    });

    return { listInstallers: () => listInstallers(dir) };
}

module.exports = { register, listInstallers };
