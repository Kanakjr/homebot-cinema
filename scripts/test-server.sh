#!/bin/sh
# Backend tests (node:test). The server needs only express + jose, which the Dockerfile installs the same way,
# so they are cached in .cache/server-deps instead of being added to the UI lockfile.
set -e
cd "$(dirname "$0")/.."
DEPS=.cache/server-deps
if [ ! -d "$DEPS/node_modules/express" ] || [ ! -d "$DEPS/node_modules/jose" ]; then
    echo "Installing express@4 + jose@5 into $DEPS (once)..."
    npm install --silent --no-audit --no-fund --prefix "$DEPS" express@4 jose@5 >/dev/null
fi
NODE_PATH="$PWD/$DEPS/node_modules" exec node --disable-warning=ExperimentalWarning --test server/test/*.nt.js
