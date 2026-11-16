'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SentinelDaemon = require('../sentinel');

test('Sentinel notifications go through the notifier (the "notify" hook), never throw, and are a no-op without one', async () => {
    const s = new SentinelDaemon({}, fs.mkdtempSync(path.join(os.tmpdir(), 'sn-')));
    await s.notify('t', 'nobody listening'); // no notifier: fine
    const got = [];
    s.setNotifier(async (n) => got.push(n));
    await s.notify('HomeBot Cinema Sentinel', 'Auto-downloading S01E02');
    assert.deepEqual(got, [{ source: 'sentinel', title: 'HomeBot Cinema Sentinel', text: 'Auto-downloading S01E02' }]);
    s.setNotifier(async () => { throw new Error('down'); });
    const warn = console.warn; console.warn = () => {};
    try { await s.notify('x', 'y'); } finally { console.warn = warn; }
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'sentinel.js')), true);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'sentinel.js'), 'utf8'), /telegram/i, 'Telegram lives in plugins/telegram');
});
