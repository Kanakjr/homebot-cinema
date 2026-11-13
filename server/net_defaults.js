'use strict';
// Hosts far from home (TMDB's CDN, Cinemeta, stream addons) can need more than 250 ms just to accept a connection from here.
// Node gives up on each address after 250 ms by default and tries the next one, so every attempt is cut off and the request
// fails with ETIMEDOUT, even though the host is reachable. A longer per-address window fixes it for fetch() and https.get alike.

const net = require('net');

const ATTEMPT_TIMEOUT_MS = 3000;

function applyNetDefaults() {
    if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') net.setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_TIMEOUT_MS);
    return typeof net.getDefaultAutoSelectFamilyAttemptTimeout === 'function' ? net.getDefaultAutoSelectFamilyAttemptTimeout() : null;
}

module.exports = { applyNetDefaults, ATTEMPT_TIMEOUT_MS };
