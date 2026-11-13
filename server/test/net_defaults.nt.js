'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { applyNetDefaults, ATTEMPT_TIMEOUT_MS } = require('../net_defaults');

test('connection attempts get long enough for far-away hosts (Node defaults to 250 ms, which cut off every TMDB request)', () => {
    const before = net.getDefaultAutoSelectFamilyAttemptTimeout();
    try {
        assert.equal(applyNetDefaults(), ATTEMPT_TIMEOUT_MS);
        assert.ok(net.getDefaultAutoSelectFamilyAttemptTimeout() >= 1000);
    } finally {
        net.setDefaultAutoSelectFamilyAttemptTimeout(before);
    }
});
