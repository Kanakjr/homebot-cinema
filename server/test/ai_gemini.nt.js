'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGemini } = require('../ai/gemini');

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const bad = (status) => ({ ok: false, status, json: async () => ({ error: { message: 'secret-key-in-body' } }) });
const req = { system: 'sys', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [{ name: 't' }] };

test('the key is sent in a header (never in the URL), with the model, system prompt, tools and contents', async () => {
    let seen;
    const g = createGemini({ apiKey: 'KEY-123', model: 'gemini-test', fetchImpl: async (url, init) => { seen = { url: String(url), init }; return ok({ candidates: [] }); } });
    assert.equal(g.configured(), true);
    assert.equal(g.model, 'gemini-test');
    await g.generate(req);
    assert.ok(seen.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'));
    assert.ok(!seen.url.includes('KEY-123'), 'no key in the URL');
    assert.equal(seen.init.headers['x-goog-api-key'], 'KEY-123');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.system_instruction.parts[0].text, 'sys');
    assert.deepEqual(body.tools[0].function_declarations, [{ name: 't' }]);
    assert.equal(body.contents[0].parts[0].text, 'hi');
});

test('defaults to gemini-2.5-flash, and is "not configured" without a key', async () => {
    assert.equal(createGemini({ apiKey: 'k' }).model, 'gemini-2.5-flash');
    const g = createGemini({ apiKey: '  ' });
    assert.equal(g.configured(), false);
    await assert.rejects(() => g.generate(req), (e) => e.message === 'gemini_not_configured' && e.status === 503);
});

test('a busy answer (429 / 503) is tried once more; other errors are final and never echo the key or the response body', async () => {
    let n = 0;
    const g = createGemini({ apiKey: 'KEY-123', fetchImpl: async () => (++n === 1 ? bad(503) : ok({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })) });
    const r = await g.generate(req);
    assert.equal(r.candidates[0].content.parts[0].text, 'ok');
    assert.equal(n, 2);

    for (const status of [400, 401, 403]) {
        const g2 = createGemini({ apiKey: 'KEY-123', fetchImpl: async () => bad(status) });
        await assert.rejects(() => g2.generate(req), (e) => e.message === 'gemini_rejected' && e.status === 502 && !/KEY-123|secret/.test(e.message));
    }
    const g3 = createGemini({ apiKey: 'KEY-123', fetchImpl: async () => bad(500) });
    await assert.rejects(() => g3.generate(req), (e) => e.message === 'gemini_http_500');
});

test('a network failure is retried once, then reported as unreachable', async () => {
    let n = 0;
    const g = createGemini({ apiKey: 'KEY-123', fetchImpl: async () => { n++; throw new Error('connect ECONNRESET key=KEY-123'); } });
    await assert.rejects(() => g.generate(req), (e) => e.message === 'gemini_unreachable' && e.status === 502 && !e.message.includes('KEY'));
    assert.equal(n, 2);
});
