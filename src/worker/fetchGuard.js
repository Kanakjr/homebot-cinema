// Copyright (C) 2017-2026 HomeBot Cinema
// Keeps stremio-core from calling Stremio's own API. Nobody here has a Stremio account, so these calls only leak that the app
// is running (IP, time zone) or fail. The core runs in a web worker and fetches through `self.fetch`, which this wraps.
//   - Announcements (getModal, getNotification) are answered locally with what Stremio returns when there is nothing to show.
//   - Every other call to these hosts (account sync, seek log, skip gaps, likes, link codes) fails like an offline network.
// Catalog and metadata addons (Cinemeta etc.) are not touched: they are addons the operator can replace (docs/third-party-services.md).

const BLOCKED_HOSTS = ['api.strem.io', 'likes.stremio.com', 'link.stremio.com'];
const LOCAL_ANSWERS = {
    '/api/getModal': '{"result":null}',
    '/api/getNotification': '{}',
};

const urlOf = (input) => (typeof input === 'string' ? input : (input && input.url) || String(input));

function guardFetch(realFetch, { base = 'http://localhost/', onBlock = null } = {}) {
    return function guardedFetch(input, init) {
        let url;
        try {
            url = new URL(urlOf(input), base);
        } catch (_) {
            return realFetch(input, init);
        }
        if (!BLOCKED_HOSTS.includes(url.hostname)) return realFetch(input, init);
        if (onBlock) onBlock(url);
        const body = LOCAL_ANSWERS[url.pathname];
        if (body !== undefined) {
            return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.reject(new TypeError(`Blocked by HomeBot Cinema: ${url.hostname}${url.pathname}`));
    };
}

module.exports = { guardFetch, BLOCKED_HOSTS, LOCAL_ANSWERS };
