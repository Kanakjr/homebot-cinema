'use strict';
// Plugin "remote": backend tests for screen registry, SSE command dispatch, and routes.
// Run with: pnpm test:server

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createTargetRegistry } = require('../server/targets');
const { register } = require('../server/index');
const { fakeCtx } = require('../../../server/plugins/testing');

function createMockResponse() {
    let closed = false;
    const written = [];
    const listeners = {};
    return {
        writeHead: () => undefined,
        write: (chunk) => {
            if (closed) throw new Error('write after close');
            written.push(String(chunk));
        },
        end: () => {
            closed = true;
            if (listeners.close) listeners.close();
        },
        on: (ev, fn) => { listeners[ev] = fn; },
        written: () => written,
        lastChunk: () => written[written.length - 1],
    };
}

test('targets: register screen and list targets', () => {
    let t = 1000;
    const reg = createTargetRegistry({ now: () => t });

    const screen1 = reg.registerTarget({
        targetId: 'mac-mini-1',
        name: 'Mac Mini',
        device: 'Desktop app on macOS',
        isDesktop: true,
    }, { login: 'user@example.com' });

    assert.equal(screen1.id, 'mac-mini-1');
    assert.equal(screen1.name, 'Mac Mini');
    assert.equal(screen1.isDesktop, true);
    assert.equal(screen1.online, true);

    const screen2 = reg.registerTarget({
        targetId: 'android-phone',
        name: 'Pixel Phone',
        device: 'Chrome on Android',
        isDesktop: false,
    }, { login: 'user@example.com' });

    assert.equal(screen2.id, 'android-phone');
    assert.equal(screen2.isDesktop, false);

    const list = reg.listTargets();
    assert.equal(list.length, 2);
    // Desktop apps should sort first
    assert.equal(list[0].id, 'mac-mini-1');
    assert.equal(list[1].id, 'android-phone');
});

test('targets: update playback state and nowPlaying info', () => {
    let t = 2000;
    const reg = createTargetRegistry({ now: () => t });

    reg.registerTarget({ targetId: 'mac-mini-1', name: 'Mac Mini' });

    const updated = reg.updateState({
        targetId: 'mac-mini-1',
        state: 'playing',
        nowPlaying: {
            title: 'Dune: Part Two',
            showName: null,
            type: 'movie',
            metaId: 'tt15239678',
            poster: 'https://images.example.com/dune.jpg',
            timeMs: 45000,
            durationMs: 7200000,
            paused: false,
            volume: 85,
            muted: false,
        },
    });

    assert.equal(updated.state, 'playing');
    assert.equal(updated.nowPlaying.title, 'Dune: Part Two');
    assert.equal(updated.nowPlaying.timeMs, 45000);
    assert.equal(updated.nowPlaying.volume, 85);
    assert.equal(updated.nowPlaying.paused, false);

    // Pause updates state to paused
    const paused = reg.updateState({
        targetId: 'mac-mini-1',
        nowPlaying: {
            ...updated.nowPlaying,
            paused: true,
            timeMs: 50000,
        },
    });
    assert.equal(paused.state, 'paused');
    assert.equal(paused.nowPlaying.paused, true);
    assert.equal(paused.nowPlaying.timeMs, 50000);
});

test('targets: sendCommand delivers to active SSE target stream', () => {
    let t = 3000;
    const reg = createTargetRegistry({ now: () => t });
    reg.registerTarget({ targetId: 'mac-mini-1', name: 'Mac Mini' });

    const mockRes = createMockResponse();
    reg.attachTargetStream('mac-mini-1', mockRes, { on: () => undefined });

    // Send play command
    const res = reg.sendCommand('mac-mini-1', 'play', {
        path: '#/player/stream123',
        title: 'Inception',
    }, { login: 'android@example.com' });

    assert.equal(res.ok, true);
    assert.equal(res.delivered, true);
    assert.ok(res.commandId);

    const last = mockRes.lastChunk();
    assert.ok(last.includes('event: command\n'));
    assert.ok(last.includes('"action":"play"'));
    assert.ok(last.includes('"title":"Inception"'));
});

test('targets: sendCommand queues commands when target stream is reconnecting', () => {
    let t = 4000;
    const reg = createTargetRegistry({ now: () => t });
    reg.registerTarget({ targetId: 'mac-mini-1', name: 'Mac Mini' });

    // No SSE stream attached yet -> queued
    const queued = reg.sendCommand('mac-mini-1', 'pause', {});
    assert.equal(queued.ok, true);
    assert.equal(queued.delivered, false);
    assert.equal(queued.queued, true);

    // Now target connects -> flushes queued command
    const mockRes = createMockResponse();
    reg.attachTargetStream('mac-mini-1', mockRes, { on: () => undefined });

    const written = mockRes.written().join('');
    assert.ok(written.includes('event: command\n'));
    assert.ok(written.includes('"action":"pause"'));
});

