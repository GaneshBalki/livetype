// Run: node web/test/conflict.test.mjs
import assert from 'node:assert/strict';
import { conflicts, resolve } from '../js/conflict.js';

const t = 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> feature/x\nb\n';
const [c] = conflicts(t);
assert.equal(conflicts(t).length, 1);
assert.equal(c.oursName, 'HEAD'); assert.equal(c.theirsName, 'feature/x');
assert.equal(resolve(t, c, 'ours'), 'a\nmine\nb\n');
assert.equal(resolve(t, c, 'theirs'), 'a\ntheirs\nb\n');
assert.equal(resolve(t, c, 'both'), 'a\nmine\ntheirs\nb\n');

// diff3 style with a base section: base is dropped.
const d3 = '<<<<<<< ours\nX\n||||||| base\nO\n=======\nY\n>>>>>>> theirs\n';
assert.equal(resolve(d3, conflicts(d3)[0], 'ours'), 'X\n');
assert.equal(resolve(d3, conflicts(d3)[0], 'theirs'), 'Y\n');

// Empty sides, end of file without newline, several blocks, CRLF.
const e = 'x\n<<<<<<< a\n=======\nnew\n>>>>>>> b';
assert.equal(resolve(e, conflicts(e)[0], 'ours'), 'x\n');
assert.equal(resolve(e, conflicts(e)[0], 'theirs'), 'x\nnew');
assert.equal(resolve(e, conflicts(e)[0], 'both'), 'x\nnew');
let many = ('k\n' + t).repeat(3);
assert.equal(conflicts(many).length, 3);
for (let i = 0; i < 3; i++) many = resolve(many, conflicts(many)[0], 'theirs');
assert.equal(many, 'k\na\ntheirs\nb\n'.repeat(3));
const crlf = t.replace(/\n/g, '\r\n');
assert.equal(resolve(crlf, conflicts(crlf)[0], 'ours'), 'a\r\nmine\r\nb\r\n');

// Not conflicts: half-written block, markers inside text, ======== (8).
assert.equal(conflicts('<<<<<<< HEAD\nonly\n=======\n').length, 0);
assert.equal(conflicts('x = "<<<<<<< no"\n').length, 0);
assert.equal(conflicts('<<<<<<< a\n1\n========\n2\n>>>>>>> b\n').length, 0);
assert.equal(conflicts('').length, 0);
// A stray opener before a real block: the real block is still found.
assert.equal(conflicts('<<<<<<< a\n' + t).length, 1);
console.log('conflicts ok');
