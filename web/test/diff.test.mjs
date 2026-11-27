// node web/test/diff.test.mjs: checks the diff engine against a brute-force LCS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { myers, patch } from '../js/diffcore.js';

const lcs = (a, b) => {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t[0][0];
};
const rnd = (n, k) => Array.from({ length: Math.floor(Math.random() * n) }, () => 'abcde'[Math.floor(Math.random() * k)]);
for (let n = 0; n < 3000; n++) {
  const a = rnd(25, 4), b = rnd(25, 4), ops = myers(a, b);
  const A = ops.filter((o) => o[0] !== '+').map((o) => a[o[1]]), B = ops.filter((o) => o[0] !== '-').map((o) => b[o[2]]);
  assert.deepEqual(A, a); assert.deepEqual(B, b);
  for (const o of ops) if (o[0] === '=') assert.equal(a[o[1]], b[o[2]]);
  assert.equal(ops.filter((o) => o[0] === '=').length, lcs(a, b), `not minimal: ${a} / ${b}`);
}
// Past maxD it still produces a valid (non-minimal) script.
{ const a = rnd(200, 5), b = rnd(200, 5), ops = myers(a, b, 3);
  assert.deepEqual(ops.filter((o) => o[0] !== '+').map((o) => a[o[1]]), a); assert.deepEqual(ops.filter((o) => o[0] !== '-').map((o) => b[o[2]]), b); }
// The patch applies with patch(1).
const d = mkdtempSync(tmpdir() + '/diff-');
for (let n = 0; n < 60; n++) {
  const a = Array.from({ length: 40 }, (_, i) => 'line ' + i);
  const b = a.filter(() => Math.random() > 0.15).map((l) => (Math.random() < 0.1 ? l + ' changed' : l));
  if (Math.random() < 0.5) b.splice(Math.floor(Math.random() * b.length), 0, 'new');
  writeFileSync(d + '/f', a.join('\n') + '\n'); writeFileSync(d + '/p', patch(myers(a, b), a, b) + '\n');
  execFileSync('patch', ['-s', d + '/f', d + '/p']);
  assert.equal(readFileSync(d + '/f', 'utf8'), b.join('\n') + '\n');
}
// 20k-line file with scattered edits stays fast.
{ const a = Array.from({ length: 20000 }, (_, i) => 'row ' + i), b = a.map((l, i) => (i % 97 ? l : l + '!'));
  const t = Date.now(); myers(a, b); assert.ok(Date.now() - t < 1500, `slow: ${Date.now() - t} ms`); }
console.log('diff engine ok');