test('targets: command validation and error handling', () => {
    const reg = createTargetRegistry();
    reg.registerTarget({ targetId: 'mac-mini-1', name: 'Mac Mini' });

    // Unknown target
    const res1 = reg.sendCommand('unknown-device', 'play', {});
    assert.equal(res1.ok, false);
    assert.equal(res1.error, 'target_not_found');

    // Unknown action
    const res2 = reg.sendCommand('mac-mini-1', 'hackSystem', {});
    assert.equal(res2.ok, false);
    assert.equal(res2.error, 'invalid_action');
});

test('targets: prune expired targets after TTL', () => {
    let t = 1000;
    const reg = createTargetRegistry({ now: () => t, ttlMs: 45000 });

    reg.registerTarget({ targetId: 'temp-screen', name: 'Temporary Tab' });
    assert.equal(reg.listTargets().length, 1);

    // Fast forward 50 seconds without heartbeat
    t += 50000;
    assert.equal(reg.listTargets().length, 0);
});

test('server routes: register, state, command, list, delete', async () => {
    const app = express();
    app.use(express.json());

    const { ctx } = fakeCtx({
        id: 'remote',
        app,
        login: { email: 'test@example.com', isAdmin: false },
        profile: { id: 1, name: 'Main' },
    });

    const plugin = register(ctx);
    assert.ok(plugin.registry);

    // 1. Register target
    const regRes = plugin.registry.registerTarget({
        targetId: 'mac-mini-server-test',
        name: 'Mac Mini Test',
        device: 'Desktop app on macOS',
        isDesktop: true,
    }, { login: 'test@example.com' });
    assert.ok(regRes);

    // 2. List targets
    const list = plugin.registry.listTargets('test@example.com');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'mac-mini-server-test');

    // 3. Update state
    const state = plugin.registry.updateState({
        targetId: 'mac-mini-server-test',
        state: 'playing',
        nowPlaying: {
            title: 'Test Movie',
            timeMs: 12000,
            durationMs: 60000,
            paused: false,
        },
    });
    assert.equal(state.state, 'playing');
    assert.equal(state.nowPlaying.title, 'Test Movie');

    // 4. Connect and disconnect controller
    const conn = plugin.registry.connectControllerToTarget('mac-mini-server-test', 'phone-123', {
        name: 'Pixel Phone',
        device: 'Android Phone',
    });
    assert.equal(conn, true);
    const withConn = plugin.registry.listTargets('test@example.com');
    assert.equal(withConn[0].connectedCount, 1);
    assert.equal(withConn[0].activeControllers[0].name, 'Pixel Phone');

    const disconn = plugin.registry.disconnectControllerFromTarget('mac-mini-server-test', 'phone-123');
    assert.equal(disconn, true);
    assert.equal(plugin.registry.listTargets('test@example.com')[0].connectedCount, 0);

    // 5. Send command
    const cmd = plugin.registry.sendCommand('mac-mini-server-test', 'seek', { timeMs: 30000 });
    assert.equal(cmd.ok, true);
    assert.ok(cmd.commandId);

    // 6. Delete target
    const del = plugin.registry.removeTarget('mac-mini-server-test');
    assert.equal(del, true);
    assert.equal(plugin.registry.listTargets().length, 0);
});

