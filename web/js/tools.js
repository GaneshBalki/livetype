// /tools/{slug}: builds the tool named by #tool[data-tool]. Logic lives in
// toolcore.js; this file is only the UI. Nothing is sent to the server except
// "Share live", which starts a normal session.
import { $, toast, copy } from './common.js';
import { codeView, paint, codeHtml } from './code.js';
import { jsonFormat, b64encode, b64decode, urlEncode, urlDecode, urlParts, jwtDecode, parseTime, relative } from './toolcore.js';

const root = $('tool');
const id = root.dataset.tool;
const SEED_MAX = 190_000;
const KEY = 'devshire-tool-' + id;

// ---- small DOM helpers ----
function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function button(label, fn, cls = 'ghost sm') {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
// box: a panel with a small capital title, an optional right-hand slot, and a body.
function box(title, body, ...right) {
  const head = h('div', 'tl-box-head', h('span', 'tl-box-title', title), h('span', 'tl-box-right', ...right));
  return h('section', 'tl-box', head, body);
}
function area(placeholder, rows = 10) {
  const t = h('textarea', 'tl-input');
  t.placeholder = placeholder;
  t.rows = rows;
  t.spellcheck = false;
  t.setAttribute('autocapitalize', 'off');
  t.setAttribute('autocomplete', 'off');
  return t;
}
function seg(options, value, onChange, label) {
  const g = h('div', 'seg');
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const b = button(text, () => { for (const x of g.children) x.setAttribute('aria-pressed', String(x === b)); onChange(v); }, '');
    b.setAttribute('aria-pressed', String(v === value));
    g.append(b);
  }
  return g;
}
function check(label, on, onChange) {
  const i = h('input');
  i.type = 'checkbox';
  i.checked = on;
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', 'check', i, ' ' + label);
}
const copyBtn = (get) => button('Copy', () => { const t = get(); if (t) copy(t); else toast('Nothing to copy yet.'); }, 'ghost sm');
const bar = (...kids) => h('div', 'diff-bar tl-bar', ...kids);
const grow = () => h('span', 'tl-grow');

// out: a read-only result area. JSON gets colours; errors are shown in red.
function out(lang) {
  const wrap = h('div', 'tl-out');
  let view = null, text = '';
  return {
    el: wrap,
    get text() { return text; },
    set(t) {
      text = t;
      if (lang) {
        if (!view) { view = codeView(lang, t); wrap.replaceChildren(view); } else paint(view, lang, t);
      } else wrap.replaceChildren(h('pre', 'tl-pre', t));
      wrap.classList.remove('err');
    },
    error(msg) { text = ''; view = null; wrap.replaceChildren(h('p', 'tl-err', msg)); wrap.classList.add('err'); },
    empty(msg) { text = ''; view = null; wrap.replaceChildren(h('p', 'muted tl-empty', msg)); wrap.classList.remove('err'); },
  };
}
// rows: label / value table with a copy button on each row.
function rows(list) {
  const t = h('div', 'tl-rows');
  for (const [label, value, note] of list) {
    const v = h('code', '', value);
    const r = h('div', 'tl-row', h('span', 'tl-row-label', label), h('span', 'tl-row-val', v, note ? h('span', 'muted small', ' ' + note) : null));
    if (value) r.append(button('Copy', () => copy(value), 'ghost sm tl-row-copy'));
    t.append(r);
  }
  return t;
}

// ---- saved state (per tab) ----
const saved = (() => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } })();
const save = (s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full or blocked */ } };
const debounce = (fn, ms = 150) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

