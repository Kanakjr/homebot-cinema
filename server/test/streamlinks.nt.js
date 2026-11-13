'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStreamLinks, loadSecret } = require('../streamlinks');

test('signed link verifies for its id until expiry', () => {
    let t = 1_000_000_000_000;
    const l = createStreamLinks({ secret: 's'.repeat(32), now: () => t, ttlSeconds: 60 });
    const { exp, sig } = l.sign('dl_abc');
    assert.ok(l.verify('dl_abc', exp, sig));
    t += 59_000; assert.ok(l.verify('dl_abc', exp, sig));
    t += 5_000;  assert.equal(l.verify('dl_abc', exp, sig), false); // expired
});

test('signature is bound to the id and the expiry, and to the secret', () => {
    const l = createStreamLinks({ secret: 'a'.repeat(32) });
    const { exp, sig } = l.sign('dl_abc');
    assert.equal(l.verify('dl_other', exp, sig), false);
    assert.equal(l.verify('dl_abc', exp + 1, sig), false);
    assert.equal(createStreamLinks({ secret: 'b'.repeat(32) }).verify('dl_abc', exp, sig), false);
});

test('missing / malformed inputs are rejected', () => {
    const l = createStreamLinks({ secret: 'a'.repeat(32) });
    for (const [id, exp, sig] of [['', 1, 'x'], ['a', undefined, 'x'], ['a', 'nan', 'x'], ['a', 9e12, ''], ['a', 9e12, undefined], ['a', 9e12, 'short']])
        assert.equal(l.verify(id, exp, sig), false);
});

test('ids with base64 characters (/ + =) round-trip', () => {
    const l = createStreamLinks({ secret: 'a'.repeat(32) });
    const id = Buffer.from('/TV/Show/Season 1/ep.mkv').toString('base64');
    const { exp, sig } = l.sign(id);
    assert.ok(l.verify(id, exp, sig));
});

test('loadSecret persists a generated secret with 0600 and reuses it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
    const a = loadSecret(dir, {});
    assert.equal(a.length, 64);
    assert.equal(loadSecret(dir, {}), a);
    assert.equal(fs.statSync(path.join(dir, 'stream_secret.key')).mode & 0o777, 0o600);
    assert.equal(loadSecret(dir, { STREAM_LINK_SECRET: 'x'.repeat(20) }), 'x'.repeat(20));
});
