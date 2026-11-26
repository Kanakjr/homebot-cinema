// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect, beforeEach, afterEach, jest */

class FakeEventSource {
    constructor(url, opts) {
        this.url = url;
        this.opts = opts;
        this.readyState = 1;
        this.listeners = new Map();
        FakeEventSource.instances.push(this);
    }
    addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(fn);
    }
    emitServer(type, payload) {
        const set = this.listeners.get(type);
        if (!set) return;
        const ev = { data: JSON.stringify(payload) };
        for (const fn of set) fn(ev);
    }
    close() {
        this.readyState = 2;
        this.closed = true;
    }
}
FakeEventSource.instances = [];

class FakeBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        if (!FakeBroadcastChannel.channels.has(name)) FakeBroadcastChannel.channels.set(name, new Set());
        FakeBroadcastChannel.channels.get(name).add(this);
    }
    postMessage(msg) {
        for (const ch of FakeBroadcastChannel.channels.get(this.name) || []) {
            if (ch !== this && typeof ch.onmessage === 'function') {
                ch.onmessage({ data: msg });
            }
        }
    }
    close() {
        const set = FakeBroadcastChannel.channels.get(this.name);
        if (set) set.delete(this);
    }
}
FakeBroadcastChannel.channels = new Map();

describe('useServerEvents consolidated SSE client', () => {
    const origWindow = global.window;
    const origNavigator = global.navigator;

    beforeEach(() => {
        jest.resetModules();
        FakeEventSource.instances = [];
        FakeBroadcastChannel.channels.clear();
        const store = new Map();
        global.window = {
            EventSource: FakeEventSource,
            BroadcastChannel: FakeBroadcastChannel,
            localStorage: {
                getItem: (k) => (store.has(k) ? store.get(k) : null),
                setItem: (k, v) => store.set(k, String(v)),
                removeItem: (k) => store.delete(k),
            },
            addEventListener: () => undefined,
        };
        global.navigator = {};
    });

    afterEach(() => {
        global.window = origWindow;
        global.navigator = origNavigator;
    });

    it('opens a single multiplexed /api/events EventSource for multiple event types and targetId', async () => {
        const useServerEvents = require('../src/common/useServerEvents');
        useServerEvents._resetForTests();

        const seen = [];
        useServerEvents.setParam('targetId', 'mac-1');
        const u1 = useServerEvents.subscribe(['library'], (t, d) => seen.push([t, d]));
        const u2 = useServerEvents.subscribe(['targets', 'command'], (t, d) => seen.push([t, d]));

        await new Promise((r) => setTimeout(r, 10));

        expect(FakeEventSource.instances).toHaveLength(1);
        expect(FakeEventSource.instances[0].url).toBe('/api/events?targetId=mac-1');

        FakeEventSource.instances[0].emitServer('targets', { targets: [{ id: 'mac-1' }] });
        FakeEventSource.instances[0].emitServer('command', { action: 'pause' });
        FakeEventSource.instances[0].emitServer('library', { ok: true });

        expect(seen).toEqual([
            ['targets', { targets: [{ id: 'mac-1' }] }],
            ['command', { action: 'pause' }],
            ['library', { ok: true }],
        ]);

        u1();
        u2();
        useServerEvents._resetForTests();
    });

    it('reuses a single leader SSE socket when a second follower tab joins via BroadcastChannel', async () => {
        const useServerEvents = require('../src/common/useServerEvents');
        useServerEvents._resetForTests();

        const leaderEvents = [];
        useServerEvents.subscribe(['downloads'], (t, d) => leaderEvents.push([t, d]));
        await new Promise((r) => setTimeout(r, 10));
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(useServerEvents.isLeader()).toBe(true);

        // Simulate a second tab joining on the same origin: localStorage lease already held
        let secondModule = null;
        jest.isolateModules(() => {
            secondModule = require('../src/common/useServerEvents');
        });
        const followerEvents = [];
        const unsub2 = secondModule.subscribe(['downloads', 'targets'], (t, d) => followerEvents.push([t, d]));
        await new Promise((r) => setTimeout(r, 10));

        // Still only ONE EventSource open across both tabs
        expect(FakeEventSource.instances).toHaveLength(1);
        expect(secondModule.isLeader()).toBe(false);

        FakeEventSource.instances[0].emitServer('targets', { targets: [{ id: 'tv-2' }] });
        expect(followerEvents).toEqual([['targets', { targets: [{ id: 'tv-2' }] }]]);

        unsub2();
        secondModule._resetForTests();
        useServerEvents._resetForTests();
    });
});
