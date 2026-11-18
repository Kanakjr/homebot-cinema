const topResults = require('../src/routes/Search/topResults');

const ready = (items) => ({ content: { type: 'Ready', content: items } });
const item = (id, name, extra = {}) => ({ id, name, type: 'movie', poster: `https://img/${id}.jpg`, ...extra });

describe('topResults', () => {
    it('puts the exact title first, then prefix matches', () => {
        const out = topResults([ready([item('a', 'Dune: Part Two'), item('b', 'Dune'), item('c', 'Sand Dune Wars')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    });
    it('keeps one card per title across catalogs', () => {
        const out = topResults([ready([item('a', 'Dune')]), ready([item('a', 'Dune'), item('b', 'Dune')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['a', 'b']);
    });
    it('drops items without a poster and items that do not match', () => {
        const out = topResults([ready([item('a', 'Dune', { poster: null }), item('b', 'Heat'), item('c', 'Dune')])], 'dune');
        expect(out.map((i) => i.id)).toEqual(['c']);
    });
    it('adds year and type', () => {
        const [first] = topResults([ready([item('a', 'Dune', { releaseInfo: '2021' })])], 'dune');
        expect(first.subtitle).toBe('2021 · Movie');
    });
    it('ignores catalogs that are not ready', () => {
        expect(topResults([{ content: { type: 'Loading' } }, { content: { type: 'Err', content: 'EmptyContent' } }], 'dune')).toEqual([]);
    });
});
