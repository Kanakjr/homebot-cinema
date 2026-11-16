'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { loadPlugins, discover, resolveEnabled, order } = require('../plugins/loader');
const { createHooks } = require('../plugins/hooks');
const { createContextFactory } = require('../plugins/context');
const { registerPluginRoutes } = require('../plugins/routes');
const { openDb } = require('../db');

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** Writes plugins into a temp folder: { id: { manifest, server: 'source' , ui: bool } } */
function fixture(spec) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
    for (const [id, p] of Object.entries(spec)) {
        const root = path.join(dir, id);
        fs.mkdirSync(path.join(root, 'server'), { recursive: true });
        fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ id, name: id, ...(p.manifest || {}) }));
        if (p.server !== undefined) fs.writeFileSync(path.join(root, 'server', 'index.js'), p.server);
        if (p.ui) { fs.mkdirSync(path.join(root, 'ui')); fs.writeFileSync(path.join(root, 'ui', 'index.js'), 'export default {};'); }
    }
    return dir;
}
const OK = "module.exports = { register(ctx) { return { hello: () => 'hi from ' + ctx.id }; } };";
const makeCtx = (p, api) => ({ id: p.id, disable: api.disable, plugins: { get: api.get } });

test('discover: needs plugin.json whose id equals the folder; ui only for repo plugins', () => {
    const dir = fixture({ good: { server: OK, ui: true }, other: { server: OK, ui: true } });
    fs.mkdirSync(path.join(dir, 'Bad_Name'));
    fs.writeFileSync(path.join(dir, 'Bad_Name', 'plugin.json'), JSON.stringify({ id: 'Bad_Name' }));
    fs.mkdirSync(path.join(dir, 'nomanifest'));
    const r = discover([{ dir, source: 'repo' }]);
    assert.deepEqual([...r.plugins.keys()], ['good', 'other']);
    assert.equal(r.problems.length, 1);
    assert.equal(r.plugins.get('good').manifest.ui, true);
    const priv = discover([{ dir, source: 'data' }]);
    assert.equal(priv.plugins.get('good').manifest.ui, false, 'private plugins are server-only');
});

test('discover: the repo copy of an id wins over a private one', () => {
    const a = fixture({ ai: { server: OK } });
    const b = fixture({ ai: { server: OK } });
    const r = discover([{ dir: a, source: 'repo' }, { dir: b, source: 'data' }]);
    assert.equal(r.plugins.get('ai').source, 'repo');
    assert.equal(r.problems.length, 1);
});

test('resolveEnabled: env beats file beats defaults; all/none/-id; unknown ids reported', () => {
    const all = discover([{ dir: fixture({ aa: { server: OK, manifest: { defaultEnabled: true } }, bb: { server: OK }, cc: { server: OK } }), source: 'repo' }]).plugins;
    const ids = (r) => [...r.enabled].sort();
    assert.deepEqual(ids(resolveEnabled(all, {})), ['aa']);
    assert.equal(resolveEnabled(all, {}).from, 'defaults');
    assert.deepEqual(ids(resolveEnabled(all, { file: { enabled: ['bb'] } })), ['bb']);
    assert.deepEqual(ids(resolveEnabled(all, { file: { disabled: ['aa'] } })), []);
    assert.deepEqual(ids(resolveEnabled(all, { env: 'cc', file: { enabled: ['bb'] } })), ['cc']);
    assert.deepEqual(ids(resolveEnabled(all, { env: 'all,-bb' })), ['aa', 'cc']);
    assert.deepEqual(ids(resolveEnabled(all, { env: 'none' })), []);
    assert.deepEqual(ids(resolveEnabled(all, { env: '-aa' })), []);
    assert.deepEqual(resolveEnabled(all, { env: 'aa,zzz' }).unknown, ['zzz']);
});

test('order: requirements first; missing, off or cyclic requirements leave a plugin out with a reason', () => {
    const all = discover([{ dir: fixture({
        base: { server: OK }, top: { server: OK, manifest: { requires: ['base'] } },
        lonely: { server: OK, manifest: { requires: ['nope'] } }, xx: { server: OK, manifest: { requires: ['yy'] } }, yy: { server: OK, manifest: { requires: ['xx'] } },
    }), source: 'repo' }]).plugins;
    const r = order(all, new Set(['top', 'base', 'lonely', 'xx', 'yy']));
    assert.ok(r.ids.indexOf('base') < r.ids.indexOf('top'));
    assert.ok(!r.ids.includes('lonely') && /unknown plugin "nope"/.test(r.reasons.get('lonely')));
    assert.ok(!r.ids.includes('xx') && !r.ids.includes('yy'));
    const off = order(all, new Set(['top']));
    assert.deepEqual(off.ids, []);
    assert.match(off.reasons.get('top'), /"base", which is off/);
});