test('multi-login HTTP & SSE isolation: users cannot see or control other logins targets', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.login = { email: String(req.headers['x-test-user'] || 'alice@example.com').toLowerCase(), isAdmin: false };
        req.profile = { id: 1, name: 'Main' };
        next();
    });

    const plugin = register({
        app,
        auth: { requireLogin: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(), requireProfile: (_req, _res, next) => next() },
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });

    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const aliceHeaders = { 'content-type': 'application/json', 'x-test-user': 'alice@example.com' };
        const bobHeaders = { 'content-type': 'application/json', 'x-test-user': 'bob@example.com' };

        // Alice registers target and updates nowPlaying with sensitive streamUrl
        const reg = await fetch(`${base}/api/remote/target/register`, {
            method: 'POST', headers: aliceHeaders,
            body: JSON.stringify({ targetId: 'alice-tv-1', name: 'Alice TV', isDesktop: true }),
        });
        assert.equal(reg.status, 200);
        const st = await fetch(`${base}/api/remote/target/state`, {
            method: 'POST', headers: aliceHeaders,
            body: JSON.stringify({ targetId: 'alice-tv-1', state: 'playing', nowPlaying: { title: 'Secret', streamUrl: 'https://secret.local/video.mp4?sig=xyz' } }),
        });
        assert.equal(st.status, 200);

        // Bob's /api/remote/targets and /api/remote/events SSE must NOT see Alice's target or streamUrl
        const bobList = await (await fetch(`${base}/api/remote/targets`, { headers: bobHeaders })).json();
        assert.deepEqual(bobList.targets, []);

        const bobEventsChunk = await new Promise((resolve, reject) => {
            const req = http.get(`${base}/api/remote/events`, { headers: { 'x-test-user': 'bob@example.com' } }, (res) => {
                let buf = '';
                res.on('data', (d) => {
                    buf += d;
                    if (buf.includes('event: targets')) {
                        req.destroy();
                        resolve(buf);
                    }
                });
            });
            req.on('error', reject);
        });
        assert.ok(bobEventsChunk.includes('"targets":[]'));
        assert.equal(bobEventsChunk.includes('alice-tv-1'), false);
        assert.equal(bobEventsChunk.includes('secret.local'), false);

        // Bob cannot register over, update, listen to, command, connect, disconnect, or delete Alice's target
        assert.equal((await fetch(`${base}/api/remote/target/register`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ targetId: 'alice-tv-1', name: 'Hijacked' }) })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/target/state`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ targetId: 'alice-tv-1', state: 'paused' }) })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/target/events?targetId=alice-tv-1`, { headers: bobHeaders })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/targets/alice-tv-1/command`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ action: 'navigate', payload: { path: '/evil' } }) })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/targets/alice-tv-1/connect`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ controllerId: 'bob-phone' }) })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/targets/alice-tv-1/disconnect`, { method: 'POST', headers: bobHeaders, body: JSON.stringify({ controllerId: 'bob-phone' }) })).status, 403);
        assert.equal((await fetch(`${base}/api/remote/targets/alice-tv-1`, { method: 'DELETE', headers: bobHeaders })).status, 403);
    } finally {
        plugin.registry.close();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
    }
});

test('remote multiplexes targets and commands onto core /api/events without cross-login leakage', async () => {
    const http = require('http');
    const express = require('express');
    const { createEventHub } = require('../../../server/events');
    const { createContextFactory } = require('../../../server/plugins/context');
    const { createHooks } = require('../../../server/plugins/hooks');
    const { register } = require('../server');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.login = { email: req.headers['x-test-user'] || 'alice@example.com', isAdmin: false };
        next();
    });
    const eventHub = createEventHub({ heartbeatMs: 60000, throttleMs: 0 });
    app.get('/api/events', eventHub.handler);
    const makeCtx = createContextFactory({
        app,
        auth: {
            requireLogin: (_req, _res, next) => next(),
            requireAdmin: (_req, _res, next) => next(),
            requireProfile: (_req, _res, next) => next(),
        },
        db: { raw: null, audit: () => undefined, migratePlugin: () => 0 },
        hooks: createHooks({ log: { warn: () => undefined } }),
        events: eventHub,
        services: {},
        dataPath: require('os').tmpdir(),
        settings: {},
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    const ctx = makeCtx({ id: 'remote', root: __dirname, manifest: { name: 'remote' } }, { disable: () => undefined, get: () => undefined });
    const plugin = register(ctx);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await fetch(`${base}/api/remote/target/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-test-user': 'alice@example.com' },
            body: JSON.stringify({ targetId: 'alice-tv', name: 'Alice TV' }),
        });
        const chunks = await new Promise((resolve, reject) => {
            const req = http.get(`${base}/api/events?targetId=alice-tv`, { headers: { 'x-test-user': 'alice@example.com' } }, async (res) => {
                let buf = '';
                res.on('data', (d) => {
                    buf += d;
                    if (buf.includes('event: command')) {
                        req.destroy();
                        resolve(buf);
                    }
                });
                await fetch(`${base}/api/remote/targets/alice-tv/command`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-test-user': 'alice@example.com' },
                    body: JSON.stringify({ action: 'pause' }),
                });
            });
            req.on('error', reject);
        });
        assert.ok(chunks.includes('event: targets'));
        assert.ok(chunks.includes('event: target_info'));
        assert.ok(chunks.includes('event: command'));
        assert.ok(chunks.includes('"action":"pause"'));

        // Bob subscribing to /api/events?targetId=alice-tv must NOT see Alice's target in targets list or command
        const bobBuf = await new Promise((resolve, reject) => {
            const req = http.get(`${base}/api/events?targetId=alice-tv`, { headers: { 'x-test-user': 'bob@example.com' } }, (res) => {
                let buf = '';
                res.on('data', (d) => {
                    buf += d;
                    if (buf.includes('event: targets')) {
                        req.destroy();
                        resolve(buf);
                    }
                });
            });
            req.on('error', reject);
        });
        assert.ok(bobBuf.includes('"targets":[]'));
        assert.equal(bobBuf.includes('Alice TV'), false);
        assert.equal(bobBuf.includes('target_info'), false);
    } finally {
        plugin.registry.close();
        eventHub.close();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
    }
});
