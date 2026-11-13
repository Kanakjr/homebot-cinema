// Copyright (C) 2017-2026 HomeBot Cinema
// Draws the preset profile avatars (original artwork, licensed like the rest of this repo) and writes server/avatars/<key>.png.
//
//   NODE_PATH=<folder with puppeteer-core> node scripts/brand/make-avatars.js
//
// One-off tool like build.js (puppeteer-core is not an app dependency; set CHROME_PATH if Chrome is not at the macOS default).
// The generated PNGs are committed; rerun only when the designs change.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'server', 'avatars');

const eye = (x, y, r = 11, c = '#1b1b2f') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x + r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.32}" fill="#fff"/>`;
const bg = (a, b) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="256" height="256" fill="url(#bg)"/>`;

const AVATARS = {
    fox: () => bg('#ffb36b', '#ff6b4a') +
        `<polygon points="52,40 104,92 48,132" fill="#c7501f"/><polygon points="204,40 152,92 208,132" fill="#c7501f"/>` +
        `<path d="M 40 120 Q 128 56 216 120 Q 214 196 128 226 Q 42 196 40 120 Z" fill="#f28a3c"/>` +
        `<path d="M 128 226 Q 70 204 52 150 Q 100 150 128 176 Q 156 150 204 150 Q 186 204 128 226 Z" fill="#fff4e6"/>` +
        eye(98, 130) + eye(158, 130) + `<ellipse cx="128" cy="176" rx="14" ry="10" fill="#2a1a1a"/>`,
    owl: () => bg('#8fd3ff', '#5a78ff') +
        `<polygon points="60,60 96,86 60,104" fill="#6b4a32"/><polygon points="196,60 160,86 196,104" fill="#6b4a32"/>` +
        `<ellipse cx="128" cy="140" rx="82" ry="90" fill="#8b6a48"/><ellipse cx="128" cy="176" rx="46" ry="52" fill="#e9d3b0"/>` +
        `<circle cx="94" cy="118" r="30" fill="#fff"/><circle cx="162" cy="118" r="30" fill="#fff"/>` +
        `<circle cx="94" cy="118" r="15" fill="#f5b400"/><circle cx="162" cy="118" r="15" fill="#f5b400"/><circle cx="94" cy="118" r="7" fill="#1b1b2f"/><circle cx="162" cy="118" r="7" fill="#1b1b2f"/>` +
        `<polygon points="116,140 140,140 128,162" fill="#f08a1c"/>`,
    panda: () => bg('#b8f2c9', '#4cc9a0') +
        `<circle cx="66" cy="66" r="32" fill="#22222c"/><circle cx="190" cy="66" r="32" fill="#22222c"/>` +
        `<ellipse cx="128" cy="140" rx="92" ry="84" fill="#fafafa"/>` +
        `<ellipse cx="92" cy="130" rx="22" ry="28" fill="#22222c" transform="rotate(20 92 130)"/><ellipse cx="164" cy="130" rx="22" ry="28" fill="#22222c" transform="rotate(-20 164 130)"/>` +
        `<circle cx="94" cy="128" r="8" fill="#fff"/><circle cx="162" cy="128" r="8" fill="#fff"/><circle cx="96" cy="130" r="4" fill="#22222c"/><circle cx="160" cy="130" r="4" fill="#22222c"/>` +
        `<ellipse cx="128" cy="168" rx="14" ry="10" fill="#22222c"/><path d="M 112 186 Q 128 200 144 186" stroke="#22222c" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    robot: () => bg('#7ee8fa', '#4a6cf7') +
        `<rect x="124" y="30" width="8" height="34" fill="#c3cbe0"/><circle cx="128" cy="30" r="12" fill="#ff5d73"/>` +
        `<rect x="48" y="64" width="160" height="140" rx="30" fill="#e8edf8"/><rect x="64" y="90" width="128" height="62" rx="22" fill="#1d2340"/>` +
        `<circle cx="100" cy="121" r="13" fill="#7ee8fa"/><circle cx="156" cy="121" r="13" fill="#7ee8fa"/>` +
        `<rect x="96" y="170" width="64" height="12" rx="6" fill="#9aa6c8"/><rect x="34" y="104" width="14" height="40" rx="6" fill="#c3cbe0"/><rect x="208" y="104" width="14" height="40" rx="6" fill="#c3cbe0"/>`,
    cat: () => bg('#ffd1e8', '#ff8fb8') +
        `<polygon points="54,50 108,92 52,138" fill="#7b7f93"/><polygon points="202,50 148,92 204,138" fill="#7b7f93"/><polygon points="66,72 94,94 66,116" fill="#f7a7c0"/><polygon points="190,72 162,94 190,116" fill="#f7a7c0"/>` +
        `<ellipse cx="128" cy="148" rx="88" ry="76" fill="#9ca0b5"/>` +
        `<ellipse cx="96" cy="136" rx="13" ry="15" fill="#fff"/><ellipse cx="160" cy="136" rx="13" ry="15" fill="#fff"/><ellipse cx="96" cy="138" rx="5" ry="12" fill="#1b1b2f"/><ellipse cx="160" cy="138" rx="5" ry="12" fill="#1b1b2f"/>` +
        `<polygon points="120,164 136,164 128,175" fill="#f26b8a"/><path d="M 128 175 Q 118 190 106 184 M 128 175 Q 138 190 150 184" stroke="#4a4d60" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        `<path d="M 60 160 L 20 150 M 60 172 L 20 178 M 196 160 L 236 150 M 196 172 L 236 178" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
    bear: () => bg('#ffe29a', '#ff9a5a') +
        `<circle cx="62" cy="62" r="30" fill="#8a5a3a"/><circle cx="194" cy="62" r="30" fill="#8a5a3a"/><circle cx="62" cy="62" r="14" fill="#c99a76"/><circle cx="194" cy="62" r="14" fill="#c99a76"/>` +
        `<ellipse cx="128" cy="144" rx="92" ry="86" fill="#a96f48"/><ellipse cx="128" cy="170" rx="42" ry="34" fill="#e6c3a0"/>` +
        eye(94, 128, 10) + eye(162, 128, 10) + `<ellipse cx="128" cy="158" rx="14" ry="10" fill="#2a1a1a"/><path d="M 114 178 Q 128 190 142 178" stroke="#2a1a1a" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    astronaut: () => bg('#3b2f8f', '#10092e') +
        Array.from({ length: 24 }, (_, i) => `<circle cx="${(i * 97) % 256}" cy="${(i * 53) % 256}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity="0.7"/>`).join('') +
        `<circle cx="128" cy="132" r="88" fill="#f1f3fa"/><rect x="62" y="84" width="132" height="94" rx="44" fill="#1b2150"/>` +
        `<ellipse cx="102" cy="112" rx="22" ry="12" fill="#6f86ff" opacity="0.55" transform="rotate(-24 102 112)"/><circle cx="160" cy="150" r="5" fill="#ffd166"/>` +
        `<rect x="40" y="120" width="18" height="38" rx="9" fill="#c9cfe3"/><rect x="198" y="120" width="18" height="38" rx="9" fill="#c9cfe3"/>`,
    rabbit: () => bg('#d4c2ff', '#8a6bff') +
        `<ellipse cx="94" cy="62" rx="20" ry="58" fill="#f6f3fb"/><ellipse cx="162" cy="62" rx="20" ry="58" fill="#f6f3fb"/><ellipse cx="94" cy="66" rx="9" ry="40" fill="#f5a3bf"/><ellipse cx="162" cy="66" rx="9" ry="40" fill="#f5a3bf"/>` +
        `<ellipse cx="128" cy="158" rx="78" ry="70" fill="#f6f3fb"/>` + eye(100, 148, 9) + eye(156, 148, 9) +
        `<ellipse cx="128" cy="174" rx="10" ry="7" fill="#f26b8a"/><path d="M 116 186 Q 128 196 140 186" stroke="#8a6bff" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    frog: () => bg('#d8f78a', '#58c46a') +
        `<ellipse cx="128" cy="156" rx="94" ry="70" fill="#4aa85a"/><circle cx="82" cy="98" r="34" fill="#4aa85a"/><circle cx="174" cy="98" r="34" fill="#4aa85a"/>` +
        `<circle cx="82" cy="98" r="22" fill="#fff"/><circle cx="174" cy="98" r="22" fill="#fff"/><circle cx="86" cy="100" r="11" fill="#1b1b2f"/><circle cx="170" cy="100" r="11" fill="#1b1b2f"/>` +
        `<path d="M 66 168 Q 128 218 190 168" stroke="#1f5a2c" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="116" cy="140" r="4" fill="#1f5a2c"/><circle cx="140" cy="140" r="4" fill="#1f5a2c"/>`,
    penguin: () => bg('#aee6ff', '#4aa8ff') +
        `<ellipse cx="128" cy="146" rx="80" ry="92" fill="#232a3f"/><ellipse cx="128" cy="168" rx="52" ry="68" fill="#f4f6fb"/>` +
        `<circle cx="102" cy="108" r="18" fill="#fff"/><circle cx="154" cy="108" r="18" fill="#fff"/><circle cx="104" cy="110" r="8" fill="#1b1b2f"/><circle cx="152" cy="110" r="8" fill="#1b1b2f"/>` +
        `<polygon points="112,128 144,128 128,148" fill="#ffa62b"/>`,
    octopus: () => bg('#ffc2d9', '#c264ff') +
        `<path d="M 40 150 Q 40 52 128 52 Q 216 52 216 150 Q 216 168 204 178 Q 214 214 190 222 Q 176 226 172 206 Q 164 230 142 222 Q 128 216 128 200 Q 128 216 114 222 Q 92 230 84 206 Q 80 226 66 222 Q 42 214 52 178 Q 40 168 40 150 Z" fill="#a24ae0"/>` +
        `<circle cx="96" cy="122" r="20" fill="#fff"/><circle cx="160" cy="122" r="20" fill="#fff"/><circle cx="98" cy="126" r="9" fill="#1b1b2f"/><circle cx="158" cy="126" r="9" fill="#1b1b2f"/><path d="M 108 166 Q 128 182 148 166" stroke="#5a1d85" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    ghost: () => bg('#2a2a5c', '#6a4fd8') +
        `<path d="M 54 214 L 54 120 Q 54 46 128 46 Q 202 46 202 120 L 202 214 L 178 196 L 153 214 L 128 196 L 103 214 L 78 196 Z" fill="#f4f1ff"/>` +
        `<ellipse cx="104" cy="118" rx="12" ry="18" fill="#2a2a5c"/><ellipse cx="152" cy="118" rx="12" ry="18" fill="#2a2a5c"/><ellipse cx="128" cy="156" rx="12" ry="15" fill="#2a2a5c"/>` +
        `<circle cx="84" cy="144" r="9" fill="#ffb3d1" opacity="0.7"/><circle cx="172" cy="144" r="9" fill="#ffb3d1" opacity="0.7"/>`,
    dino: () => bg('#fff0a0', '#ffb347') +
        `<polygon points="70,60 90,28 108,64" fill="#2f8f5a"/><polygon points="108,52 128,20 148,56" fill="#2f8f5a"/><polygon points="148,60 168,28 186,64" fill="#2f8f5a"/>` +
        `<path d="M 52 150 Q 52 66 128 66 Q 204 66 204 150 Q 204 214 128 214 Q 52 214 52 150 Z" fill="#43b872"/><ellipse cx="128" cy="178" rx="60" ry="34" fill="#a8e6bf"/>` +
        eye(98, 122) + eye(158, 122) + `<circle cx="112" cy="178" r="5" fill="#2f8f5a"/><circle cx="144" cy="178" r="5" fill="#2f8f5a"/><path d="M 106 196 Q 128 208 150 196" stroke="#2f8f5a" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    rocket: () => bg('#0d1b4d', '#5a3ad8') +
        Array.from({ length: 18 }, (_, i) => `<circle cx="${(i * 83) % 256}" cy="${(i * 61) % 256}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity="0.75"/>`).join('') +
        `<g transform="rotate(35 128 128)"><path d="M 128 28 Q 176 78 168 156 L 88 156 Q 80 78 128 28 Z" fill="#f4f6fb"/><circle cx="128" cy="98" r="20" fill="#4ac8ff" stroke="#1d2a6b" stroke-width="6"/>` +
        `<polygon points="88,124 58,176 92,164" fill="#ff5d73"/><polygon points="168,124 198,176 164,164" fill="#ff5d73"/><path d="M 108 156 L 148 156 L 128 214 Z" fill="#ffb300"/><path d="M 118 156 L 138 156 L 128 192 Z" fill="#fff3b0"/></g>`,
    cactus: () => bg('#ffe6b0', '#ff9f6b') +
        `<rect x="104" y="60" width="48" height="150" rx="24" fill="#3ba36b"/><path d="M 104 130 L 80 130 Q 66 130 66 116 L 66 96 Q 66 86 76 86 Q 86 86 86 96 L 86 112 L 104 112 Z" fill="#3ba36b"/><path d="M 152 150 L 176 150 Q 190 150 190 136 L 190 112 Q 190 102 180 102 Q 170 102 170 112 L 170 132 L 152 132 Z" fill="#3ba36b"/>` +
        `<rect x="76" y="196" width="104" height="40" rx="10" fill="#c1673b"/>` + eye(118, 112, 7) + eye(138, 112, 7) + `<path d="M 120 134 Q 128 142 136 134" stroke="#1f5a2c" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        `<circle cx="128" cy="62" r="9" fill="#ff6b9a"/>`,
    moon: () => bg('#1c2255', '#3d4ab5') +
        Array.from({ length: 20 }, (_, i) => `<circle cx="${(i * 71) % 256}" cy="${(i * 47) % 256}" r="${1 + (i % 3) * 0.6}" fill="#fff" opacity="0.8"/>`).join('') +
        `<path d="M 170 40 A 92 92 0 1 0 170 216 A 74 74 0 1 1 170 40 Z" fill="#ffe08a"/>` +
        `<circle cx="104" cy="122" r="7" fill="#c99a2a"/><path d="M 80 150 Q 98 164 116 150" stroke="#c99a2a" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="84" cy="102" r="3" fill="#c99a2a"/>`,
};

const KEYS = Object.keys(AVATARS);
module.exports = { KEYS };

if (require.main === module) {
    const puppeteer = require('puppeteer-core');
    const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    (async () => {
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars_chrome_'));
        const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', userDataDir, args: ['--no-first-run'] });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
            for (const key of KEYS) {
                await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${AVATARS[key]()}</svg></body>`);
                await page.screenshot({ path: path.join(OUT, `${key}.png`), clip: { x: 0, y: 0, width: 256, height: 256 } });
                console.log('wrote', key);
            }
        } finally {
            await browser.close();
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }
    })().catch((e) => { console.error(e); process.exit(1); });
}
