'use strict';
// The plugin SDK: the pure core helpers a plugin's server code may require. Live objects (library, downloads, db, auth,
// hooks...) come through ctx in register(ctx) instead. Plugins never require other core files: keep this surface small,
// stable and documented (docs/plugins.md); the boundary test (server/test/boundaries.nt.js) enforces it.

const grab = require('./grabber/grab');
const sentinelState = require('./sentinel_state');
const { cleanStream } = require('./grabber/routes');
const { kidSafe, MAX_PAGE } = require('./tmdb');
const { parseHistory, profileHistory } = require('./watch_history');
const { isInsideRoots, mediaRoots } = require('./media_paths');

module.exports = {
    /** pick the best live release for a quality profile and queue it (shared with the Save button and Sentinel) */
    chooseRelease: grab.chooseRelease,
    queueRelease: grab.queueRelease,
    /** stream objects from an addon, cleaned to the fields the UI and AI use */
    cleanStream,
    /** Sentinel monitor scopes ('new' | 'seasons' | 'all') */
    normalizeScope: sentinelState.normalizeScope,
    scopeLabel: sentinelState.scopeLabel,
    /** TMDB helpers (the client itself is ctx.services.tmdb) */
    kidSafe,
    TMDB_MAX_PAGE: MAX_PAGE,
    /** per-profile watch history from the synced stremio-core buckets */
    parseHistory,
    profileHistory,
    /** file paths must stay inside the media roots */
    isInsideRoots,
    mediaRoots,
};
