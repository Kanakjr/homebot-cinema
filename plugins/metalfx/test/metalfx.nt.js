'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fakeCtx } = require('../../../server/plugins/testing');
const { register } = require('../server');

async function withServer(app, fn) {
    const srv = app.listen(0);
    try {
        return await fn(`http://127.0.0.1:${srv.address().port}`);
    } finally {
        srv.close();
    }
}

test('metalfx: register registers status route and reports hardware candidate facts', async () => {
    const app = express();
    const { ctx } = fakeCtx({ id: 'metalfx', app });
    const exportsObj = register(ctx);

    assert.equal(typeof exportsObj.hardwareCandidate, 'boolean');

    await withServer(app, async (base) => {
        const res = await fetch(`${base}/api/metalfx/status`);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.plugin, 'metalfx');
        assert.equal(typeof json.version, 'string');
        assert.equal(typeof json.hardwareCandidate, 'boolean');
        assert.equal(typeof json.platform, 'string');
        assert.equal(typeof json.arch, 'string');
        assert.equal(json.benchmark.targetResolution, '4K UHD (3840x2160)');
        assert.equal(json.benchmark.testedDevice, 'Apple M4');
        assert.equal(json.benchmark.avgLatencyMs, 5.416);
    });
});
