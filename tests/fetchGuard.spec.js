// Copyright (C) 2017-2026 HomeBot Cinema
const { guardFetch, BLOCKED_HOSTS } = require('../src/worker/fetchGuard');

describe('core worker fetch guard', () => {
    const calls = [];
    const real = async (input) => { calls.push(typeof input === 'string' ? input : input.url); return 'real'; };
    const f = guardFetch(real);

    beforeEach(() => { calls.length = 0; });

    it('answers Stremio announcements locally with their "nothing to show" responses', async () => {
        const modal = await f('https://api.strem.io/api/getModal', { method: 'POST' });
        expect(await modal.json()).toEqual({ result: null });
        const notif = await f({ url: 'https://api.strem.io/api/getNotification' });
        expect(await notif.json()).toEqual({});
        expect(calls).toEqual([]);
    });

    it('fails every other call to Stremio API hosts like an offline network', async () => {
        for (const u of ['https://api.strem.io/api/seekLog', 'https://api.strem.io/api/datastoreGet', 'https://likes.stremio.com/api/get_status?authToken=x', 'https://link.stremio.com/api/create']) {
            await expect(f(u)).rejects.toThrow(/Blocked by HomeBot Cinema/);
        }
        expect(calls).toEqual([]);
        expect(BLOCKED_HOSTS).toContain('api.strem.io');
    });

    it('passes everything else through untouched (addons, own server, relative URLs, wasm)', async () => {
        for (const u of ['https://v3-cinemeta.strem.io/manifest.json', '/api/addons', 'http://localhost:3002/x', 'https://example.com/a.wasm']) {
            expect(await f(u)).toBe('real');
        }
        expect(calls.length).toBe(4);
    });
});
