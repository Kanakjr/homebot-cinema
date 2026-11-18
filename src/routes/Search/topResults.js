// Copyright (C) 2017-2026 HomeBot Cinema
// "Top results": the best matches across every addon catalog, best first, one card per title, with year and type.

const TYPE_LABEL = { movie: 'Movie', series: 'Series', channel: 'Channel', tv: 'TV' };

const normalize = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// 3 = exact title, 2 = starts with the query, 1 = every word of the query appears, 0 = anything else
const score = (name, query) => {
    const n = normalize(name);
    const q = normalize(query);
    if (!q) return 0;
    if (n === q) return 3;
    if (n.startsWith(q)) return 2;
    const words = q.split(' ');
    return words.every((word) => n.includes(word)) ? 1 : 0;
};

const subtitleOf = (item) => {
    const year = item.releaseInfo || (item.released ? String(item.released).slice(0, 4) : '');
    return [year, TYPE_LABEL[item.type] || ''].filter(Boolean).join(' · ');
};

/**
 * @param catalogs  search.catalogs (each `{ content: { type: 'Ready', content: [metaItem] } }`)
 * @param query     the search text
 * @param limit     how many cards
 */
const topResults = (catalogs, query, limit = 12) => {
    const seen = new Set();
    const ranked = [];
    let order = 0;
    (Array.isArray(catalogs) ? catalogs : []).forEach((catalog) => {
        if (catalog?.content?.type !== 'Ready' || !Array.isArray(catalog.content.content)) return;
        catalog.content.content.forEach((item) => {
            // items without art would show as grey boxes: leave them to the catalog rows
            if (!item || !item.name || !item.poster || !item.id || seen.has(item.id)) return;
            seen.add(item.id);
            ranked.push({ item, score: score(item.name, query), order: order++ });
        });
    });
    return ranked
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, limit)
        .map(({ item }) => ({ ...item, subtitle: subtitleOf(item) }));
};

module.exports = topResults;
module.exports.score = score;