// ---- Share live: open a session with this text ----
// ponytail: same flow as startSession in diff.js; move both into common.js when a third page needs it.
async function shareLive(lang, text, btn) {
  if (!text.trim()) return toast('Nothing to share yet.');
  const html = codeHtml(lang, text);
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
const shareBtn = (lang, get) => {
  const b = button('Share live', () => shareLive(lang, get(), b), 'primary sm');
  b.title = 'Start a live session with this and share the link';
  return b;
};

// ---- the tools ----
const TOOLS = {
  json() {
    const s = { text: '', indent: '2', minify: false, sort: false, ...saved };
    const input = area('Paste JSON here', 14);
    input.value = s.text;
    const o = out('json');
    const stat = h('span', 'muted small tl-stat');
    const run = () => {
      s.text = input.value; save(s);
      if (!s.text.trim()) { stat.textContent = ''; return o.empty('Formatted JSON appears here.'); }
      const r = jsonFormat(s.text, { indent: s.indent, minify: s.minify, sort: s.sort });
      if (r.error) { stat.textContent = 'Invalid'; stat.className = 'small tl-stat bad'; return o.error(r.line ? `Line ${r.line}, column ${r.col}: ${r.error}` : r.error); }
      stat.textContent = `Valid · ${size(s.text)} → ${size(r.out)}`; stat.className = 'muted small tl-stat ok';
      o.set(r.out);
    };
    const ind = h('select');
    for (const [v, t] of [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tabs']]) ind.append(new Option(t, v));
    ind.value = s.indent;
    ind.addEventListener('change', () => { s.indent = ind.value; run(); });
    input.addEventListener('input', debounce(run));
    root.append(
      bar(seg([[false, 'Format'], [true, 'Minify']], s.minify, (v) => { s.minify = v; run(); }, 'Output style'),
        h('label', 'opt', 'Indent ', ind), check('Sort keys', s.sort, (v) => { s.sort = v; run(); }), grow(),
        button('Example', () => { input.value = EXAMPLE_JSON; run(); }), button('Clear', () => { input.value = ''; run(); input.focus(); }),
        shareBtn('json', () => o.text || input.value)),
      h('div', 'tl-two', box('Input', input), box('Output', o.el, stat, copyBtn(() => o.text))),
    );
    run();
  },

  base64() {
    const s = { text: '', mode: 'encode', urlSafe: false, ...saved };
    const input = area('Type or paste text', 10);
    input.value = s.text;
    const o = out();
    const inBox = box('', input);
    const outBox = box('', o.el, copyBtn(() => o.text));
    const run = () => {
      s.text = input.value; save(s);
      inBox.querySelector('.tl-box-title').textContent = s.mode === 'encode' ? 'Text' : 'Base64';
      outBox.querySelector('.tl-box-title').textContent = s.mode === 'encode' ? 'Base64' : 'Text';
      input.placeholder = s.mode === 'encode' ? 'Type or paste text to encode' : 'Paste Base64 to decode';
      if (!s.text) return o.empty(s.mode === 'encode' ? 'Base64 appears here.' : 'Decoded text appears here.');
      try { o.set(s.mode === 'encode' ? b64encode(s.text, s.urlSafe) : b64decode(s.text)); } catch (e) { o.error(e.message); }
    };
    const modeSeg = seg([['encode', 'Encode'], ['decode', 'Decode']], s.mode, (v) => { s.mode = v; run(); }, 'Mode');
    input.addEventListener('input', debounce(run));
    root.append(
      bar(modeSeg, check('URL-safe', s.urlSafe, (v) => { s.urlSafe = v; run(); }), grow(),
        button('⇄ Swap', () => { if (!o.text) return; input.value = o.text; s.mode = s.mode === 'encode' ? 'decode' : 'encode'; modeSeg.children[s.mode === 'encode' ? 0 : 1].click(); }),
        button('Clear', () => { input.value = ''; run(); input.focus(); })),
      h('div', 'tl-two', inBox, outBox),
    );
    run();
  },

  url() {
    const s = { text: '', mode: 'encode', component: true, plus: false, ...saved };
    const input = area('Type or paste text or a URL', 6);
    input.value = s.text;
    const o = out();
    const parts = h('div');
    const run = () => {
      s.text = input.value; save(s);
      parts.replaceChildren();
      if (!s.text) return o.empty(s.mode === 'encode' ? 'Encoded text appears here.' : 'Decoded text appears here.');
      try { o.set(s.mode === 'encode' ? urlEncode(s.text, s.component) : urlDecode(s.text, s.plus)); } catch (e) { return o.error(e.message); }
      const p = urlParts(s.mode === 'encode' ? s.text : o.text);
      if (p) {
        const list = [['Protocol', p.protocol], ['Host', p.host], ['Path', p.path]];
        if (p.hash) list.push(['Fragment', p.hash]);
        parts.append(box('URL parts', rows(list)));
        if (p.params.length) parts.append(box(`Query parameters (${p.params.length})`, rows(p.params)));
      }
    };
    const opts = h('span', 'tl-opts');
    const showOpts = () => opts.replaceChildren(s.mode === 'encode'
      ? check('Encode everything (one value)', s.component, (v) => { s.component = v; run(); })
      : check('+ means space', s.plus, (v) => { s.plus = v; run(); }));
    input.addEventListener('input', debounce(run));
    root.append(
      bar(seg([['encode', 'Encode'], ['decode', 'Decode']], s.mode, (v) => { s.mode = v; showOpts(); run(); }, 'Mode'), opts, grow(),
        button('Clear', () => { input.value = ''; run(); input.focus(); })),
      box('Input', input), box('Output', o.el, copyBtn(() => o.text)), parts,
    );
    showOpts();
    run();
  },

  jwt() {
    const s = { text: '', ...saved };
    const input = area('Paste a token (eyJ...)', 5);
    input.value = s.text;
    const head = out('json'), pay = out('json');
    const claims = h('div');
    const msg = h('p', 'tl-note');
    msg.textContent = 'Decoded, not verified. Checking the signature needs the secret key, which should never leave your server.';
    const run = () => {
      s.text = input.value; save(s);
      claims.replaceChildren();
      if (!s.text.trim()) { head.empty('The header appears here.'); return pay.empty('The payload appears here.'); }
      let t;
      try { t = jwtDecode(s.text); } catch (e) { head.error(e.message); return pay.empty(''); }
      head.set(JSON.stringify(t.header, null, 2));
      pay.set(JSON.stringify(t.payload, null, 2));
      const list = [];
      const now = Date.now();
      for (const [k, label] of [['exp', 'Expires'], ['iat', 'Issued'], ['nbf', 'Not before']]) {
        if (typeof t.payload[k] !== 'number') continue;
        const d = new Date(t.payload[k] * 1000);
        let note = relative(d, now);
        if (k === 'exp') note = d < now ? `expired ${note}` : `valid, expires ${note}`;
        list.push([label, d.toLocaleString(), note]);
      }
      for (const [k, label] of [['iss', 'Issuer'], ['sub', 'Subject'], ['aud', 'Audience']]) if (t.payload[k] != null) list.push([label, String(t.payload[k])]);
      if (t.header.alg) list.push(['Algorithm', String(t.header.alg)]);
      if (list.length) claims.append(box('Claims', rows(list)));
      const exp = t.payload.exp;
      input.classList.toggle('expired', typeof exp === 'number' && exp * 1000 < now);
    };
    input.addEventListener('input', debounce(run));
    root.append(
      bar(button('Example', () => { input.value = EXAMPLE_JWT; run(); }), button('Clear', () => { input.value = ''; run(); input.focus(); }), grow(),
        shareBtn('json', () => (pay.text ? `// header\n${head.text}\n\n// payload\n${pay.text}` : ''))),
      box('Token', input), msg,
      h('div', 'tl-two', box('Header', head.el, copyBtn(() => head.text)), box('Payload', pay.el, copyBtn(() => pay.text))), claims,
    );
    run();
  },

  timestamp() {
    const s = { text: '', ...saved };
    const nowSec = h('code', 'tl-now-val'), nowMs = h('code', 'tl-now-val');
    const tick = () => { const n = Date.now(); nowSec.textContent = Math.floor(n / 1000); nowMs.textContent = n; };
    tick();
    setInterval(tick, 1000);
    const nowBox = h('div', 'tl-now',
      h('span', 'tl-now-item', h('span', 'muted small', 'Now, seconds'), nowSec, button('Copy', () => copy(nowSec.textContent))),
      h('span', 'tl-now-item', h('span', 'muted small', 'Milliseconds'), nowMs, button('Copy', () => copy(nowMs.textContent))));
    const input = h('input', 'tl-field');
    input.placeholder = 'e.g. 1764253800, 1764253800000 or 2026-11-27 14:30';
    input.value = s.text;
    input.spellcheck = false;
    const res = h('div');
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const run = () => {
      s.text = input.value; save(s);
      if (!s.text.trim()) return res.replaceChildren(h('p', 'muted tl-empty', 'Type a timestamp or a date above.'));
      const r = parseTime(s.text);
      if (!r) return res.replaceChildren(h('p', 'tl-err', 'Not a timestamp or a date this tool understands.'));
      const d = r.date, ms = d.getTime();
      res.replaceChildren(box(r.unit === 'date' ? 'Read as a date' : `Read as ${r.unit}`, rows([
        ['Unix seconds', String(Math.floor(ms / 1000))],
        ['Milliseconds', String(ms)],
        ['ISO 8601 (UTC)', d.toISOString()],
        ['UTC', d.toUTCString()],
        [`Local (${tz})`, d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })],
        ['Relative', relative(d)],
      ])));
    };
    input.addEventListener('input', debounce(run));
    root.append(nowBox,
      bar(h('label', 'tl-field-wrap', h('span', 'tl-box-title', 'Timestamp or date'), input), button('Use now', () => { input.value = String(Math.floor(Date.now() / 1000)); run(); })),
      res);
    run();
  },
};

const size = (t) => { const b = new TextEncoder().encode(t).length; return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`; };

const EXAMPLE_JSON = '{"order":{"id":"A-1042","placed":"2026-11-27T10:15:00Z","items":[{"sku":"TEA-01","qty":2,"price":249},{"sku":"MUG-07","qty":1,"price":399}],"paid":true,"coupon":null}}';
const EXAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzQyIiwibmFtZSI6IkFzaGEiLCJyb2xlIjoiZWRpdG9yIiwiaWF0IjoxNzY0MjI0MDAwLCJleHAiOjE3NjQyMjc2MDB9.2kBmmLd6Gx8h8cB7cxJ2yr6t3rM1XYk8q1Yx2n8Jt0Q';

if (TOOLS[id]) {
  root.replaceChildren();
  TOOLS[id]();
}
