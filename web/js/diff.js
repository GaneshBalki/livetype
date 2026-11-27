// Diff checker. Everything runs in the browser: nothing is uploaded and the
// server only serves this page. "Discuss live" opens a normal session.
import { $, toast, copy } from './common.js';
import { codeHtml, highlight, LANGS, langOf } from './code.js';
import { myers, patch, words, CONTEXT } from './diffcore.js';

const MAX_CHARS = 2_000_000; // per side
const SEED_MAX = 190_000; // what fits in one session update
const LINK_MAX = 60_000; // share links longer than this break in some apps

// rowsOf pairs removed and added lines of each change so the split view can
// show them side by side: {t: '=' | '~' | '-' | '+', l, r, hunk}.
function rowsOf(ops) {
  const rows = [], ranges = [];
  let hunks = 0, pa = 0, pb = 0;
  for (let i = 0; i < ops.length;) {
    if (ops[i][0] === '=') { rows.push({ t: '=', l: ops[i][1], r: ops[i][2] }); pa = ops[i][1] + 1; pb = ops[i][2] + 1; i++; continue; }
    const del = [], ins = [];
    for (; i < ops.length && ops[i][0] !== '='; i++) (ops[i][0] === '-' ? del : ins).push(ops[i][0] === '-' ? ops[i][1] : ops[i][2]);
    const hunk = hunks++;
    ranges.push({ a0: pa, a1: pa + del.length, b0: pb, b1: pb + ins.length });
    pa += del.length; pb += ins.length;
    for (let k = 0; k < Math.max(del.length, ins.length); k++) {
      const l = del[k] ?? -1, r = ins[k] ?? -1;
      rows.push({ t: l >= 0 && r >= 0 ? '~' : l >= 0 ? '-' : '+', l, r, hunk, first: k === 0 });
    }
  }
  return { rows, hunks, ranges };
}

// words marks the changed words of a changed line pair.
// ponytail: syntax colours are per line (and per marked piece), so a block
// comment or string spanning lines is not coloured. Fine for reading diffs.
function lineEl(parts, text) {
  const td = document.createElement('div');
  td.className = 'd-text';
  const lang = language();
  const paint = (s) => (lang ? highlight(s, lang) : s);
  if (!parts) td.append(paint(text));
  else for (const [s, hot] of parts) {
    if (!hot) { td.append(paint(s)); continue; }
    const m = document.createElement('mark');
    m.append(paint(s));
    td.append(m);
  }
  if (!td.textContent) td.append('​'); // keep empty lines one line tall
  return td;
}

// ---- page ----
const A = $('left'), B = $('right'), out = $('result');
const opt = { view: '', ws: false, nocase: false, prec: 'smart', lang: 'auto', ignore: '', wrap: true, fold: true };
const names = ['', '']; // opened file names, for Auto syntax
let state = null; // last result, for copy / discuss / navigation
let current = -1;
const open = new Set(); // folds the user expanded

