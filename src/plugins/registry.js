// Copyright (C) 2017-2026 HomeBot Cinema
// Every plugin UI (plugins/<id>/ui/index.js) compiled into the bundle at build time. Which ones RUN is decided at boot by
// host.js from GET /api/plugins, so a switched-off plugin never mounts (its lazy chunks are never downloaded).

const modules = {};
// require.context is a webpack feature; under jest (no webpack) it throws and the registry is simply empty
let req = null;
try {
    req = require.context('../../plugins', true, /^\.\/[a-z][a-z0-9-]+\/ui\/index\.js$/);
} catch (_) {
    req = null;
}
if (req) {
    req.keys().forEach((key) => {
        const id = key.split('/')[1];
        const mod = req(key);
        modules[id] = (mod && mod.default) || mod;
    });
}

module.exports = modules;
