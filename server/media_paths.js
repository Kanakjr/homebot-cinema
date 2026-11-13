'use strict';
// Confines file serving/deleting to the media roots (/Movies, /TV, /downloads by default).
// Uses realpath so symlinks and ".." cannot escape the roots.

const fs = require('fs');
const path = require('path');

function mediaRoots(env = process.env) {
    return String(env.MEDIA_ROOTS || '/Movies:/TV:/downloads')
        .split(':')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => {
            try {
                return fs.realpathSync(r);
            } catch (_) {
                return path.resolve(r);
            }
        });
}

function isInsideRoots(candidate, roots = mediaRoots()) {
    if (typeof candidate !== 'string' || !candidate) return false;
    let real;
    try {
        real = fs.realpathSync(candidate);
    } catch (_) {
        return false;
    }
    return roots.some((root) => real === root || real.startsWith(root + path.sep));
}

module.exports = { mediaRoots, isInsideRoots };
