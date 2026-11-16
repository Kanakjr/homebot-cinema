'use strict';
// Dependency direction, so a plugin can be removed without breaking core and core can be merged with upstream cleanly:
//   1. core (server/, http_server.js, src/ outside src/plugins) never imports a plugin;
//   2. a plugin's server code imports core only through server/sdk.js (live objects come through ctx);
//   3. a plugin never imports another plugin's files (use requires + ctx.plugins.get(id)).
// Plugin tests may import core freely (fixtures such as openDb).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const walk = (dir, re, out = []) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, re, out); else if (re.test(e.name)) out.push(p);
    }
    return out;
};
// require('x'), import ... from 'x', import('x'), require.context('x')
const SPEC_RE = /(?:require(?:\.context)?\(\s*|from\s+|import\(\s*)['"]([^'"]+)['"]/g;
const specs = (file) => [...fs.readFileSync(file, 'utf8').matchAll(SPEC_RE)].map((m) => m[1]);
const rel = (p) => path.relative(ROOT, p);

test('core never imports a plugin', () => {
    const files = [path.join(ROOT, 'http_server.js'), ...walk(path.join(ROOT, 'server'), /\.js$/), ...walk(path.join(ROOT, 'src'), /\.(js|jsx|ts|tsx)$/)]
        .filter((f) => !rel(f).startsWith(path.join('src', 'plugins') + path.sep));
    const bad = [];
    for (const f of files) {
        for (const s of specs(f)) {
            const target = s.startsWith('.') ? path.resolve(path.dirname(f), s) : null;
            if ((target && rel(target).split(path.sep)[0] === 'plugins') || /^stremio-plugins?\//.test(s)) bad.push(`${rel(f)} -> ${s}`);
        }
    }
    // http_server.js loads plugins by folder scan (no static import), src/plugins/registry.js by require.context: both allowed
    assert.deepEqual(bad, []);
});

test('plugin server code reaches core only through server/sdk.js, and never another plugin', () => {
    const bad = [];
    for (const f of walk(path.join(ROOT, 'plugins'), /\.js$/)) {
        const parts = rel(f).split(path.sep); // plugins/<id>/<area>/...
        const [, id, area] = parts;
        if (area !== 'server') continue;
        for (const s of specs(f)) {
            if (!s.startsWith('.')) continue; // node builtins / packages
            const target = rel(path.resolve(path.dirname(f), s));
            if (target.startsWith(path.join('plugins', id) + path.sep)) continue;
            if (target === path.join('server', 'sdk') || target === path.join('server', 'sdk.js')) continue;
            bad.push(`${rel(f)} -> ${s}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('plugin UI code never imports another plugin', () => {
    const bad = [];
    for (const f of walk(path.join(ROOT, 'plugins'), /\.(js|jsx|ts|tsx)$/)) {
        const [, id, area] = rel(f).split(path.sep);
        if (area !== 'ui') continue;
        for (const s of specs(f)) {
            if (!s.startsWith('.')) continue;
            const target = rel(path.resolve(path.dirname(f), s));
            if (target.split(path.sep)[0] === 'plugins' && target.split(path.sep)[1] !== id) bad.push(`${rel(f)} -> ${s}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('every plugin folder has plugin.json, AGENTS.md and tests', () => {
    const missing = [];
    for (const e of fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('_')) continue;
        const dir = path.join(ROOT, 'plugins', e.name);
        for (const need of ['plugin.json', 'AGENTS.md']) if (!fs.existsSync(path.join(dir, need))) missing.push(`plugins/${e.name}/${need}`);
        if (!walk(path.join(dir, 'test'), /\.(nt|spec)\.js$/).length) missing.push(`plugins/${e.name}/test/*.nt.js`);
    }
    assert.deepEqual(missing, []);
});
