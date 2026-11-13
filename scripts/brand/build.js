// Copyright (C) 2017-2026 HomeBot Cinema
// Builds every brand asset from one design: a house with a play button cut out of it, in the app's orange-to-gold glow.
//
//   NODE_PATH=<folder with puppeteer-core> node scripts/brand/build.js
//
// One-off tool (puppeteer-core is NOT a dependency of the app; any Chrome works, set CHROME_PATH if it is not the macOS default).
// Writes: assets/brand/*.svg, assets/favicons/*, assets/images/{icon,logo,stremio_symbol,*_icon_*,apple-touch-icon}.png and
// assets/images/splash/*.jpg (the file names keep their sizes). Commit the results; rerun only when the design changes.

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const A = (...p) => path.join(ROOT, 'assets', ...p);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ---- the design (512 x 512 canvas) ----------------------------------------------------------------------------------
const HOUSE = 'M256 86 L420 230 V414 H92 V230 Z';          // roof peak, walls
const PLAY = 'M232 268 L232 360 L318 314 Z';                // the play button knocked out of the house
const GOLD = '#FFD25A';
const ORANGE = '#F27A24';

const defs = (extra = '') => `
    <defs>
        <linearGradient id="hb-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GOLD}"/><stop offset="1" stop-color="${ORANGE}"/></linearGradient>
        <mask id="hb-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
            <rect width="512" height="512" fill="#fff"/>
            <path d="${PLAY}" fill="#000" stroke="#000" stroke-width="22" stroke-linejoin="round"/>
        </mask>${extra}
    </defs>`;
const tileDefs = `
        <linearGradient id="hb-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a202b"/><stop offset="1" stop-color="#0a0d12"/></linearGradient>
        <radialGradient id="hb-halo" cx="0.5" cy="0.62" r="0.5"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.28"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/></radialGradient>`;
const house = (fill) => `<path d="${HOUSE}" fill="${fill}" stroke="${fill}" stroke-width="30" stroke-linejoin="round" mask="url(#hb-cut)"/>`;
const scaled = (s, inner) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${inner}</g>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">\n    <title>HomeBot Cinema</title>${body}\n</svg>\n`;

const SVGS = {
    // the bare mark, transparent: in-app logo, nav bar, splash
    glyph: svg(`${defs()}\n    ${house('url(#hb-glow)')}`),
    // rounded app tile: favicon, PNG icons ("any" purpose)
    icon: svg(`${defs(tileDefs)}
    <rect x="8" y="8" width="496" height="496" rx="116" fill="url(#hb-tile)"/>
    <rect x="8" y="8" width="496" height="496" rx="116" fill="url(#hb-halo)"/>
    <rect x="11" y="11" width="490" height="490" rx="113" stroke="#fff" stroke-opacity="0.09" stroke-width="6"/>
    ${house('url(#hb-glow)')}`),
    // full-bleed square with the mark inside the safe zone: Android maskable icons
    maskable: svg(`${defs(tileDefs)}
    <rect width="512" height="512" fill="url(#hb-tile)"/>
    <rect width="512" height="512" fill="url(#hb-halo)"/>
    ${scaled(0.7, house('url(#hb-glow)'))}`),
    // slightly larger mark for iOS (it only rounds the corners itself)
    apple: svg(`${defs(tileDefs)}
    <rect width="512" height="512" fill="url(#hb-tile)"/>
    <rect width="512" height="512" fill="url(#hb-halo)"/>
    ${scaled(0.78, house('url(#hb-glow)'))}`),
    // one colour, for monochrome / themed icons
    mono: svg(`${defs()}\n    ${scaled(0.7, house('#fff'))}`),
};

// ---- helpers -----------------------------------------------------------------------------------------------------
const dataUri = (text, type) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;

function ico(entries) { // entries: [{ size, png }] (PNG payloads, supported by every browser)
    const head = Buffer.alloc(6);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(entries.length, 4);
    let offset = 6 + entries.length * 16;
    const dirs = entries.map(({ size, png }) => {
        const d = Buffer.alloc(16);
        d.writeUInt8(size >= 256 ? 0 : size, 0);
        d.writeUInt8(size >= 256 ? 0 : size, 1);
        d.writeUInt16LE(1, 4);
        d.writeUInt16LE(32, 6);
        d.writeUInt32LE(png.length, 8);
        d.writeUInt32LE(offset, 12);
        offset += png.length;
        return d;
    });
    return Buffer.concat([head, ...dirs, ...entries.map((e) => e.png)]);
}

