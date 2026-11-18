const prettyTitle = require('../src/routes/Downloads/prettyTitle');

describe('prettyTitle', () => {
    it('turns a release name into a title and episode tag', () => {
        expect(prettyTitle('The.Terminal.List.S02E01.2160p.AMZN.WEB-DL.DV.HDR10+')).toBe('The Terminal List · S2 E1');
    });
    it('turns a movie release name into title and year', () => {
        expect(prettyTitle('Heat.1995.1080p.BluRay.x265-GRP')).toBe('Heat (1995)');
    });
    it('keeps a real title as it is', () => {
        expect(prettyTitle('The Terminal List')).toBe('The Terminal List');
        expect(prettyTitle('Spider-Man: Homecoming')).toBe('Spider-Man: Homecoming');
    });
    it('copes with empty input', () => {
        expect(prettyTitle(undefined)).toBe('');
    });
});
