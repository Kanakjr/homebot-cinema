#!/usr/bin/env node
// pnpm plugin:new <id> ["Name"] [--ui] [--no-server]
// Creates plugins/<id>/ with plugin.json, AGENTS.md, a server entry, a test and (with --ui) a UI entry. Off by default:
// switch it on with CINEMA_PLUGINS=<id> or in data/plugins.json. Read docs/plugins.md first.

'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [id, name = id] = args.filter((a) => !a.startsWith('--'));
if (!/^[a-z][a-z0-9-]{1,31}$/.test(String(id || ''))) {
    console.error('usage: pnpm plugin:new <id> ["Display name"] [--ui] [--no-server]   (id: lowercase, 2-32 chars, a-z 0-9 -)');
    process.exit(1);
}
const root = path.resolve(__dirname, '..', 'plugins', id);
if (fs.existsSync(root)) {
    console.error(`plugins/${id} already exists`);
    process.exit(1);
}
const server = !flags.has('--no-server');
const ui = flags.has('--ui') || !server;
const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    console.log(`  plugins/${id}/${rel}`);
};
const envName = id.toUpperCase().replace(/-/g, '_') + '_EXAMPLE';

write('plugin.json', JSON.stringify({
    id, name, description: 'What this adds, in one sentence.', version: '0.1.0', defaultEnabled: false,
    ...(server ? {} : { server: null }),
    env: server ? [{ name: envName, description: 'Example setting (env or data/plugins.json settings).' }] : [],
}, null, 4) + '\n');

write('AGENTS.md', `# Plugin \`${id}\`

${name}. Read docs/plugins.md for the contract; this file is only what is special about this plugin.

- Server: \`server/index.js\` exports \`register(ctx)\` (sync). Core only through \`ctx\` and \`server/sdk.js\`.
- UI: \`ui/index.js\` exports slot contributions (see src/plugins/host.js). Lazy-load components with React.lazy.
- Tests: \`test/*.nt.js\` (node:test, run by \`pnpm test:server\`); use \`server/plugins/testing.js\` \`fakeCtx\`.
- Config: ${server ? `\`${envName}\`` : 'none'}.
- Own tables (if any): \`ctx.db.migrate([...])\`, names prefixed \`${id.replace(/-/g, '_')}_\`.
`);

if (server) {
    write('server/index.js', `'use strict';
// Plugin "${id}": ${name}.

function register(ctx) {
    const example = ctx.config.get('${envName}');
    if (!example) return ctx.disable('${envName} is not set');
    ctx.app.get('/api/${id}/status', ctx.auth.requireAdmin, (_req, res) => res.json({ ok: true }));
    return {};
}

module.exports = { register };
`);
    write(`test/${id}.nt.js`, `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { register } = require('../server');
const { fakeCtx } = require('../../../server/plugins/testing');

test('inactive until configured', () => {
    const { ctx, disabled } = fakeCtx({ id: '${id}', app: express() });
    register(ctx);
    assert.match(disabled(), /${envName}/);
});

test('answers /api/${id}/status when configured', async () => {
    const app = express();
    const { ctx, disabled } = fakeCtx({ id: '${id}', app, env: { ${envName}: 'x' } });
    register(ctx);
    assert.equal(disabled(), null);
    const srv = app.listen(0);
    try {
        const r = await fetch(\`http://127.0.0.1:\${srv.address().port}/api/${id}/status\`);
        assert.deepEqual(await r.json(), { ok: true });
    } finally { srv.close(); }
});
`);
}
if (ui) {
    write('ui/index.js', `// Plugin "${id}" (UI). Slots: see src/plugins/host.js.

const React = require('react');

module.exports = {
    settingsSections: [{ id: '${id}', label: '${name.replace(/'/g, "\\'")}', Component: React.lazy(() => import('./Settings')) }],
};
`);
    write('ui/Settings.js', `const React = require('react');
const { Section } = require('stremio/routes/Settings/components');

const Settings = React.forwardRef((_props, ref) => (
    <Section ref={ref} label={'${name.replace(/'/g, "\\'")}'}>
        <div>Settings for ${name}.</div>
    </Section>
));

module.exports = Settings;
`);
    if (!server) {
        write(`test/${id}.spec.js`, `/* global it, expect */
const plugin = require('../ui');
const { SLOTS } = require('../../../src/plugins/host');

it('exports only known slots', () => {
    Object.keys(plugin).forEach((k) => expect(SLOTS).toContain(k));
});
`);
    }
}
console.log(`\nNext: switch it on (CINEMA_PLUGINS=${id} or data/plugins.json), run pnpm test:server${ui ? ' and npx webpack' : ''}.`);
