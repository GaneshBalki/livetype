// Merge conflicts: finds Git conflict blocks in code and resolves one at a time.
//   <<<<<<< HEAD        (current: your side)
//   ...
//   ||||||| base        (optional, diff3 style)
//   ...
//   =======
//   ...
//   >>>>>>> feature     (incoming)
// Pure functions first (tested in web/test/conflict.test.mjs), then mergeView,
// the card UI shared by /merge and live sessions.

import { myers, words } from './diffcore.js';
import { highlight } from './code.js';

const OPEN = '<<<<<<<', BASE = '|||||||', MID = '=======', CLOSE = '>>>>>>>';
const isMarker = (line, m) => line.startsWith(m) && (line.length === 7 || line[7] === ' ' || line[7] === '\r');

// conflicts returns each block as character offsets into text:
// {start, end, ours: [s, e], theirs: [s, e], oursName, theirsName}.
// end includes the closing marker's newline. Half-written blocks are skipped.
export function conflicts(text) {
  const out = [];
  let at = 0, cur = null, part = '';
  while (at <= text.length) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    const line = text.slice(at, nl), next = Math.min(nl + 1, text.length);
    if (isMarker(line, OPEN)) {
      cur = { start: at, ours: [next, next], oursName: line.slice(8).trim() };
      part = 'ours';
    } else if (cur && part === 'ours' && isMarker(line, BASE)) {
      cur.ours[1] = at; part = 'base';
    } else if (cur && (part === 'ours' || part === 'base') && isMarker(line, MID)) {
      if (part === 'ours') cur.ours[1] = at;
      cur.theirs = [next, next]; part = 'theirs';
    } else if (cur && part === 'theirs' && isMarker(line, CLOSE)) {
      cur.theirs[1] = at;
      cur.theirsName = line.slice(8).trim();
      cur.end = next;
      out.push(cur);
      cur = null; part = '';
    }
    if (nl >= text.length) break;
    at = nl + 1;
  }
  return out;
}

// choice is what replaces conflict c; resolve returns text with conflict c replaced by 'ours', 'theirs' or 'both'.
export function choice(text, c, how) {
  const ours = text.slice(...c.ours), theirs = text.slice(...c.theirs);
  const nl = (s) => (s && !s.endsWith('\n') ? s + '\n' : s);
  let keep = how === 'ours' ? ours : how === 'theirs' ? theirs : nl(ours) + theirs;
  // The block ended without a newline (end of file): don't add one.
  if (c.end === text.length && !text.endsWith('\n')) keep = keep.replace(/\n$/, '');
  return keep;
}
export const resolve = (text, c, how) => text.slice(0, c.start) + choice(text, c, how) + text.slice(c.end);

// markerRe tells the highlighter which lines are conflict markers.
export const markerRe = /^(?:<{7}|\|{7}|={7}|>{7})(?: .*)?$/;


// howOf tells which choice turned before into after: 'ours' | 'theirs' |
// 'both' | 'edited', with the conflict it resolved. null if none vanished.
export function howOf(before, after) {
  const old = conflicts(before);
  if (conflicts(after).length >= old.length) return null;
  for (const c of old) for (const how of ['theirs', 'ours', 'both']) if (resolve(before, c, how) === after) return { c, how };
  const left = new Set(conflicts(after).map((c) => after.slice(c.start, c.end)));
  const c = old.find((x) => !left.has(before.slice(x.start, x.end)));
  return c ? { c, how: 'edited' } : null;
}

