#!/usr/bin/env node
// pnpm check:upstream [base-ref]
// Lists upstream files (present in the upstream base) that this checkout modifies or deletes, and fails when one of them is not
// listed in docs/upstream-touchpoints.md. Base ref: argument, env UPSTREAM_BASE, or the tag "upstream-base" (docs/upstream-sync.md).

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const base = process.argv[2] || process.env.UPSTREAM_BASE || 'upstream-base';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
} catch (_) {
    console.error(`No "${base}" ref. Add the upstream remote and tag the base first (docs/upstream-sync.md), or pass a ref.`);
    process.exit(2);
}
const upstreamFiles = new Set(git('ls-tree', '-r', '--name-only', base).split('\n').filter(Boolean));
// working tree vs the upstream base, upstream files only
const changed = git('diff', '--name-status', base, '--', '.').split('\n').filter(Boolean)
    .map((l) => l.split('\t')).filter(([st, f]) => /^[MD]/.test(st) && upstreamFiles.has(f)).map(([st, f]) => ({ st: st[0], f }));
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'upstream-touchpoints.md'), 'utf8');

function extractPaths(markdown) {
    const out = new Set();
    for (const line of markdown.split('\n')) {
        const table = line.match(/^\|\s*`([^`]+)`\s*\|/);
        if (table) { out.add(table[1]); continue; }
        const bullet = line.match(/^\s*-\s+`([^`]+)`/);
        if (bullet) out.add(bullet[1]);
    }
    return out;
}

function parseSections(markdown) {
    const sections = new Map();
    const parts = markdown.split(/^##\s+/m);
    for (const part of parts.slice(1)) {
        const nl = part.indexOf('\n');
        const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
        const body = nl === -1 ? '' : part.slice(nl + 1);
        sections.set(heading, body);
    }
    return sections;
}

const sections = parseSections(doc);
const replacedBody = sections.get('Replaced images (branding: `scripts/brand/build.js` regenerates them)') || sections.get('Replaced images') || '';
const modifiedTablePaths = extractPaths(sections.get('Modified') || '');
const modifiedSet = new Set([
    ...modifiedTablePaths,
    ...extractPaths(replacedBody),
]);
const removedSet = extractPaths(sections.get('Removed') || '');

const hasModified = (f) => modifiedSet.has(f) || (f.startsWith('assets/images/splash/') && replacedBody.includes('assets/images/splash/*'));
const hasRemoved = (f) => removedSet.has(f);

const missingModified = changed.filter((c) => c.st === 'M' && !hasModified(c.f));
const missingRemoved = changed.filter((c) => c.st === 'D' && !hasRemoved(c.f));
const nonUpstream = [...modifiedTablePaths, ...removedSet]
    .filter((f) => f !== 'assets/images/splash/*' && !upstreamFiles.has(f));

console.log(`${changed.length} upstream files changed vs ${base} (${changed.filter((c) => c.st === 'D').length} removed).`);
if (missingModified.length || missingRemoved.length || nonUpstream.length) {
    if (missingModified.length) {
        console.error('\nModified upstream files missing from `## Modified` / `## Replaced images` in docs/upstream-touchpoints.md:');
        missingModified.forEach((c) => console.error(`  modified ${c.f}` + (hasRemoved(c.f) ? ' (currently listed under ## Removed!)' : '')));
    }
    if (missingRemoved.length) {
        console.error('\nRemoved upstream files missing from `## Removed` in docs/upstream-touchpoints.md:');
        missingRemoved.forEach((c) => console.error(`  removed  ${c.f}` + (hasModified(c.f) ? ' (currently listed under ## Modified!)' : '')));
    }
    if (nonUpstream.length) {
        console.error('\nListed in docs/upstream-touchpoints.md but not present in upstream base:');
        nonUpstream.forEach((f) => console.error(`  non-upstream ${f}`));
    }
    process.exit(1);
}
console.log('All listed in the matching sections of docs/upstream-touchpoints.md.');
