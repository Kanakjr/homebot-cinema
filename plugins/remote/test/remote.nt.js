'use strict';
// Plugin "remote": backend tests for screen registry, SSE command dispatch, and routes.
// Run with: pnpm test:server

const test = require('node:test');
const assert = require('node:assert/strict');
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