test('loadPlugins: a throwing, async or disabled plugin is inactive and never takes the others down', () => {
    const dir = fixture({
        good: { server: OK },
        boom: { server: "module.exports = { register() { throw new Error('kaboom'); } };" },
        asyncy: { server: 'module.exports = { async register() {} };' },
        shy: { server: "module.exports = { register(ctx) { return ctx.disable('KEY not set'); } };" },
        noexport: { server: 'module.exports = {};' },
        dependent: { server: OK, manifest: { requires: ['boom'] } },
    });
    const l = loadPlugins({ dirs: [{ dir, source: 'repo' }], env: 'all', makeCtx, log: quiet });
    const st = Object.fromEntries(l.status().map((s) => [s.id, s]));
    assert.equal(st.good.active, true);
    assert.equal(l.get('good').hello(), 'hi from good');
    assert.equal(st.boom.active, false); assert.match(st.boom.error, /kaboom/);
    assert.equal(st.asyncy.active, false); assert.match(st.asyncy.error, /synchronous/);
    assert.equal(st.shy.active, false); assert.equal(st.shy.reason, 'KEY not set'); assert.equal(st.shy.error, null);
    assert.equal(st.noexport.active, false); assert.match(st.noexport.error, /register\(ctx\)/);
    assert.equal(st.dependent.active, false); assert.match(st.dependent.reason, /"boom", which is not active/);
});

test('a private plugin (data/plugins) loads through the real ctx and reaches core helpers via ctx.sdk', () => {
    const dir = fixture({ mine: { server: "module.exports = { register(ctx) { return { scope: ctx.sdk.scopeLabel('new'), hooks: typeof ctx.hooks.on }; } };" } });
    const make = createContextFactory({
        app: {}, auth: {}, db: { raw: null, audit: () => {}, migratePlugin: () => 0 }, hooks: createHooks(), events: { emit: () => {} },
        services: {}, dataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'priv-')), env: {}, settings: {}, log: quiet,
    });
    const l = loadPlugins({ dirs: [{ dir, source: 'data' }], env: 'mine', makeCtx: make, log: quiet });
    const st = l.status()[0];
    assert.equal(st.source, 'data');
    assert.equal(st.active, true, st.error);
    assert.equal(typeof l.get('mine').scope, 'string');
    assert.equal(l.get('mine').hooks, 'function');
});

test('loadPlugins: zero plugins is a valid setup', () => {
    const l = loadPlugins({ dirs: [{ dir: fixture({ aa: { server: OK } }), source: 'repo' }], env: 'none', makeCtx, log: quiet });
    assert.deepEqual(l.status().filter((s) => s.active), []);
    assert.equal(l.status()[0].reason, 'off (env CINEMA_PLUGINS)');
});

test('loadPlugins: a plugin can use the exports of one it requires', () => {
    const dir = fixture({
        base: { server: OK },
        top: { server: "module.exports = { register(ctx) { return { greet: () => ctx.plugins.get('base').hello() }; } };", manifest: { requires: ['base'] } },
    });
    const l = loadPlugins({ dirs: [{ dir, source: 'repo' }], env: 'top,base', makeCtx, log: quiet });
    assert.equal(l.get('top').greet(), 'hi from base');
});

test('hooks: unknown names and wrong kinds throw; failing listeners are isolated', async () => {
    const warnings = [];
    const h = createHooks({ log: { warn: (m) => warnings.push(m) } });
    assert.throws(() => h.on('notfy', () => {}), /unknown hook "notfy"/);
    assert.throws(() => h.on('library.roots', () => {}), /is a provider/);
    const got = [];
    h.on('notify', () => { throw new Error('down'); }, 'bad');
    h.on('notify', (n) => got.push(n.text), 'good');
    await h.emit('notify', { text: 'hello' });
    assert.deepEqual(got, ['hello']);
    assert.match(warnings[0], /\(bad\) failed: down/);
    h.provide('library.roots', () => ({ movie: ['/a'] }));
    h.provide('library.roots', () => { throw new Error('x'); });
    assert.deepEqual(h.collect('library.roots'), [{ movie: ['/a'] }]);
});