// Line numbers beside each input. Inputs don't wrap, so one number per line.
const gutters = [A, B].map((ta) => {
  const box = document.createElement('div'), g = document.createElement('pre');
  box.className = 'diff-ed'; g.className = 'diff-gut'; g.setAttribute('aria-hidden', 'true');
  ta.before(box); box.append(g, ta);
  ta.addEventListener('scroll', () => { g.style.transform = `translateY(${-ta.scrollTop}px)`; });
  return () => {
    const n = String(ta.value.split('\n').length);
    if (g.dataset.n !== n) { g.dataset.n = n; g.textContent = Array.from({ length: +n }, (_, i) => i + 1).join('\n'); }
    g.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
});
const numberLines = () => gutters.forEach((f) => f());
const store = (() => { try { return sessionStorage; } catch { return null; } })();

function apply(s) {
  if (!s || typeof s.a !== 'string' || typeof s.b !== 'string') return;
  A.value = s.a; B.value = s.b;
  for (const k of Object.keys(opt)) if (s.opt && typeof s.opt[k] === typeof opt[k]) opt[k] = s.opt[k];
}
async function restore() {
  try { apply(JSON.parse(store?.getItem('devshire-diff') || 'null')); } catch { /* nothing saved */ }
  if (location.hash.startsWith('#z=')) {
    try { apply(await unpack(location.hash.slice(3))); } catch { toast('That share link is broken or incomplete.'); }
    history.replaceState(null, '', location.pathname); // the text lives only in the link; don't keep it in the address bar
  }
  if (!opt.view) opt.view = matchMedia('(max-width: 760px)').matches ? 'unified' : 'split';
  if (!LANGS[opt.lang] && opt.lang !== 'auto' && opt.lang !== 'none') opt.lang = 'auto';
  $('ws').checked = opt.ws;
  $('nocase').checked = opt.nocase;
  $('wrap').checked = opt.wrap;
  $('fold').checked = opt.fold;
  $('prec').value = opt.prec;
  $('lang').value = opt.lang;
  $('ignore').value = opt.ignore;
}

// Share links carry the text compressed in the #fragment, which browsers
// never send to the server: no storage, no server work.
const b64 = (u8) => btoa(Array.from(u8, (c) => String.fromCharCode(c)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function unpack(s) {
  const stream = new Blob([unb64(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// language picks the syntax colours: chosen, or Auto from the file name.
function language() {
  if (opt.lang === 'none') return '';
  if (opt.lang !== 'auto') return opt.lang;
  return langOf(names[0]) || langOf(names[1]);
}
function ignoreRe() {
  if (!opt.ignore) return null;
  const f = opt.nocase ? 'gi' : 'g';
  try { return new RegExp(opt.ignore, f); } catch { return new RegExp(opt.ignore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f); }
}
function save() {
  try { store?.setItem('devshire-diff', JSON.stringify({ a: A.value, b: B.value, opt })); } catch { /* full or blocked */ }
}

function compute() {
  const a = A.value.replace(/\r\n?/g, '\n'), b = B.value.replace(/\r\n?/g, '\n');
  const la = a.split('\n'), lb = b.split('\n');
  const re = ignoreRe();
  const key = (s) => {
    if (re) s = s.replace(re, '');
    if (opt.ws) s = s.trim().replace(/\s+/g, ' ');
    return opt.nocase ? s.toLowerCase() : s;
  };
  const ops = myers(la.map(key), lb.map(key));
  return { la, lb, ops, ...rowsOf(ops), empty: !a && !b };
}


function render() {
  numberLines();
  for (const v of document.querySelectorAll('[data-view]')) v.setAttribute('aria-pressed', v.dataset.view === opt.view);
  if (A.value.length > MAX_CHARS || B.value.length > MAX_CHARS) {
    out.replaceChildren(note('Each side can be at most 2 MB.'));
    return setStats(null);
  }
  state = compute();
  open.clear();
  current = -1;
  draw();
}

function draw() {
  const { rows, la, lb, empty, hunks } = state;
  setStats(state);
  if (empty) return out.replaceChildren(note('Paste or type text in both boxes. Differences appear here as you type.'));
  if (!hunks) return out.replaceChildren(note(opt.ws || opt.nocase || opt.ignore ? 'No differences (ignoring the options you picked).' : 'The two texts are identical.'));
  // Unchanged rows further than CONTEXT from a change fold into one row.
  const near = new Uint8Array(rows.length).fill(opt.fold ? 0 : 1);
  rows.forEach((r, i) => { if (r.t !== '=') for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) near[k] = 1; });
  const frag = document.createDocumentFragment();
  const split = opt.view === 'split';
  out.className = `card diff-out ${split ? 'split' : 'unified'}${opt.wrap ? '' : ' nowrap'}`;
  if (!opt.wrap) {
    // Unwrapped columns are as wide as their longest line, and the result scrolls sideways.
    const w = (ls) => Math.min(4000, ls.reduce((m, s) => Math.max(m, s.replace(/\t/g, '    ').length), 0)) + 2;
    out.style.setProperty('--wl', w(la) + 'ch');
    out.style.setProperty('--wr', w(lb) + 'ch');
    out.style.setProperty('--wu', Math.max(w(la), w(lb)) + 'ch');
  }
  for (let i = 0; i < rows.length;) {
    if (!near[i] && !open.has(i)) {
      let j = i;
      while (j < rows.length && !near[j]) j++;
      if (j - i > 1) { frag.append(fold(i, j)); i = j; continue; }
    }
    const r = rows[i++];
    if (r.t === '=') { frag.append(row(split, r.l, r.r, ' ', la[r.l], lb[r.r])); continue; }
    const w = r.t === '~' ? words(la[r.l], lb[r.r], opt.prec) : null;
    let first;
    if (split) first = row(split, r.l, r.r, r.t, r.l >= 0 ? la[r.l] : null, r.r >= 0 ? lb[r.r] : null, w);
    else {
      // Unified: all removed lines of a change, then all added ones.
      if (!r.first) continue;
      const block = [];
      for (let k = i - 1; k < rows.length && rows[k].hunk === r.hunk; k++) block.push(rows[k]);
      i += block.length - 1;
      const g = document.createDocumentFragment();
      const pairs = block.map((x) => (x.t === '~' ? words(la[x.l], lb[x.r], opt.prec) : null));
      block.forEach((x, n) => { if (x.l >= 0) g.append(row(false, x.l, -1, '-', la[x.l], null, pairs[n] && [pairs[n][0], null])); });
      block.forEach((x, n) => { if (x.r >= 0) g.append(row(false, -1, x.r, '+', null, lb[x.r], pairs[n] && [null, pairs[n][1]])); });
      first = g.firstChild;
      first.dataset.hunk = r.hunk;
      first.append(merger(r.hunk));
      frag.append(g);
      continue;
    }
    if (r.first) { first.dataset.hunk = r.hunk; first.append(merger(r.hunk)); }
    frag.append(first);
  }
  out.replaceChildren(frag);
}

function row(split, l, r, t, ta, tb, w) {
  const d = document.createElement('div');
  d.className = `d-row t${{ ' ': 'eq', '-': 'del', '+': 'ins', '~': 'chg' }[t]}`;
  const num = (n) => { const s = document.createElement('span'); s.className = 'd-num'; s.textContent = n >= 0 ? n + 1 : ''; return s; };
  if (split) {
    const left = ta === null ? blank() : lineEl(w?.[0], ta), right = tb === null ? blank() : lineEl(w?.[1], tb);
    if (t !== ' ') { if (ta !== null) left.classList.add('del'); if (tb !== null) right.classList.add('ins'); }
    d.append(num(l), left, num(r), right);
  } else {
    const sign = document.createElement('span');
    sign.className = 'd-sign';
    sign.textContent = t === ' ' ? '' : t === '-' ? '−' : '+';
    const text = lineEl(t === '-' ? w?.[0] : w?.[1], ta ?? tb);
    if (t !== ' ') text.classList.add(t === '-' ? 'del' : 'ins');
    d.append(num(l), num(r), sign, text);
  }
  return d;
}
// merger: arrows that copy one change across. → makes Changed match Original
// here; ← makes Original match Changed.
function merger(h) {
  const box = document.createElement('span');
  box.className = 'd-merge';
  for (const [dir, label] of [['right', 'Copy this change from Original to Changed'], ['left', 'Copy this change from Changed to Original']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm';
    b.textContent = dir === 'right' ? '→' : '←';
    b.title = b.ariaLabel = label;
    b.addEventListener('click', () => merge(h, dir));
    box.append(b);
  }
  return box;
}
function merge(h, dir) {
  const { a0, a1, b0, b1 } = state.ranges[h];
  const { la, lb } = state;
  if (dir === 'right') B.value = [...lb.slice(0, b0), ...la.slice(a0, a1), ...lb.slice(b1)].join('\n');
  else A.value = [...la.slice(0, a0), ...lb.slice(b0, b1), ...la.slice(a1)].join('\n');
  render(); save();
  toast(dir === 'right' ? 'Change copied to Changed.' : 'Change copied to Original.');
}
const blank = () => { const e = document.createElement('div'); e.className = 'd-text d-blank'; return e; };
function fold(i, j) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'd-fold';
  b.textContent = `⋯ ${j - i} unchanged lines`;
  b.addEventListener('click', () => { for (let k = i; k < j; k++) open.add(k); draw(); });
  return b;
}
const note = (s) => { const p = document.createElement('p'); p.className = 'd-note'; p.textContent = s; out.className = 'card diff-out'; return p; };

function setStats(s) {
  let add = 0, del = 0;
  if (s) for (const [op] of s.ops) { if (op === '+') add++; else if (op === '-') del++; }
  $('stat-add').textContent = `+${add}`;
  $('stat-del').textContent = `−${del}`;
  const n = s?.hunks || 0;
  $('stat-hunks').textContent = n ? `${n} ${n === 1 ? 'change' : 'changes'}` : '';
  for (const id of ['prev', 'next', 'copy-patch', 'pdf']) $(id).disabled = !n;
  $('discuss').disabled = $('share').disabled = !s || s.empty;
}

function go(step) {
  const n = state?.hunks;
  if (!n) return;
  current = (current + step + n) % n;
  const el = out.querySelector(`[data-hunk="${current}"]`);
  el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el?.classList.remove('flash'); void el?.offsetWidth; el?.classList.add('flash');
  $('stat-hunks').textContent = `${current + 1} of ${n}`;
}

let timer;
const later = () => { clearTimeout(timer); timer = setTimeout(() => { render(); save(); }, 200); };

async function load(file, target) {
  if (!file) return;
  if (file.size > MAX_CHARS) return toast('That file is over 2 MB.');
  try {
    target.value = await file.text();
  } catch { return toast('Could not read that file.'); }
  target.closest('.diff-side').querySelector('.d-file').textContent = file.name;
  names[target === A ? 0 : 1] = file.name;
  render(); save();
}

for (const [ta, pick] of [[A, 'open-left'], [B, 'open-right']]) {
  ta.addEventListener('input', later);
  ta.addEventListener('input', numberLines);
  const input = $(pick + '-file');
  $(pick).addEventListener('click', () => input.click());
  input.addEventListener('change', () => { load(input.files[0], ta); input.value = ''; });
  ta.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); ta.classList.add('drop'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
  ta.addEventListener('drop', (e) => { ta.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); load(e.dataTransfer.files[0], ta); } });
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => { opt.view = b.dataset.view; render(); save(); });
$('ws').addEventListener('change', (e) => { opt.ws = e.target.checked; render(); save(); });
$('nocase').addEventListener('change', (e) => { opt.nocase = e.target.checked; render(); save(); });
for (const [id, k] of [['wrap', 'wrap'], ['fold', 'fold']]) $(id).addEventListener('change', (e) => { opt[k] = e.target.checked; render(); save(); });
for (const id of ['prec', 'lang']) $(id).addEventListener('change', (e) => { opt[id] = e.target.value; render(); save(); });
$('ignore').addEventListener('input', (e) => { opt.ignore = e.target.value; later(); });
$('swap').addEventListener('click', () => {
  [A.value, B.value] = [B.value, A.value];
  names.reverse();
  const f = document.querySelectorAll('.d-file');
  [f[0].textContent, f[1].textContent] = [f[1].textContent, f[0].textContent];
  render(); save();
});
$('clear').addEventListener('click', () => { A.value = B.value = ''; names.fill(''); for (const f of document.querySelectorAll('.d-file')) f.textContent = ''; render(); save(); A.focus(); });
$('share').addEventListener('click', async () => {
  let z;
  try { z = await pack({ a: A.value, b: B.value, opt }); } catch { return toast('Your browser cannot make share links.'); }
  if (z.length > LINK_MAX) return toast('Too large for a link. Use Discuss live or Copy diff instead.');
  copy(`${location.origin}/diff#z=${z}`);
});
$('pdf').addEventListener('click', () => window.print());
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('copy-patch').addEventListener('click', () => copy(patch(state.ops, state.la, state.lb)));
async function startSession(html, btn) {
  if (html.length > SEED_MAX) return toast('This is too large for a live session (about 190 KB at most).');
  btn.disabled = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error((await res.text()) || 'Could not start a session.');
    const room = await res.json();
    sessionStorage.setItem('devshire-seed', JSON.stringify({ room: room.roomId, html }));
    location.href = room.hostUrl;
  } catch (err) {
    toast(err.message || 'Could not start a session.');
    btn.disabled = false;
  }
}
$('discuss').addEventListener('click', (e) => {
  const text = state.hunks ? patch(state.ops, state.la, state.lb) : B.value || A.value;
  startSession(codeHtml(state.hunks ? 'diff' : 'plain', text), e.currentTarget);
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); go(e.key === 'ArrowDown' ? 1 : -1); }
});
restore().then(render);
