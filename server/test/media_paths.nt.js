'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isInsideRoots, mediaRoots } = require('../media_paths');

function layout() {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-')));
    const movies = path.join(base, 'Movies');
    const secret = path.join(base, 'data');
    fs.mkdirSync(path.join(movies, 'A (2020)'), { recursive: true });
    fs.mkdirSync(secret);
    fs.writeFileSync(path.join(movies, 'A (2020)', 'a.mkv'), 'x');
    fs.writeFileSync(path.join(secret, 'stream_secret.key'), 'topsecret');
    fs.symlinkSync(secret, path.join(movies, 'escape'));
    fs.symlinkSync(path.join(movies, 'A (2020)', 'a.mkv'), path.join(movies, 'inside-link.mkv'));
    return { base, movies, secret, roots: [movies] };
}

test('files inside a root are allowed', () => {
    const { movies, roots } = layout();
    assert.ok(isInsideRoots(path.join(movies, 'A (2020)', 'a.mkv'), roots));
    assert.ok(isInsideRoots(path.join(movies, 'inside-link.mkv'), roots), 'symlink that stays inside is fine');
});

test('paths outside the roots are rejected', () => {
    const { secret, roots } = layout();
    assert.equal(isInsideRoots(path.join(secret, 'stream_secret.key'), roots), false);
    assert.equal(isInsideRoots('/etc/hostname', roots), false);
    assert.equal(isInsideRoots('/proc/self/environ', roots), false);
});

test('.. traversal and symlink escapes are rejected', () => {
    const { movies, secret, roots } = layout();
    assert.equal(isInsideRoots(path.join(movies, '..', 'data', 'stream_secret.key'), roots), false);
    assert.equal(isInsideRoots(path.join(movies, 'escape', 'stream_secret.key'), roots), false, 'symlink out of the root');
});

test('a sibling directory sharing the root prefix is not inside it', () => {
    const { base, roots } = layout();
    const sibling = path.join(base, 'Movies-private');
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'f.mkv'), 'x');
    assert.equal(isInsideRoots(path.join(sibling, 'f.mkv'), roots), false);
});

test('missing / non-string input is rejected; MEDIA_ROOTS env is honoured', () => {
    const { movies, roots } = layout();
    for (const bad of [undefined, null, '', 42, path.join(movies, 'nope.mkv')]) assert.equal(isInsideRoots(bad, roots), false);
    assert.deepEqual(mediaRoots({ MEDIA_ROOTS: `${movies}:/does/not/exist` }), [movies, '/does/not/exist']);
});
