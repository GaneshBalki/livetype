// Line and word diff (Myers) and unified patch output. No DOM, so it can be
// tested with node: node web/test/diff.test.mjs

const MAX_D = 2000; // edit distance before we give up on an exact line diff
export const CONTEXT = 3; // unchanged lines shown around a change

// myers returns the shortest edit script from a to b as [op, i, j] where op is
// '=' (a[i] equals b[j]), '-' (delete a[i]) or '+' (insert b[j]). Past maxD
// edits the middle part becomes "all removed, then all added".
export function myers(a, b, maxD = MAX_D) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const ops = [];
  for (let i = 0; i < s; i++) ops.push(['=', i, i]);
  middle(a, b, s, ea, s, eb, maxD, ops);
  for (let i = ea, j = eb; i < a.length; i++, j++) ops.push(['=', i, j]);
  return ops;
}

function middle(a, b, a0, a1, b0, b1, maxD, ops) {
  const N = a1 - a0, M = b1 - b0;
  const bail = () => {
    for (let i = a0; i < a1; i++) ops.push(['-', i, -1]);
    for (let j = b0; j < b1; j++) ops.push(['+', -1, j]);
  };
  if (!N || !M) return bail();
  const L = Math.min(N + M, maxD), off = L + 1;
  const v = new Int32Array(2 * L + 3);
  const trace = []; // trace[d] = v for k in [-d-1, d+1] before step d
  for (let d = 0; d <= L; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[a0 + x] === b[b0 + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, N, M, a0, b0, ops);
    }
  }
  bail();
}

function backtrack(trace, N, M, a0, b0, ops) {
  const out = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d], at = (k) => t[k + d + 1];
    const k = x - y;
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(pk), py = px - pk;
    while (x > px && y > py) { x--; y--; out.push(['=', a0 + x, b0 + y]); }
    if (d > 0) out.push(x === px ? ['+', -1, b0 + py] : ['-', a0 + px, -1]);
    x = px; y = py;
  }
  for (let i = out.length - 1; i >= 0; i--) ops.push(out[i]);
}

// patch is a standard unified diff, as git and patch(1) read it.
export function patch(ops, A, B) {
  const out = ['--- original', '+++ changed'];
  const idx = ops.map((o, i) => (o[0] === '=' ? -1 : i)).filter((i) => i >= 0);
  for (let h = 0; h < idx.length;) {
    let end = h;
    while (end + 1 < idx.length && idx[end + 1] - idx[end] <= 2 * CONTEXT + 1) end++;
    const from = Math.max(0, idx[h] - CONTEXT), to = Math.min(ops.length, idx[end] + CONTEXT + 1);
    let la = 0, lb = 0, sa = -1, sb = -1;
    const body = [];
    for (const [op, i, j] of ops.slice(from, to)) {
      if (op !== '+') { la++; if (sa < 0) sa = i; }
      if (op !== '-') { lb++; if (sb < 0) sb = j; }
      body.push(op === '=' ? ' ' + A[i] : op === '-' ? '-' + A[i] : '+' + B[j]);
    }
    const startOf = (s, n, k) => (n ? s + 1 : k); // empty side: line before the hunk
    const before = ops.slice(0, from);
    const ka = before.filter((o) => o[0] !== '+').length, kb = before.filter((o) => o[0] !== '-').length;
    out.push(`@@ -${startOf(sa, la, ka)},${la} +${startOf(sb, lb, kb)},${lb} @@`, ...body);
    h = end + 1;
  }
  return out.join('\n');
}


// Precision: 'word', 'char', or 'smart' (characters when that marks fewer
// separate pieces, e.g. colour → color; whole words otherwise).
const wordTokens = (s) => s.match(/\w+|\s+|[^\w\s]/gu) || [];
function marks(a, b, split) {
  const ta = split(a), tb = split(b);
  if (ta.length + tb.length > 4000) return null;
  const ops = myers(ta, tb, 300);
  const same = ops.filter((o) => o[0] === '=').reduce((n, o) => n + ta[o[1]].length, 0);
  if (same < Math.min(a.length, b.length) * 0.3) return null; // mostly rewritten: marks would be noise
  const side = (pick, hot, t, idx) => {
    const out = [];
    for (const o of ops) {
      if (o[0] === pick) continue;
      const s = t[o[idx]], h = o[0] === hot, last = out[out.length - 1];
      if (last && last[1] === h) last[0] += s; else out.push([s, h]); // join neighbours
    }
    return out;
  };
  return [side('+', '-', ta, 1), side('-', '+', tb, 2)];
}
const pieces = (m) => m[0].filter((p) => p[1]).length + m[1].filter((p) => p[1]).length;
export function words(a, b, prec = 'smart') {
  if (prec === 'word') return marks(a, b, wordTokens);
  const c = a.length + b.length < 2000 ? marks(a, b, (s) => [...s]) : null;
  if (prec === 'char') return c;
  const w = marks(a, b, wordTokens);
  return c && (!w || pieces(c) <= pieces(w)) ? c : w;
}
