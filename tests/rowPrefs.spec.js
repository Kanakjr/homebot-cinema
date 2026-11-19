const { rowKey, applyRowPrefs, toggleHidden, move, emptyPrefs } = require('../src/routes/Board/rowPrefs');

const row = (base, id, type = 'movie', index = 0) => ({ index, catalog: { addon: { transportUrl: base }, id, type, deepLinks: { discover: `#/discover/${base}/${type}/${id}` } } });

describe('rowPrefs', () => {
    const rows = [row('a', 'top', 'movie', 0), row('a', 'top', 'movie', 1), row('b', 'new', 'series', 2), row('c', 'hot', 'movie', 3)];
    it('drops duplicate rows', () => {
        expect(applyRowPrefs(rows, emptyPrefs()).map((r) => r.index)).toEqual([0, 2, 3]);
    });
    it('hides rows by key and can show them again', () => {
        const prefs = toggleHidden(emptyPrefs(), rowKey(rows[2].catalog));
        expect(applyRowPrefs(rows, prefs).map((r) => r.index)).toEqual([0, 3]);
        expect(applyRowPrefs(rows, prefs, { includeHidden: true }).map((r) => r.index)).toEqual([0, 2, 3]);
        expect(toggleHidden(prefs, rowKey(rows[2].catalog)).hidden).toEqual([]);
    });
    it('reorders; unknown rows keep their place after the ordered ones', () => {
        const keys = applyRowPrefs(rows, emptyPrefs()).map((r) => rowKey(r.catalog));
        const prefs = move(emptyPrefs(), keys, keys[2], -1);
        expect(applyRowPrefs(rows, prefs).map((r) => r.index)).toEqual([0, 3, 2]);
    });
    it('ignores a move past the ends', () => {
        const prefs = emptyPrefs();
        expect(move(prefs, ['x', 'y'], 'x', -1)).toBe(prefs);
    });
});
