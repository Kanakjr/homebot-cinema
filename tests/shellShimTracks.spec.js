// Runs the desktop shell shim in a sandbox and checks the audio/subtitle labels it builds from mpv's track list.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const loadShim = () => {
    const received = [];
    const window = { chrome: undefined, addEventListener: () => {}, getSelection: () => ({ toString: () => '' }) };
    window.document = { documentElement: { dataset: {} }, addEventListener: () => {} };
    const sandbox = { window, document: window.document, console };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../desktop/src-tauri/src/shell_shim.js'), 'utf8'), sandbox);
    window.chrome.webview.addEventListener('message', (e) => received.push(JSON.parse(e.data)));
    return {
        labels: (tracks) => {
            window.__shellDispatch(JSON.stringify({ type: 1, args: ['mpv-prop-change', { name: 'track-list', data: tracks }] }));
            return received[received.length - 1].args[1].data;
        },
    };
};

describe('desktop shim track labels', () => {
    const { labels } = loadShim();

    it('labels audio with codec and channels', () => {
        const [a, b] = labels([
            { type: 'audio', lang: 'eng', codec: 'eac3', 'demux-channel-count': 6 },
            { type: 'audio', lang: 'eng', codec: 'aac', 'demux-channel-count': 2 },
        ]);
        expect(a.title).toBe('E-AC3 5.1');
        expect(b.title).toBe('AAC Stereo');
    });
    it('drops the speaker-position suffix from the channel layout', () => {
        const [a] = labels([{ type: 'audio', lang: 'eng', codec: 'eac3', 'demux-channels': '5.1(side)', 'demux-channel-count': 6 }]);
        expect(a.title).toBe('E-AC3 5.1');
    });
    it('keeps the file title and adds what it lacks', () => {
        const [a] = labels([{ type: 'audio', lang: 'eng', codec: 'eac3', title: 'English Atmos', 'demux-channel-count': 6 }]);
        expect(a.title).toBe('English Atmos · E-AC3 5.1');
    });
    it('marks SDH and forced subtitles', () => {
        const [sdh, forced, plain] = labels([
            { type: 'sub', lang: 'eng', 'hearing-impaired': true },
            { type: 'sub', lang: 'eng', forced: true },
            { type: 'sub', lang: 'eng' },
        ]);
        expect(sdh.title).toBe('SDH');
        expect(forced.title).toBe('Forced');
        expect(plain.title).toBe('Embedded');
    });
    it('leaves the label empty when nothing is known, never "Track N"', () => {
        const tracks = labels([{ type: 'video' }, { type: 'audio', lang: 'eng' }, { type: 'sub' }]);
        expect(tracks[1].title).toBe('');
        expect(tracks[2].title).toBe('');
    });
});
