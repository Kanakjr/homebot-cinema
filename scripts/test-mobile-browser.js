'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ADMIN = 'admin@example.com';
const ARTIFACTS_DIR = process.env.ARTIFACT_DIR || path.join(os.homedir(), '.gemini/antigravity/brain/c4dde1e0-65f1-4792-b8a0-ed7185635c9b');

const freePort = () => new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
        const p = s.address().port;
        s.close(() => resolve(p));
    });
});

function getCompiledClasses() {
    const buildDir = path.join(ROOT, 'build');
    const verDir = fs.readdirSync(buildDir).find((f) => f.startsWith('v5.'));
    if (!verDir) throw new Error('Build directory not found in ' + buildDir);
    const cssPath = path.join(buildDir, verDir, 'styles/main.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    const mBoard = css.match(/\.(board-container-[a-zA-Z0-9_]{5})\b/);
    const mContentContainer = css.match(/\.(board-content-container-[a-zA-Z0-9_]{5})\b/);
    const mContent = css.match(/\.(board-content-[a-zA-Z0-9_]{5})\b/);
    const mRow = css.match(/\.(board-row-landscape-[a-zA-Z0-9_]{5})\b/);
    const mItemsContainer = css.match(new RegExp('\\.' + mRow[1] + '[^{]*?\\.(meta-items-container-[a-zA-Z0-9_]{5})\\b'));
    const mItem = css.match(new RegExp('\\.' + mRow[1] + '\\s+\\.' + mItemsContainer[1] + '\\s+\\.(meta-item-[a-zA-Z0-9_]{5})\\b'));

    const getSingle = (name) => {
        const m = css.match(new RegExp('\\.(' + name + '-[a-zA-Z0-9_]{5})\\b'));
        return m ? m[1] : name;
    };

    return {
        board: mBoard[1],
        contentContainer: mContentContainer[1],
        content: mContent[1],
        row: mRow[1],
        container: mItemsContainer[1],
        item: mItem[1],
        card: getSingle('card'),
        art: getSingle('art'),
        shade: getSingle('shade'),
        pill: getSingle('pill'),
        pillAccent: getSingle('pill-accent'),
        info: getSingle('info'),
        ep: getSingle('ep'),
        name: getSingle('name'),
        bar: getSingle('bar'),
        fill: getSingle('fill'),
    };
}

async function bootServer() {
    const port = await freePort();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-mobile-test-'));
    fs.mkdirSync(path.join(dataDir, 'Movies'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'TV'), { recursive: true });

    const serverDeps = path.join(ROOT, '.cache/server-deps/node_modules');
    const nodePath = process.env.NODE_PATH ? `${process.env.NODE_PATH}:${serverDeps}` : serverDeps;

    const proc = spawn(process.execPath, ['http_server.js'], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_PATH: nodePath,
            PORT: String(port),
            CINEMA_DATA_DIR: dataDir,
            CINEMA_PLUGINS: 'none',
            NODE_ENV: 'development',
            DEV_EMAIL: ADMIN,
            ADMIN_EMAILS: ADMIN,
            STREMIO_SERVER_HOST: '127.0.0.1',
            STREMIO_SERVER_PORT: '9',
            TRANSMISSION_HOST: '127.0.0.1',
            TRANSMISSION_PORT: '9',
            LIBRARY_MOVIES_DIR: path.join(dataDir, 'Movies'),
            LIBRARY_TV_DIR: path.join(dataDir, 'TV'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let log = '';
    proc.stdout.on('data', (d) => { log += d; });
    proc.stderr.on('data', (d) => { log += d; });

    for (let i = 0; i < 100; i++) {
        if (/listening on port/.test(log)) break;
        if (proc.exitCode !== null) break;
        await new Promise((r) => setTimeout(r, 100));
    }

    if (!/listening on port/.test(log)) {
        proc.kill('SIGKILL');
        throw new Error('Server failed to start:\n' + log);
    }

    return {
        port,
        dataDir,
        stop: async () => {
            proc.kill('SIGTERM');
            await new Promise((r) => proc.once('exit', r));
            try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
        },
    };
}

class CDPClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
    }

    async connect() {
        this.ws = new globalThis.WebSocket(this.wsUrl);
        await new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = reject;
        });

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.id && this.pending.has(data.id)) {
                const { resolve, reject } = this.pending.get(data.id);
                this.pending.delete(data.id);
                if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
                else resolve(data.result);
            }
        };
    }

    send(method, params = {}, sessionId = null) {
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        const msg = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(msg);
        });
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

