// Copyright (C) 2017-2026 HomeBot Cinema
// UI plugin host: only active plugins contribute, slots are ordered, unknown slots throw, a failed /api/plugins means no plugins.

const host = require('../src/plugins/host');
const ai = require('../plugins/ai/ui');
const find = require('../plugins/find/ui');
const themes = require('../plugins/themes/ui');

const reg = { ai, find, themes, demo: { navButtons: [{ id: 'early', order: 1, Component: () => null }] } };

describe('plugin host', () => {
    it('collects a slot from the given plugins only, ordered by `order` then id', () => {
        expect(host.slot('navButtons', reg, ['ai', 'demo']).map((b) => `${b.pluginId}:${b.id}`)).toEqual(['demo:early', 'ai:copilot']);
        expect(host.slot('navButtons', reg, ['find'])).toEqual([]);
        expect(host.slot('routes', reg, ['find']).map((r) => r.path)).toEqual(['/find']);
        expect(host.slot('accents', reg, ['themes']).length).toBe(10);
        expect(host.slot('settingsSections', reg, ['themes']).map((s) => s.id)).toEqual(['appearance']);
    });

    it('rejects unknown slot names', () => {
        expect(() => host.slot('navbuttons', reg, [])).toThrow(/unknown plugin slot/);
    });

    it('every plugin UI only exports known slots', () => {
        for (const [id, mod] of Object.entries({ ai, find, themes })) {
            for (const key of Object.keys(mod)) expect([id, host.SLOTS.includes(key) ? key : `UNKNOWN:${key}`]).toEqual([id, key]);
        }
    });

    it('loadPlugins keeps active ids and runs onPluginsLoaded callbacks; a failing request means no plugins', async () => {
        const seen = [];
        host.onPluginsLoaded(() => seen.push('loaded'));
        const ids = await host.loadPlugins(async () => ({ ok: true, json: async () => ({ plugins: [{ id: 'ai', active: true }, { id: 'x', active: false }] }) }));
        expect(ids).toEqual(['ai']);
        expect(host.isActive('ai')).toBe(true);
        expect(seen).toEqual(['loaded']);
        const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await host.loadPlugins(async () => { throw new Error('offline'); })).toEqual([]);
        spy.mockRestore();
        let late = false;
        host.onPluginsLoaded(() => { late = true; });
        expect(late).toBe(true);
    });
});
