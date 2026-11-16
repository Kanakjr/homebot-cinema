'use strict';
// Test double for a plugin's ctx: lets a plugin test call register(fakeCtx(...)) with an in-memory DB and a real express app,
// without starting the server. Same shape as server/plugins/context.js (keep them in step).

const os = require('os');
const fs = require('fs');
const path = require('path');
const { createHooks } = require('./hooks');
const { createContextFactory } = require('./context');

/**
 * fakeCtx({ id, app, db, services, env, settings, login }) -> { ctx, hooks, disabled(), events }
 * login: what requireLogin/requireAdmin/requireProfile put on req (default an admin).
 */
function fakeCtx({ id = 'test', app, db, services = {}, env = {}, settings = {}, login = { email: 'admin@example.com', isAdmin: true }, profile = { id: 1, name: 'Owner', isKid: false } } = {}) {
    const hooks = createHooks({ log: { warn: () => {} } });
    const events = [];
    const pass = (req, _res, next) => { req.login = login; req.profile = profile; next(); };
    const admin = (req, res, next) => (login.isAdmin ? pass(req, res, next) : res.status(403).json({ error: 'admin_only' }));
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), `plugin-${id}-`));
    let reason = null;
    const makeCtx = createContextFactory({
        app, db: db || { raw: null, audit: () => {}, migratePlugin: () => 0 }, hooks, services, env, settings, dataPath,
        auth: { requireLogin: pass, requireAdmin: admin, requireProfile: pass },
        events: { emit: (type) => events.push(type) },
        log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const ctx = makeCtx({ id, root: dataPath, manifest: { name: id } }, { disable: (r) => { reason = r; }, get: () => undefined });
    return { ctx, hooks, events, dataPath, disabled: () => reason };
}

module.exports = { fakeCtx };
