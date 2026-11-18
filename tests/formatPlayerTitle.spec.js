const formatPlayerTitle = require('../src/routes/Player/formatPlayerTitle');

describe('formatPlayerTitle', () => {
    it('formats "Show - Episode (SxE)"', () => {
        expect(formatPlayerTitle('The Terminal List - Romulus S.V. (2×1)')).toBe('The Terminal List · S2 E1 · Romulus S.V.');
        expect(formatPlayerTitle('Show - Pilot (1x10)')).toBe('Show · S1 E10 · Pilot');
    });
    it('formats a title with no episode name', () => {
        expect(formatPlayerTitle('Show (3×4)')).toBe('Show · S3 E4');
    });
    it('keeps a hyphen inside the show name', () => {
        expect(formatPlayerTitle('Spider-Man - Origins (1×2)')).toBe('Spider-Man · S1 E2 · Origins');
    });
    it('falls back to series info and the episode list', () => {
        const meta = { name: 'Breaking Bad', videos: [{ season: 2, episode: 2, title: 'Grilled' }] };
        expect(formatPlayerTitle('Breaking Bad', { season: 2, episode: 2 }, meta)).toBe('Breaking Bad · S2 E2 · Grilled');
        expect(formatPlayerTitle('Breaking Bad', { season: 2, episode: 3 }, meta)).toBe('Breaking Bad · S2 E3');
    });
    it('leaves movies and empty titles alone', () => {
        expect(formatPlayerTitle('Heat')).toBe('Heat');
        expect(formatPlayerTitle(null)).toBe('');
    });
});
