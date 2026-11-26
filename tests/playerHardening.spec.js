// Copyright (C) 2017-2026 HomeBot Cinema
/* global describe, it, expect */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Player shortcuts & HUD hardening guards', () => {
    it('ShortcutsModal uses React.forwardRef with semantic dialog role and accurate speed/delay keys', () => {
        const src = read('src/routes/Player/ShortcutsModal/ShortcutsModal.tsx');
        expect(src).toMatch(/React\.forwardRef/);
        expect(src).toMatch(/role="dialog"/);
        expect(src).toContain('[\'G\', \'H\']');
        expect(src).toContain('[\'<\', \'>\', \'[\', \']\', \',\', \'.\']');
        expect(src).toContain('±50ms');
    });

    it('Player.js removes the duplicate G/H handler and renders ShortcutsModal without menu-layer constraint', () => {
        const src = read('src/routes/Player/Player.js');
        expect(src).not.toMatch(/Subtitle Delay G \(-50ms\) and H \(\+50ms\)/);
        expect(src).not.toMatch(/<ShortcutsModal[\s\S]*?styles\['menu-layer'\]/);
        expect(src).toMatch(/<ShortcutsModal\s+className=\{styles\['layer'\]\}/);
    });

    it('useVideo.js assigns monotonic seq to hudNotice objects and Indicator.tsx reads object text', () => {
        const useVideoSrc = read('src/routes/Player/useVideo.js');
        const indicatorSrc = read('src/routes/Player/Indicator/Indicator.tsx');
        expect(useVideoSrc).toMatch(/hudNoticeSeq\.current \+= 1/);
        expect(useVideoSrc).toMatch(/hudNotice:\s*notice \? \{ text: String\(notice\), seq: hudNoticeSeq\.current \} : null/);
        expect(indicatorSrc).toContain('\'hudNotice\'');
        expect(indicatorSrc).toMatch(/property !== 'hudNotice'/);
    });

    it('App.js ignores "/" quick-search shortcut while inside #/player', () => {
        const appSrc = read('src/App/App.js');
        expect(appSrc).toContain('if (window.location.hash.startsWith(\'#/player\')) return;');
    });

    it('Error.js uses decodeStreamUrl and gates external player prompt on publicUrl', () => {
        const errSrc = read('src/routes/Player/Error/Error.js');
        expect(errSrc).toContain('decodeStreamUrl');
        expect(errSrc).toMatch(/publicUrl\s*\?\s*'Your browser couldn/);
    });
});
