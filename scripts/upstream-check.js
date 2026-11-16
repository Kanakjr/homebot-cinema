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
const listed = new Set([...doc.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
const isListed = ({ f }) => listed.has(f) || (f.startsWith('assets/images/splash/') && doc.includes('assets/images/splash/*'));
const missing = changed.filter((c) => !isListed(c));
console.log(`${changed.length} upstream files changed vs ${base} (${changed.filter((c) => c.st === 'D').length} removed).`);
if (missing.length) {
    console.error('\nNot listed in docs/upstream-touchpoints.md (add each with a reason, or move the change into a new file/plugin):');
    missing.forEach((c) => console.error(`  ${c.st === 'D' ? 'removed ' : 'modified'} ${c.f}`));
    process.exit(1);
}
console.log('All listed in docs/upstream-touchpoints.md.');