test('ctx: config reads env first, then data/plugins.json settings; frozen; own data dir', () => {
    const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
    const hooks = createHooks();
    const make = createContextFactory({
        app: {}, auth: {}, db: { raw: null, audit: () => {}, migratePlugin: (id, steps) => `${id}:${steps.length}` }, hooks, events: { emit: () => {} },
        services: { x: 1 }, dataPath, env: { A: 'from-env', LIST: '/a:/b, /c' }, settings: { demo: { A: 'from-file', B: 'file-only', N: '7' } }, log: quiet,
    });
    const ctx = make({ id: 'demo', root: '/x', manifest: {} }, { disable: () => {}, get: () => {} });
    assert.equal(ctx.config.get('A'), 'from-env');
    assert.equal(ctx.config.get('B'), 'file-only');
    assert.equal(ctx.config.get('C', 'dflt'), 'dflt');
    assert.deepEqual(ctx.config.list('LIST'), ['/a', '/b', '/c']);
    assert.equal(ctx.config.int('N', 0), 7);
    assert.equal(ctx.db.migrate(['x']), 'demo:1');
    assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.services));
    assert.equal(ctx.dataDir(), path.join(dataPath, 'plugin-data', 'demo'));
    assert.ok(fs.existsSync(ctx.dataDir()));
});

test('db.migratePlugin: versioned per plugin, append-only, rolled back on error', () => {
    const db = openDb(fs.mkdtempSync(path.join(os.tmpdir(), 'pdb-')), ':memory:');
    db.migratePlugin('tracker', ['CREATE TABLE tracker_plays (id INTEGER PRIMARY KEY)']);
    db.migratePlugin('tracker', ['CREATE TABLE tracker_plays (id INTEGER PRIMARY KEY)', 'ALTER TABLE tracker_plays ADD COLUMN at TEXT']);
    assert.equal(db.raw.prepare("SELECT version FROM plugin_schema WHERE id = 'tracker'").get().version, 2);
    assert.throws(() => db.migratePlugin('tracker', ['x', 'y', 'NOT SQL']), /tracker migration v3 failed/);
    assert.equal(db.raw.prepare("SELECT version FROM plugin_schema WHERE id = 'tracker'").get().version, 2);
    assert.throws(() => db.migratePlugin('../evil', []), /bad plugin id/);
});

test('/api/plugins: users see active ids only; admins see reasons and env; toggling writes data/plugins.json', async () => {
    const dir = fixture({ on: { server: OK, ui: true, manifest: { env: [{ name: 'ON_KEY', required: true }] } }, off: { server: OK } });
    const loader = loadPlugins({ dirs: [{ dir, source: 'repo' }], env: '', dataFile: null, makeCtx, log: quiet });
    const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-')), 'plugins.json');
    let login = { email: 'u@example.com', isAdmin: false };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.login = login; next(); });
    const audits = [];
    registerPluginRoutes(app, { loader, dataFile, requireAdmin: (req, res, next) => (req.login.isAdmin ? next() : res.status(403).end()), audit: (...a) => audits.push(a), env: { ON_KEY: 'x' } });
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
        // nothing is default-enabled in this fixture
        let r = await (await fetch(`${base}/api/plugins`)).json();
        assert.deepEqual(r.plugins, []);
        assert.equal((await fetch(`${base}/api/plugins/on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })).status, 403);
        login = { email: 'a@example.com', isAdmin: true };
        r = await (await fetch(`${base}/api/plugins`)).json();
        assert.equal(r.plugins.length, 2);
        assert.deepEqual(r.plugins.find((p) => p.id === 'on').env, [{ name: 'ON_KEY', required: true, description: '', set: true }]);
        const t = await (await fetch(`${base}/api/plugins/on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })).json();
        assert.equal(t.restartRequired, true);
        assert.deepEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).enabled, ['on']);
        assert.equal(audits[0][2], 'plugin.toggle');
        assert.equal((await fetch(`${base}/api/plugins/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":true}' })).status, 404);
        assert.equal((await fetch(`${base}/api/plugins/on`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":"yes"}' })).status, 400);
    } finally {
        srv.close();
    }
});
