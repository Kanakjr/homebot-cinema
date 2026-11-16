'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { register, format } = require('../server');
const { fakeCtx } = require('../../../server/plugins/testing');

test('inactive without a token and chat id', () => {
    const { ctx, disabled, hooks } = fakeCtx({ id: 'telegram' });
    register(ctx);
    assert.match(disabled(), /TELEGRAM_BOT_TOKEN/);
    assert.equal(hooks.count('notify'), 0);
});

test('forwards notify events (config from data/plugins.json settings works too)', async () => {
    const sent = [];
    const { ctx, hooks, disabled } = fakeCtx({ id: 'telegram', settings: { telegram: { TELEGRAM_BOT_TOKEN: 't0k', TELEGRAM_CHAT_ID: '42' } } });
    register(ctx, { send: async (m) => sent.push(m) });
    assert.equal(disabled(), null);
    await hooks.emit('notify', { source: 'sentinel', title: 'Sentinel', text: 'New episode of Show_Name: S01E02' });
    assert.deepEqual(sent, [{ token: 't0k', chatId: '42', text: '*Sentinel*\nNew episode of Show\\_Name: S01E02' }]);
});

test('a failing send never reaches the caller', async () => {
    const { ctx, hooks } = fakeCtx({ id: 'telegram', env: { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'y' } });
    register(ctx, { send: async () => { throw new Error('offline'); } });
    await hooks.emit('notify', { text: 'hi' }); // resolves
    assert.equal(format({ text: 'a*b' }), 'a\\*b');
});
