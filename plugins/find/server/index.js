'use strict';
// Plugin "find": smart filters (#/find) over TMDB discover. The TMDB client is a core service (ctx.services.tmdb) because the
// AI copilot uses it too; this plugin only adds the routes and the page. Without TMDB_API_KEY the page explains how to enable it.

const { registerFindRoutes } = require('./routes');

function register(ctx) {
    registerFindRoutes(ctx.app, { tmdb: ctx.services.tmdb, library: ctx.services.library });
    return {};
}

module.exports = { register };
