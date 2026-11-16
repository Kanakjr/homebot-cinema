'use strict';
// Content guard: the public repo ships no torrent scrapers, piracy sites or release-group names, and no addon URL outside the
// public Stremio metadata/subtitle addons. Which stream sources an install uses is operator data (data/addons.json,
// STREAM_ADDON_URL in .env), never code. See docs/plugin-architecture.md "Content sources stay out of git".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SELF = path.relative(ROOT, __filename);

// Built from parts so this file does not match itself in a plain grep.
const DENY = ['torrent' + 'io', 'knight' + 'crawler', 'media' + 'fusion', 'y' + 'ts', 'rar' + 'bg', '13' + '37x', 'pirate' + 'bay', 'ez' + 'tv', 'torrent' + 'galaxy', 'pa' + 'he', 'p' + 'sa'];
const DENY_RE = new RegExp(`\\b(${DENY.join('|')})\\b`, 'i');
// Hosts allowed in an addon manifest URL inside the repo: public Stremio addons and placeholders.
const ALLOWED_HOSTS = [/(^|\.)strem\.io$/, /(^|\.)strem\.fun$/, /(^|\.)stremio\.net$/, /^example\.(com|org)$/, /(^|\.)example\.(com|org)$/, /^localhost$/, /^127\.0\.0\.1$/];
const MANIFEST_RE = /https?:\/\/([a-z0-9.-]+)(?::\d+)?\/[^\s"'`)]*manifest\.json/gi;
const SKIP = [/^pnpm-lock\.yaml$/, /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|mp4|zip|gz)$/i];

function trackedFiles() {
    try {
        return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    } catch (_) {
        return null; // not a git checkout (e.g. inside the Docker image): nothing to guard
    }
}

test('tracked files name no scrapers, piracy sites or release groups', (t) => {
    const files = trackedFiles();
    if (!files) return t.skip('not a git checkout');
    const hits = [];
    for (const f of files) {
        if (f === SELF || SKIP.some((re) => re.test(f))) continue;
        let text;
        try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
        text.split('\n').forEach((line, i) => { if (DENY_RE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
    }
    assert.deepStrictEqual(hits, [], 'Move these to operator data (data/addons.json, .env, the quality profile editor):\n' + hits.join('\n'));
});

test('addon manifest URLs in tracked files are public metadata/subtitle addons only', (t) => {
    const files = trackedFiles();
    if (!files) return t.skip('not a git checkout');
    const hits = [];
    for (const f of files) {
        if (f === SELF || SKIP.some((re) => re.test(f))) continue;
        let text;
        try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (_) { continue; }
        for (const m of text.matchAll(MANIFEST_RE)) {
            const host = m[1].toLowerCase();
            if (!ALLOWED_HOSTS.some((re) => re.test(host))) hits.push(`${f}: ${m[0]}`);
        }
    }
    assert.deepStrictEqual(hits, [], 'Addon URLs belong in data/addons.json (gitignored), not in the repo:\n' + hits.join('\n'));
});
