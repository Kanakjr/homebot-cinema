// Copyright (C) 2017-2026 HomeBot Cinema
// English ships in the main bundle; other interface languages (~6 MB together) are fetched only when chosen.

const i18n = require('i18next');

const LANG_RE = /^[a-z]{2,3}-[A-Z]{2,3}$/;

async function ensureLanguage(lang) {
    if (typeof lang !== 'string' || !LANG_RE.test(lang) || i18n.hasResourceBundle(lang, 'translation')) return;
    try {
        const mod = await import(
            /* webpackChunkName: "lang-[request]" */
            /* webpackInclude: /[a-z]{2,3}-[A-Z]{2,3}\.json$/ */
            /* webpackExclude: /android/ */
            `stremio-translations/${lang}.json`
        );
        i18n.addResourceBundle(lang, 'translation', mod.default || mod, true, true);
    } catch (_) {
        // unknown or unreachable language file: English (fallback) stays in use
    }
}

async function setLanguage(lang) {
    await ensureLanguage(lang);
    return i18n.changeLanguage(lang);
}

module.exports = { ensureLanguage, setLanguage };