// ---- mergeView (browser only) ----
// o: { text(), set(next), canEdit(), lang(), who() }. Call update() whenever
// the text may have changed; it re-renders only when the conflicts did.
const VERB = { ours: 'kept current', theirs: 'kept incoming', both: 'kept both sides', edited: 'edited by hand' };
export function mergeView(o) {
  const el = document.createElement('div');
  el.className = 'mg';
  el.hidden = true;
  const nums = new Map(); // block text -> conflict number, stable while others resolve
  let prev = null, sig = '', mine = null, editing = -1;
  const log = [], undo = [];

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, cls, fn, title) => { const b = h('button', cls, label); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; };
  const lineOf = (text, at) => text.slice(0, at).split('\n').length;
  const lines = (s) => (s ? s.replace(/\r?\n$/, '').split(/\r?\n/) : []);

  function act(c, how, custom) {
    const t = o.text();
    undo.push(t); if (undo.length > 30) undo.shift();
    mine = { n: nums.get(t.slice(c.start, c.end)), how };
    editing = -1;
    o.set(custom == null ? resolve(t, c, how) : t.slice(0, c.start) + custom + (custom && !custom.endsWith('\n') && c.end < t.length ? '\n' : '') + t.slice(c.end));
  }

  // code renders one side of a conflict, marking what differs from the other.
  function code(own, other, isOurs) {
    const pre = h('div', 'mg-code');
    if (!own.length) { pre.append(h('div', 'mg-empty', 'Nothing here: this side deletes these lines.')); return pre; }
    const ops = isOurs ? myers(own, other, 400) : myers(other, own, 400);
    const del = [], ins = [], hot = new Map();
    const flush = () => { for (let k = 0; k < Math.max(del.length, ins.length); k++) { const a = del[k], b = ins[k]; const w = a != null && b != null ? words(own[isOurs ? a : b], other[isOurs ? b : a]) : null; const at = isOurs ? a : b; if (at != null) hot.set(at, w ? w[0] : true); } del.length = ins.length = 0; };
    for (const [op, i, j] of ops) { if (op === '=') { flush(); continue; } (op === '-' ? del : ins).push(op === '-' ? i : j); }
    flush();
    const lang = o.lang();
    const paint = (s) => (lang ? highlight(s, lang) : s);
    own.forEach((line, i) => {
      const row = h('div', 'mg-line');
      const m = hot.get(i);
      if (m) row.classList.add('hot');
      if (Array.isArray(m)) for (const [s, on] of m) { if (on) { const k = h('mark'); k.append(paint(s)); row.append(k); } else row.append(paint(s)); }
      else row.append(paint(line));
      if (!line) row.append('​');
      pre.append(row);
    });
    return pre;
  }

  function card(t, c, n, i, edit) {
    const sec = h('section', 'mg-card');
    sec.dataset.n = n;
    const head = h('header', 'mg-card-head');
    head.append(h('b', '', `Conflict ${n}`), h('span', 'muted', `line ${lineOf(t, c.start)}`));
    sec.append(head);
    // Two lines either side, stopping at a neighbouring conflict's markers.
    const near = (ls) => { const k = ls.findIndex((l) => markerRe.test(l.replace(/\r$/, ''))); return k < 0 ? ls : ls.slice(0, k); };
    const before = near(t.slice(0, c.start).replace(/\n$/, '').split('\n').slice(-2).reverse()).reverse().join('\n');
    const after = near(t.slice(c.end).split('\n').slice(0, 2)).join('\n');
    if (before.trim()) sec.append(h('pre', 'mg-ctx', before));
    const ours = lines(t.slice(...c.ours)), theirs = lines(t.slice(...c.theirs));
    if (editing === i && edit) {
      const ta = h('textarea', 'mg-edit');
      ta.spellcheck = false; ta.wrap = 'off';
      ta.value = [...ours, ...theirs].join('\n');
      ta.rows = Math.min(16, ours.length + theirs.length + 1);
      ta.setAttribute('aria-label', `Your version of conflict ${n}`);
      const bar = h('div', 'mg-acts');
      bar.append(btn('Use this', 'primary sm', () => act(c, 'edited', ta.value)), btn('Cancel', 'ghost sm', () => { editing = -1; render(true); }));
      sec.append(h('p', 'muted small', 'Write the final version of these lines. Both sides are filled in to start from.'), ta, bar);
      setTimeout(() => ta.focus(), 0);
    } else {
      const cols = h('div', 'mg-cols');
      for (const [side, own, other, label, name, how] of [['ours', ours, theirs, 'Current', c.oursName, 'ours'], ['theirs', theirs, ours, 'Incoming', c.theirsName, 'theirs']]) {
        const col = h('div', `mg-col ${side}`);
        const ch = h('div', 'mg-col-head');
        ch.append(h('b', '', label));
        if (name) ch.append(h('code', '', name));
        col.append(ch, code(own, other, side === 'ours'));
        if (edit) col.append(btn(`Keep ${label.toLowerCase()}`, 'sm mg-keep', () => act(c, how)));
        cols.append(col);
      }
      sec.append(cols);
      if (edit) {
        const bar = h('div', 'mg-acts');
        bar.append(btn('Keep both', 'ghost sm', () => act(c, 'both'), 'Current first, then incoming'), btn('Edit by hand', 'ghost sm', () => { editing = i; render(true); }));
        sec.append(bar);
      }
    }
    if (after.trim()) sec.append(h('pre', 'mg-ctx', after));
    return sec;
  }

  function render(force) {
    const t = o.text(), list = conflicts(t), edit = o.canEdit();
    for (const c of list) { const k = t.slice(c.start, c.end); if (!nums.has(k)) nums.set(k, nums.size + 1); }
    const next = list.map((c) => t.slice(c.start, c.end)).join('\u0000') + edit + o.lang() + log.length + undo.length;
    if (!force && next === sig) return;
    sig = next;
    const total = nums.size, done = total - list.length;
    el.hidden = !total;
    if (!total) return el.replaceChildren();
    const head = h('div', 'mg-head');
    const title = h('div', 'mg-title');
    title.append(h('b', '', list.length ? `${done} of ${total} resolved` : `✓ All ${total} ${total === 1 ? 'conflict' : 'conflicts'} resolved`));
    if (list.length && !edit) title.append(h('span', 'muted small', `${o.who()} is resolving. Ask for the pen to help.`));
    const bar = h('div', 'mg-prog'), fill = h('span');
    fill.style.width = `${(done / total) * 100}%`;
    bar.append(fill);
    head.append(title, bar);
    if (edit && undo.length) head.append(btn('Undo', 'ghost sm mg-undo', () => { mine = { undo: true }; editing = -1; o.set(undo.pop()); }));
    const parts = [head];
    if (log.length) { const ul = h('ul', 'mg-log'); for (const s of log.slice(-3)) ul.append(h('li', '', s)); parts.push(ul); }
    list.forEach((c, i) => parts.push(card(t, c, nums.get(t.slice(c.start, c.end)), i, edit)));
    if (!list.length) parts.push(h('p', 'mg-done', 'The result below has no conflict markers left. Copy it back into your project.'));
    el.replaceChildren(...parts);
    el.classList.toggle('done', !list.length);
  }

  function update() {
    const t = o.text();
    if (prev !== null && t !== prev) {
      if (mine?.undo) log.push('You undid the last choice.');
      else {
        const r = howOf(prev, t);
        if (r) {
          const n = mine?.n ?? nums.get(prev.slice(r.c.start, r.c.end));
          const line = `${mine ? 'You' : o.who()} ${VERB[r.how]} on conflict ${n}.`;
          log.push(line);
          if (!mine) o.onRemote?.(line);
        }
      }
      mine = null;
    }
    prev = t;
    render();
  }
  return { el, update, reset() { nums.clear(); log.length = undo.length = 0; prev = null; sig = ''; editing = -1; } };
}
