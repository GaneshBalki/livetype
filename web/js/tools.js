// /tools/{slug}: builds the tool named by #tool[data-tool]. Logic lives in
// toolcore.js; this file is only the UI. Nothing is sent to the server except
// "Share live", which starts a normal session.
import { $, toast, copy } from './common.js';
import { codeView, paint, codeHtml } from './code.js';
import { jsonFormat, b64encode, b64decode, urlEncode, urlDecode, urlParts, jwtDecode, parseTime, relative, regexRun, CASES, convertCase, textStats, mdToHtml, HASHES, hashText, uuid7, uuidInfo } from './toolcore.js';

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

  regex() {
    const s = { pattern: '\\b(\\w+)@(\\w+)\\.com\\b', flags: 'g', text: 'Write to asha@example.com or ravi@devshire.com', repl: '', ...saved };
    const pat = h('input', 'tl-field tl-mono'); pat.value = s.pattern; pat.spellcheck = false; pat.placeholder = 'Pattern, without slashes';
    const flagBox = h('span', 'tl-opts');
    for (const [f, label] of [['g', 'g: all'], ['i', 'i: ignore case'], ['m', 'm: multiline'], ['s', 's: dot all'], ['u', 'u: unicode']]) {
      flagBox.append(check(label, s.flags.includes(f), (on) => { s.flags = on ? s.flags + f : s.flags.replace(f, ''); run(); }));
    }
    const input = area('Text to test', 8); input.value = s.text;
    const hl = h('pre', 'tl-pre tl-hl');
    const list = h('div');
    const repl = h('input', 'tl-field tl-mono'); repl.value = s.repl; repl.placeholder = 'Replace with, e.g. $2: $1 (optional)';
    const replOut = out();
    const stat = h('span', 'muted small tl-stat');
    const run = () => {
      Object.assign(s, { pattern: pat.value, text: input.value, repl: repl.value }); save(s);
      list.replaceChildren(); hl.replaceChildren();
      if (!s.pattern) { stat.textContent = ''; hl.textContent = s.text; return replOut.empty('Type a pattern above.'); }
      const r = regexRun(s.pattern, s.flags, s.text, s.repl || null);
      if (r.error) { stat.textContent = r.error; stat.className = 'small tl-stat bad'; hl.textContent = s.text; return replOut.empty(''); }
      stat.textContent = r.matches.length ? `${r.matches.length}${r.capped ? '+' : ''} match${r.matches.length === 1 ? '' : 'es'}` : 'No match';
      stat.className = 'small tl-stat ' + (r.matches.length ? 'ok' : 'muted');
      let at = 0;
      for (const m of r.matches) { hl.append(s.text.slice(at, m.index), h('mark', '', m.text)); at = m.index + m.text.length; }
      hl.append(s.text.slice(at));
      const found = r.matches.slice(0, 200).map((m, i) => [`Match ${i + 1} at ${m.index}`, m.text,
        [...m.groups.map((g, j) => `$${j + 1}=${g ?? '–'}`), ...Object.entries(m.named || {}).map(([k, v]) => `${k}=${v ?? '–'}`)].join('  ')]);
      if (found.length) list.append(box('Matches', rows(found)));
      if (s.repl) replOut.set(r.replaced); else replOut.empty('Type a replacement above to preview it.');
    };
    for (const e of [pat, input, repl]) e.addEventListener('input', debounce(run));
    root.append(
      bar(h('label', 'tl-field-wrap', h('span', 'tl-box-title', 'Pattern'), pat), stat),
      bar(flagBox),
      h('div', 'tl-two', box('Text', input), box('Highlighted', hl)),
      list,
      bar(h('label', 'tl-field-wrap', h('span', 'tl-box-title', 'Replace'), repl)),
      box('After replace', replOut.el, copyBtn(() => replOut.text)),
    );
    run();
  },

  case() {
    const s = { text: 'user account id\nHTTPServerError', ...saved };
    const input = area('Type or paste text (one item per line)', 6); input.value = s.text;
    const res = h('div');
    const run = () => {
      s.text = input.value; save(s);
      res.replaceChildren(s.text.trim() ? rows(Object.keys(CASES).map((k) => [CASES[k][0], convertCase(s.text, k)])) : h('p', 'muted tl-empty', 'Every case appears here.'));
    };
    input.addEventListener('input', debounce(run));
    root.append(box('Input', input, button('Clear', () => { input.value = ''; run(); input.focus(); })), box('Converted', res));
    run();
  },

  words() {
    const s = { text: '', ...saved };
    const input = area('Type or paste your text', 12); input.value = s.text;
    const grid = h('div', 'tl-stats');
    const top = h('div');
    const mins = (m) => (m < 1 ? `${Math.round(m * 60)} sec` : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} sec`);
    const run = () => {
      s.text = input.value; save(s);
      const t = textStats(s.text);
      grid.replaceChildren(...[['Words', t.words], ['Characters', t.chars], ['Without spaces', t.noSpaces], ['Sentences', t.sentences],
        ['Paragraphs', t.paragraphs], ['Lines', t.lines], ['Reading time', mins(t.readMin)], ['Speaking time', mins(t.speakMin)]]
        .map(([k, v]) => h('div', 'tl-stat-box', h('b', '', typeof v === 'number' ? v.toLocaleString() : v), h('span', 'muted small', k))));
      top.replaceChildren();
      if (t.top.length) top.append(box('Most used words (4+ letters)', rows(t.top.map(([w, n]) => [w, `${n}×`]))));
    };
    input.addEventListener('input', debounce(run, 80));
    root.append(grid, box('Text', input, button('Clear', () => { input.value = ''; run(); input.focus(); })), top);
    run();
  },

  markdown() {
    const s = { text: EXAMPLE_MD, ...saved };
    const input = area('Write Markdown', 20); input.value = s.text;
    const view = h('div', 'tl-md');
    let html = '';
    const run = () => {
      s.text = input.value; save(s);
      html = mdToHtml(s.text);
      // Safe: mdToHtml escapes every character of the input before adding its own tags.
      view.innerHTML = html || '<p class="muted">The preview appears here.</p>';
    };
    input.addEventListener('input', debounce(run, 80));
    root.append(
      bar(grow(), button('Clear', () => { input.value = ''; run(); input.focus(); }), shareBtn('markdown', () => input.value)),
      h('div', 'tl-two', box('Markdown', input, copyBtn(() => input.value)), box('Preview', view, h('span', 'muted small', 'HTML'), copyBtn(() => html))),
    );
    run();
  },

  hash() {
    const s = { text: '', expect: '', ...saved };
    const input = area('Type or paste text to hash', 6); input.value = s.text;
    const exp = h('input', 'tl-field tl-mono'); exp.value = s.expect; exp.placeholder = 'Optional: paste a hash to compare'; exp.spellcheck = false;
    const res = h('div');
    let n = 0;
    const run = async () => {
      s.text = input.value; s.expect = exp.value.trim().toLowerCase(); save(s);
      const my = ++n;
      const list = await Promise.all(HASHES.map(async (a) => [a, await hashText(s.text, a)]));
      if (my !== n) return;
      const t = rows(list);
      if (s.expect) [...t.children].forEach((r, i) => r.classList.add(list[i][1] === s.expect ? 'match' : 'nomatch'));
      res.replaceChildren(box(s.text ? 'Hashes (UTF-8)' : 'Hashes of empty text', t));
      if (s.expect && !list.some(([, v]) => v === s.expect)) res.append(h('p', 'tl-err', 'No hash matches the one you pasted.'));
    };
    input.addEventListener('input', debounce(run));
    exp.addEventListener('input', debounce(run));
    root.append(box('Text', input, button('Clear', () => { input.value = ''; run(); input.focus(); })),
      bar(h('label', 'tl-field-wrap', h('span', 'tl-box-title', 'Compare with'), exp)), res);
    run();
  },

  uuid() {
    const s = { ver: '4', count: 5, upper: false, hyphens: true, check: '', ...saved };
    const o = out();
    const count = h('input', 'tl-field tl-num'); count.type = 'number'; count.min = 1; count.max = 1000; count.value = s.count;
    const gen = () => {
      s.count = Math.min(1000, Math.max(1, parseInt(count.value, 10) || 1)); count.value = s.count; save(s);
      const list = Array.from({ length: s.count }, () => {
        let u = s.ver === '7' ? uuid7() : crypto.randomUUID();
        if (!s.hyphens) u = u.replace(/-/g, '');
        return s.upper ? u.toUpperCase() : u;
      });
      o.set(list.join('\n'));
    };
    const chk = h('input', 'tl-field tl-mono'); chk.value = s.check; chk.placeholder = 'Paste a UUID to inspect'; chk.spellcheck = false;
    const info = h('div');
    const inspect = () => {
      s.check = chk.value; save(s);
      if (!s.check.trim()) return info.replaceChildren();
      const r = uuidInfo(s.check);
      if (!r) return info.replaceChildren(h('p', 'tl-err', 'This is not a UUID (32 hex digits, usually in 8-4-4-4-12 groups).'));
      const list = [['Version', r.nil ? 'Nil UUID (all zeros)' : r.max ? 'Max UUID (all ones)' : `v${r.version}`]];
      if (r.date) list.push(['Created', r.date.toISOString(), relative(r.date)]);
      info.replaceChildren(rows(list));
    };
    count.addEventListener('change', gen);
    chk.addEventListener('input', debounce(inspect));
    root.append(
      bar(seg([['4', 'v4 random'], ['7', 'v7 time-ordered']], s.ver, (v) => { s.ver = v; gen(); }, 'Version'),
        h('label', 'opt', 'How many ', count), check('Upper case', s.upper, (v) => { s.upper = v; gen(); }),
        check('Hyphens', s.hyphens, (v) => { s.hyphens = v; gen(); }), grow(), button('Generate again', gen, 'primary sm')),
      box('UUIDs', o.el, copyBtn(() => o.text)),
      box('Inspect a UUID', h('div', 'tl-pad', chk, info)),
    );
    gen(); inspect();
  },
};

const size = (t) => { const b = new TextEncoder().encode(t).length; return b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`; };

const EXAMPLE_JSON = '{"order":{"id":"A-1042","placed":"2026-11-27T10:15:00Z","items":[{"sku":"TEA-01","qty":2,"price":249},{"sku":"MUG-07","qty":1,"price":399}],"paid":true,"coupon":null}}';
const EXAMPLE_MD = '# Release notes\n\nVersion **4.5** adds six tools. See [all tools](https://devshire.in/tools).\n\n- [x] Regex tester\n- [x] Markdown preview\n- [ ] Something next\n\n| Tool | Runs in |\n|---|---|\n| Hash | your browser |\n\n> Nothing is uploaded.\n\n```js\nconst id = crypto.randomUUID();\n```\n';
const EXAMPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzQyIiwibmFtZSI6IkFzaGEiLCJyb2xlIjoiZWRpdG9yIiwiaWF0IjoxNzY0MjI0MDAwLCJleHAiOjE3NjQyMjc2MDB9.2kBmmLd6Gx8h8cB7cxJ2yr6t3rM1XYk8q1Yx2n8Jt0Q';

if (TOOLS[id]) {
  root.replaceChildren();
  TOOLS[id]();
}