async function runTest() {
    console.log('1. Reading compiled CSS classes...');
    const classes = getCompiledClasses();

    console.log('2. Booting HomeBot Cinema server for mobile UI testing...');
    const server = await bootServer();
    console.log(`   Server running on http://127.0.0.1:${server.port}`);

    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!fs.existsSync(chromePath)) {
        throw new Error('Google Chrome not found at ' + chromePath);
    }

    const chromeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-mobile-'));
    console.log('3. Launching Google Chrome in headless mobile configuration...');
    const chromeProc = spawn(chromePath, [
        '--headless=new',
        '--remote-debugging-port=0',
        '--user-data-dir=' + chromeUserData,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--hide-scrollbars',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let browserWsUrl = '';
    chromeProc.stderr.on('data', (d) => {
        const m = d.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) browserWsUrl = m[1];
    });

    for (let i = 0; i < 50; i++) {
        if (browserWsUrl) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    if (!browserWsUrl) throw new Error('Failed to get DevTools WebSocket URL');

    console.log('4. Connecting to DevTools protocol...');
    const browserCdp = new CDPClient(browserWsUrl);
    await browserCdp.connect();

    // Create a new target page
    const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: true });

    // Helper for sending session commands
    const sessionSend = (method, params = {}) => browserCdp.send(method, params, sessionId);

    // Configure mobile viewport (iPhone 14 / Pixel 7: 390x844, 3x DPR, mobile touch)
    console.log('5. Configuring mobile emulation (390x844 @ 3x DPR, mobile touch)...');
    await sessionSend('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        fitWindow: false,
    });
    await sessionSend('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
    });
    await sessionSend('Emulation.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 CinemaMobile/1.0',
    });

    await sessionSend('Page.enable');
    await sessionSend('Runtime.enable');
    await sessionSend('DOM.enable');
    await sessionSend('CSS.enable');

    const appUrl = `http://127.0.0.1:${server.port}/#/`;
    console.log(`6. Navigating to ${appUrl}...`);
    await sessionSend('Page.navigate', { url: appUrl });

    // Wait for the page DOM and React root to mount
    console.log('7. Waiting for app shell to render...');
    let mounted = false;
    for (let i = 0; i < 60; i++) {
        const { result } = await sessionSend('Runtime.evaluate', {
            expression: 'document.querySelector("#app, .board-container, [class*=\\"board-container\\"]") !== null',
            returnByValue: true,
        });
        if (result && result.value) {
            mounted = true;
            break;
        }
        await new Promise((r) => setTimeout(r, 200));
    }

    // Inject mock Continue Watching and Upcoming elements into Board to verify real layout under mobile conditions
    console.log('8. Evaluating mobile layout and testing Continue Watching & Upcoming sizing...');
    const evalResult = await sessionSend('Runtime.evaluate', {
        expression: `(function(C) {
            try {
                // Find or create test board container with exact nested classes
                let boardContainer = document.querySelector('.' + C.board);
                if (!boardContainer) {
                    boardContainer = document.createElement('div');
                    boardContainer.className = C.board;
                    document.body.appendChild(boardContainer);
                }

                let boardContentContainer = boardContainer.querySelector('.' + C.contentContainer);
                if (!boardContentContainer) {
                    boardContentContainer = document.createElement('div');
                    boardContentContainer.className = C.contentContainer;
                    boardContainer.appendChild(boardContentContainer);
                }

                let board = boardContentContainer.querySelector('.' + C.content);
                if (!board) {
                    board = document.createElement('div');
                    board.className = C.content;
                    boardContentContainer.appendChild(board);
                }

                // Create Continue Watching row with 4 items
                const cwRow = document.createElement('div');
                cwRow.className = 'board-row ' + C.row;
                cwRow.id = 'test-mobile-cw-row';

                const cwHeader = document.createElement('div');
                cwHeader.style.padding = '0.5rem 0.5rem';
                cwHeader.style.fontSize = '1.3rem';
                cwHeader.style.fontWeight = '700';
                cwHeader.textContent = 'Continue watching';
                cwRow.appendChild(cwHeader);

                const cwContainer = document.createElement('div');
                cwContainer.className = C.container;

                const sampleCW = [
                    { name: 'Never Have I Ever', ep: 'S1 E2', pill: '17% watched', hasBar: true, pct: 17 },
                    { name: 'The Terror', ep: 'Next up · S2 E8', pill: 'New episode', hasBar: false, accent: true },
                    { name: 'Dandadan', ep: 'Next up · S3 E1', pill: 'Not aired yet', hasBar: false, accent: true },
                    { name: 'Dexter: Resurrection', ep: 'Next up · S2 E4', pill: 'Airs Monday', hasBar: false, accent: true },
                ];

                sampleCW.forEach((c) => {
                    const item = document.createElement('div');
                    item.className = C.item + ' poster-shape-landscape';

                    const card = document.createElement('a');
                    card.className = C.card;
                    card.style.position = 'relative';

                    const art = document.createElement('div');
                    art.className = C.art;
                    art.style.background = '#222';

                    const shade = document.createElement('div');
                    shade.className = C.shade;

                    const pill = document.createElement('div');
                    pill.className = C.pill + (c.accent ? ' ' + C.pillAccent : '');
                    pill.textContent = c.pill;

                    const info = document.createElement('div');
                    info.className = C.info;

                    const ep = document.createElement('div');
                    ep.className = C.ep;
                    ep.textContent = c.ep;

                    const name = document.createElement('div');
                    name.className = C.name;
                    name.textContent = c.name;

                    info.appendChild(ep);
                    info.appendChild(name);

                    card.appendChild(art);
                    card.appendChild(shade);
                    card.appendChild(pill);
                    card.appendChild(info);

                    if (c.hasBar) {
                        const bar = document.createElement('div');
                        bar.className = C.bar;
                        const fill = document.createElement('div');
                        fill.className = C.fill;
                        fill.style.width = c.pct + '%';
                        bar.appendChild(fill);
                        card.appendChild(bar);
                    }

                    item.appendChild(card);
                    cwContainer.appendChild(item);
                });

                cwRow.appendChild(cwContainer);
                board.appendChild(cwRow);

                // Create Upcoming row with 7 items
                const upcomingRow = document.createElement('div');
                upcomingRow.className = 'board-row ' + C.row;
                upcomingRow.id = 'test-upcoming-row';

                const upHeader = document.createElement('div');
                upHeader.style.padding = '0.5rem 0.5rem';
                upHeader.style.fontSize = '1.3rem';
                upHeader.style.fontWeight = '700';
                upHeader.textContent = 'Upcoming';
                upcomingRow.appendChild(upHeader);

                const upContainer = document.createElement('div');
                upContainer.className = C.container;

                const upcomingItems = [
                    { name: 'Squid Game', ep: 'S2 E1', pill: 'Today' },
                    { name: 'Severance', ep: 'S2 E1', pill: 'Tomorrow' },
                    { name: 'The Last of Us', ep: 'S2 E1', pill: 'Monday' },
                    { name: 'Stranger Things', ep: 'S5 E1', pill: 'Nov 24' },
                    { name: 'White Lotus', ep: 'S3 E1', pill: 'Nov 27' },
                    { name: 'Peacemaker', ep: 'S2 E1', pill: 'Nov 30' },
                    { name: 'Wednesday', ep: 'S2 E1', pill: 'Dec 4' },
                ];

                upcomingItems.forEach((c) => {
                    const item = document.createElement('div');
                    item.className = C.item + ' poster-shape-landscape';

                    const card = document.createElement('a');
                    card.className = C.card;

                    const art = document.createElement('div');
                    art.className = C.art;
                    art.style.background = '#282830';

                    const shade = document.createElement('div');
                    shade.className = C.shade;

                    const pill = document.createElement('div');
                    pill.className = C.pill + ' ' + C.pillAccent;
                    pill.textContent = c.pill;

                    const info = document.createElement('div');
                    info.className = C.info;

                    const ep = document.createElement('div');
                    ep.className = C.ep;
                    ep.textContent = c.ep;

                    const name = document.createElement('div');
                    name.className = C.name;
                    name.textContent = c.name;

                    info.appendChild(ep);
                    info.appendChild(name);

                    card.appendChild(art);
                    card.appendChild(shade);
                    card.appendChild(pill);
                    card.appendChild(info);

                    item.appendChild(card);
                    upContainer.appendChild(item);
                });

                upcomingRow.appendChild(upContainer);
                board.appendChild(upcomingRow);

                // Measure first continue watching card
                const firstCW = cwContainer.children[0];
                const cwRect = firstCW.getBoundingClientRect();

                // Measure first upcoming card
                const firstUp = upContainer.children[0];
                const upRect = firstUp.getBoundingClientRect();

                // Check computed styles on mobile
                const cwComputed = window.getComputedStyle(firstCW);
                const cwContainerComputed = window.getComputedStyle(cwContainer);

                // Measure top navigation bar if present
                const topNav = document.querySelector('[class*="horizontal-nav-bar-container"]');
                const topNavRect = topNav ? topNav.getBoundingClientRect() : null;
                const topNavComputed = topNav ? window.getComputedStyle(topNav) : null;

                return {
                    windowWidth: window.innerWidth,
                    windowHeight: window.innerHeight,
                    topBar: topNav ? {
                        height: Math.round(topNavRect.height),
                        boxSizing: topNavComputed.boxSizing,
                        isCompact: topNavRect.height <= 85,
                    } : null,
                    continueWatching: {
                        cardWidth: Math.round(cwRect.width),
                        cardHeight: Math.round(cwRect.height),
                        flex: cwComputed.flex,
                        minWidth: cwComputed.minWidth,
                        maxWidth: cwComputed.maxWidth,
                        overflowX: cwContainerComputed.overflowX,
                        containerScrollWidth: cwContainer.scrollWidth,
                        containerClientWidth: cwContainer.clientWidth,
                        isScrollable: cwContainer.scrollWidth > cwContainer.clientWidth,
                        aspectRatio: Number((cwRect.width / cwRect.height).toFixed(2)),
                    },
                    upcoming: {
                        cardWidth: Math.round(upRect.width),
                        cardHeight: Math.round(upRect.height),
                        flex: window.getComputedStyle(firstUp).flex,
                        containerScrollWidth: upContainer.scrollWidth,
                        containerClientWidth: upContainer.clientWidth,
                        isScrollable: upContainer.scrollWidth > upContainer.clientWidth,
                        aspectRatio: Number((upRect.width / upRect.height).toFixed(2)),
                    }
                };
            } catch (err) {
                return { error: err.message, stack: err.stack };
            }
        })(${JSON.stringify(classes)})`,
        returnByValue: true,
    });

    console.log('9. Test Results:');
    const res = evalResult.result.value;
    if (res && res.error) {
        throw new Error('In-page evaluation error: ' + res.error + '\n' + res.stack);
    }
    console.log(JSON.stringify(res, null, 2));

    const cw = res.continueWatching;
    const up = res.upcoming;

    // Assertions
    if (cw.cardWidth < 200) {
        throw new Error(`FAIL: Continue watching card width is too small (${cw.cardWidth}px < 200px), card is squashed!`);
    }
    if (cw.cardHeight < 110) {
        throw new Error(`FAIL: Continue watching card height is too small (${cw.cardHeight}px < 110px)!`);
    }
    if (!cw.isScrollable) {
        throw new Error(`FAIL: Continue watching row should be horizontally scrollable!`);
    }

    if (up.cardWidth < 200) {
        throw new Error(`FAIL: Upcoming card width is too small (${up.cardWidth}px < 200px), 7 items squashed into 1 row!`);
    }
    if (up.cardHeight < 110) {
        throw new Error(`FAIL: Upcoming card height is too small (${up.cardHeight}px < 110px), squashed like tiny pill!`);
    }
    if (!up.isScrollable) {
        throw new Error(`FAIL: Upcoming row should be horizontally scrollable!`);
    }

    if (res.topBar) {
        if (!res.topBar.isCompact) {
            throw new Error(`FAIL: Top navigation bar height (${res.topBar.height}px) exceeds mobile compact limit (85px)!`);
        }
        console.log(`   Top Navigation Bar: ${res.topBar.height}px (compact, box-sizing: ${res.topBar.boxSizing})`);
    }

    console.log('✅ ALL MOBILE LAYOUT ASSERTIONS PASSED!');
    console.log(`   Continue Watching Card: ${cw.cardWidth}x${cw.cardHeight}px (flex: ${cw.flex}, Aspect: ${cw.aspectRatio}:1, 16:9 ~ 1.78)`);
    console.log(`   Upcoming Card: ${up.cardWidth}x${up.cardHeight}px (flex: ${up.flex}, Aspect: ${up.aspectRatio}:1, 7 items cleanly scrollable)`);

    // Capture screenshot
    console.log('10. Capturing mobile screenshot...');
    const { data: base64Png } = await sessionSend('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
    });

    // Save screenshot
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const screenshotPath = path.join(ARTIFACTS_DIR, 'mobile-ui-preview.png');
    fs.writeFileSync(screenshotPath, Buffer.from(base64Png, 'base64'));
    console.log(`    Saved mobile screenshot to: ${screenshotPath}`);

    // Cleanup
    browserCdp.close();
    chromeProc.kill('SIGTERM');
    await new Promise((r) => chromeProc.once('exit', r));
    try { fs.rmSync(chromeUserData, { recursive: true, force: true }); } catch (_) {}
    await server.stop();
    console.log('11. Teardown complete. Test passed successfully.');
}

runTest().catch((err) => {
    console.error('Mobile test failed:', err);
    process.exit(1);
});
