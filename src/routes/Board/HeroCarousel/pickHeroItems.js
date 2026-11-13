// Copyright (C) 2017-2026 HomeBot Cinema
// Which titles go into the Home hero banner. Pure function so it can be unit tested (tests/heroPicker.spec.js).
//
// Rules:
//  - candidates are the top of the first few catalogs that have loaded (the addons decide what is "popular")
//  - only movies and series with an IMDb id (the backdrop and logo art are looked up by IMDb id)
//  - skip anything the profile has already watched, and anything already in "Continue watching"
//  - round-robin between the catalogs, so movies and series are mixed instead of one catalog filling the banner
//  - no catalog supplies more than its fair share, and no title appears twice

const LOOK_AT = 8; // only the top of each catalog is considered
const MAX_SLIDES = 8;

const usable = (item) => Boolean(item) && /^tt\d+/.test(item.id) && (item.type === 'movie' || item.type === 'series') && item.watched !== true;

const pickHeroItems = (catalogs, { exclude = new Set(), maxSlides = MAX_SLIDES } = {}) => {
    const lists = (catalogs || []).map((c) => (Array.isArray(c) ? c.slice(0, LOOK_AT) : [])).filter((l) => l.length > 0);
    if (lists.length === 0) return [];
    const cap = Math.max(2, Math.ceil(maxSlides / lists.length));
    const taken = lists.map(() => 0);
    const seen = new Set(exclude);
    const out = [];
    for (let rank = 0; rank < LOOK_AT && out.length < maxSlides; rank++) {
        lists.forEach((list, c) => {
            const item = list[rank];
            if (out.length >= maxSlides || taken[c] >= cap || !usable(item) || seen.has(item.id)) return;
            seen.add(item.id);
            taken[c] += 1;
            out.push(item);
        });
    }
    return out;
};

module.exports = { pickHeroItems, MAX_SLIDES };
