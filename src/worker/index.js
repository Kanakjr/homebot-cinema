// Copyright (C) 2017-2026 HomeBot Cinema
// Web worker entry (webpack "worker"): stremio-core-web's own worker, with fetch guarded first (see fetchGuard.js).

const { guardFetch } = require('./fetchGuard');

self.fetch = guardFetch(self.fetch.bind(self), { base: self.location.href });

require('@stremio/stremio-core-web/worker.js');