const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    console.log('wrote', path.relative(ROOT, file), `(${data.length} bytes)`);
};

async function main() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-brand-'));
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile, args: ['--no-first-run', '--hide-scrollbars'] });
    try {
        const page = await browser.newPage();
        const png = async (svgText, size) => {
            await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
            await page.setContent(`<body style="margin:0;background:transparent"><img src="${dataUri(svgText, 'image/svg+xml')}" width="${size}" height="${size}" style="display:block"></body>`);
            await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
            return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        };

        // sources, kept next to the generated files
        Object.entries({ glyph: 'glyph', icon: 'icon', maskable: 'maskable', mono: 'mono' }).forEach(([k, name]) => write(A('brand', `${name}.svg`), SVGS[k]));

        // favicons
        write(A('favicons', 'favicon.svg'), SVGS.icon);
        write(A('favicons', 'favicon.ico'), ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await png(SVGS.icon, size) })))));
        write(A('favicons', 'icon_256x256.ico'), ico([{ size: 256, png: await png(SVGS.icon, 256) }]));

        // PWA / home screen icons
        write(A('images', 'icon_512x512.png'), await png(SVGS.icon, 512));
        write(A('images', 'icon_196x196.png'), await png(SVGS.icon, 196));
        write(A('images', 'maskable_icon_512x512.png'), await png(SVGS.maskable, 512));
        write(A('images', 'maskable_icon_196x196.png'), await png(SVGS.maskable, 196));
        write(A('images', 'maskable_icon.png'), await png(SVGS.maskable, 192));
        write(A('images', 'monochrome_icon_512x512.png'), await png(SVGS.mono, 512));
        write(A('images', 'apple-touch-icon.png'), await png(SVGS.apple, 180));

        // the logo used inside the app (intro, update screen, player buffering)
        const logo = await png(SVGS.glyph, 256);
        ['logo.png', 'icon.png', 'stremio_symbol.png'].forEach((name) => write(A('images', name), logo));

        // iOS launch screens: dark glow, the mark and the name (sizes come from the file names)
        const font = fs.readFileSync(A('fonts', 'PlusJakartaSans.ttf')).toString('base64');
        const glyphUri = dataUri(SVGS.glyph, 'image/svg+xml');
        const splashDir = A('images', 'splash');
        for (const file of fs.readdirSync(splashDir).filter((f) => /^apple-splash-\d+-\d+\.jpg$/.test(f)).sort()) {
            const [, w, h] = /apple-splash-(\d+)-(\d+)\.jpg/.exec(file).map(Number);
            const mark = Math.round(Math.min(w, h) * 0.22);
            await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
            await page.setContent(`<html><head><style>
                @font-face { font-family: 'PJS'; src: url(data:font/ttf;base64,${font}); font-weight: 200 800; }
                html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
                body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${Math.round(mark * 0.12)}px;
                       background: radial-gradient(ellipse 70% 45% at 50% 52%, rgba(242,122,36,0.22), rgba(242,122,36,0) 70%), #07090d; }
                img { width: ${mark}px; height: ${mark}px; display: block; filter: drop-shadow(0 ${Math.round(mark * 0.06)}px ${Math.round(mark * 0.18)}px rgba(242,122,36,0.35)); }
                .name { font: 800 ${Math.round(mark * 0.2)}px/1 'PJS', sans-serif; letter-spacing: -0.01em; color: #fff; }
                .name span { font-weight: 500; color: ${GOLD}; }
            </style></head><body><img src="${glyphUri}"><div class="name">HomeBot <span>Cinema</span></div></body></html>`);
            await page.evaluate(() => document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode()))));
            write(path.join(splashDir, file), await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: w, height: h } }));
        }
    } finally {
        await browser.close();
        fs.rmSync(profile, { recursive: true, force: true });
    }
}

main().catch((e) => { console.error('brand build failed:', e.message); process.exit(1); });
