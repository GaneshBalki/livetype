// Pure logic for /tools (tested in web/test/tools.test.mjs). No DOM here.

// ---- JSON ----
// jsonFormat parses text and prints it back. Returns {out} or {error, line, col}.
export function jsonFormat(text, { indent = 2, minify = false, sort = false } = {}) {
  let v;
  try {
    v = JSON.parse(text);
  } catch (e) {
    const msg = String(e.message || e);
    const m = /position (\d+)/.exec(msg);
    let at = m ? +m[1] : -1;
    if (at < 0 && /end of (JSON|data) input/i.test(msg)) at = text.length;
    const line = at < 0 ? 0 : text.slice(0, at).split('\n').length;
    const col = at < 0 ? 0 : at - text.lastIndexOf('\n', at - 1);
    return { error: msg.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '').replace(/^Unexpected/, 'Unexpected'), line, col };
  }
  if (sort) v = sortKeys(v);
  return { out: minify ? JSON.stringify(v) : JSON.stringify(v, null, indent === 'tab' ? '\t' : +indent) };
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

// ---- Base64 (UTF-8) ----
export function b64encode(text, urlSafe = false) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const s = btoa(bin);
  return urlSafe ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
}
// b64bytes turns Base64 (standard or URL-safe, any padding/whitespace) into bytes, or throws.
export function b64bytes(s) {
  let t = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (/[^A-Za-z0-9+/=]/.test(t)) throw new Error('This has characters that are not Base64.');
  t = t.replace(/=+$/, '');
  if (t.length % 4 === 1) throw new Error('This Base64 is cut short (wrong length).');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64decode(s) {
  const bytes = b64bytes(s);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Decoded ${bytes.length} bytes, but they are not text (binary data, such as an image or a file).`);
  }
}

// ---- URL ----
export const urlEncode = (s, component = true) => (component ? encodeURIComponent(s) : encodeURI(s));
export function urlDecode(s, plus = false) {
  try {
    return decodeURIComponent(plus ? s.replace(/\+/g, ' ') : s);
  } catch {
    throw new Error('This has a broken % sequence (a % must be followed by two hex digits, like %20).');
  }
}
// urlParts splits a full URL, or returns null if s isn't one.
export function urlParts(s) {
  const t = s.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null;
  let u;
  try { u = new URL(t); } catch { return null; }
  return {
    protocol: u.protocol.replace(/:$/, ''),
    host: u.host,
    path: decodeSafe(u.pathname),
    hash: decodeSafe(u.hash.slice(1)),
    params: [...u.searchParams],
  };
}
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// ---- JWT ----
// jwtDecode returns {header, payload, signature} or throws with a plain message.
export function jwtDecode(token) {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) throw new Error('A JWT has three parts separated by dots: header.payload.signature');
  const part = (p, name) => {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b64bytes(p)); } catch { throw new Error(`The ${name} is not valid Base64.`); }
    try { return JSON.parse(text); } catch { throw new Error(`The ${name} is not valid JSON.`); }
  };
  return { header: part(parts[0], 'header'), payload: part(parts[1], 'payload'), signature: parts[2] || '' };
}

// ---- Time ----
// parseTime reads a Unix timestamp (unit from digit count) or a date string.
// Returns {date, unit} or null.
export function parseTime(s) {
  const t = s.trim();
  if (!t) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    const digits = t.replace(/^-/, '').split('.')[0].length;
    const [unit, ms] = digits <= 11 ? ['seconds', n * 1000] : digits <= 14 ? ['milliseconds', n] : digits <= 17 ? ['microseconds', n / 1e3] : ['nanoseconds', n / 1e6];
    const date = new Date(ms);
    return isNaN(date) ? null : { date, unit };
  }
  // "2026-11-27 14:30" isn't ISO everywhere; make the space a T.
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') : t);
  return isNaN(date) ? null : { date, unit: 'date' };
}
// relative says how far date is from now: "3 days ago", "in 2 hours".
export function relative(date, now = Date.now()) {
  const sec = Math.round((date - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(sec) >= size) return rtf.format(Math.trunc(sec / size), unit);
  }
  return rtf.format(sec, 'second');
}

// ---- Regex ----
// regexRun returns {matches:[{index,text,groups}], replaced?, capped} or {error}.
// ponytail: runs on the main thread, so a catastrophic pattern can freeze the tab; move to a Worker with a timeout if users hit it.
export function regexRun(pattern, flags, text, replacement, max = 1000) {
  let re;
  try { re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g'); } catch (e) { return { error: String(e.message).replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, '') }; }
  const matches = [];
  let capped = false;
  for (const m of text.matchAll(re)) {
    if (matches.length >= max) { capped = true; break; }
    matches.push({ index: m.index, text: m[0], groups: m.slice(1), named: m.groups || null });
    if (!flags.includes('g')) break;
  }
  const out = { matches, capped };
  if (replacement != null) out.replaced = text.replace(new RegExp(pattern, flags), replacement);
  return out;
}

// ---- Case ----
// splitWords breaks "helloWorld", "hello_world", "Hello-World", "HTTPServer" into words.
export function splitWords(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
export const CASES = {
  camel: ['camelCase', (w) => w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join('')],
  pascal: ['PascalCase', (w) => w.map(cap).join('')],
  snake: ['snake_case', (w) => w.map((x) => x.toLowerCase()).join('_')],
  constant: ['CONSTANT_CASE', (w) => w.map((x) => x.toUpperCase()).join('_')],
  kebab: ['kebab-case', (w) => w.map((x) => x.toLowerCase()).join('-')],
  dot: ['dot.case', (w) => w.map((x) => x.toLowerCase()).join('.')],
  title: ['Title Case', (w) => w.map(cap).join(' ')],
  sentence: ['Sentence case', (w) => cap(w.join(' '))],
  lower: ['lower case', (w) => w.join(' ').toLowerCase()],
  upper: ['UPPER CASE', (w) => w.join(' ').toUpperCase()],
};
// convertCase converts each line separately so lists of names keep working.
export const convertCase = (s, kind) => s.split('\n').map((l) => CASES[kind][1](splitWords(l))).join('\n');

// ---- Word counter ----
export function textStats(s) {
  const words = s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const freq = new Map();
  for (const w of words) { const k = w.toLowerCase(); if (k.length > 3) freq.set(k, (freq.get(k) || 0) + 1); }
  return {
    chars: [...s].length,
    noSpaces: [...s.replace(/\s/g, '')].length,
    words: words.length,
    sentences: (s.match(/[^.!?\s][^.!?]*(?:[.!?]+|$)/g) || []).length,
    paragraphs: s.split(/\n\s*\n/).filter((p) => p.trim()).length,
    lines: s ? s.split('\n').length : 0,
    readMin: words.length / 200,
    speakMin: words.length / 130,
    top: [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
  };
}

// ---- Markdown ----
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// inline works on already-escaped text. Links only allow http(s), mailto, # and relative paths.
function inline(t) {
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => (safeUrl(u) ? `<img alt="${alt}" src="${u}">` : m));
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u) => (safeUrl(u) ? `<a href="${u}" rel="noopener noreferrer nofollow" target="_blank">${txt}</a>` : m));
  t = t.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  t = t.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)|(^|\W)_(?!\s)(.+?)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`);
  t = t.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
const safeUrl = (u) => /^(https?:\/\/|mailto:|#|\/(?!\/)|\.{0,2}\/)/i.test(u.replace(/&amp;/g, '&')) || /^[\w.-]+(\/|$)/.test(u);
// mdToHtml renders a safe subset of Markdown: every input character is escaped first.
export function mdToHtml(src) {
  const lines = esc(src.replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = /^(```|~~~)\s*([\w+-]*)/.exec(l))) {
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith(m[1]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code${m[2] ? ` class="lang-${m[2]}"` : ''}>${body.join('\n')}</code></pre>`);
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++;
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('<hr>'); i++;
    } else if (/^&gt;/.test(l)) {
      const body = [];
      for (; i < lines.length && /^&gt;/.test(lines[i]); i++) body.push(lines[i].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${mdToHtml(body.join('\n').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))}</blockquote>`);
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) {
        let t = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = /^\[([ xX])\]\s+/.exec(t);
        if (task) t = `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ` + inline(t.slice(task[0].length));
        else t = inline(t);
        items.push(`<li>${t}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(l);
      i += 2;
      const rows = [];
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(`<tr>${cells(lines[i]).map((c) => `<td>${c}</td>`).join('')}</tr>`);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|~~~|&gt;|\s*([-*+]|\d+[.)])\s)/.test(lines[i]); i++) para.push(lines[i]);
      if (!para.length) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

// ---- Hash ----
export const HASHES = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
export async function hashText(text, algo) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- UUID ----
// uuid7: time-ordered (RFC 9562): 48-bit ms timestamp, then random bits.
export function uuid7(now = Date.now()) {
  const b = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
// uuidInfo reads a UUID's version, and the time for v1/v7. Returns null if s isn't a UUID.
export function uuidInfo(s) {
  const h = s.trim().replace(/^urn:uuid:|[{}]/gi, '').toLowerCase();
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(h)) return null;
  const x = h.replace(/-/g, '');
  const version = parseInt(x[12], 16);
  const info = { version, nil: /^0+$/.test(x), max: /^f+$/.test(x) };
  if (version === 7) info.date = new Date(parseInt(x.slice(0, 12), 16));
  if (version === 1) info.date = new Date(Number((BigInt('0x' + x.slice(13, 16) + x.slice(8, 12) + x.slice(0, 8)) - 122192928000000000n) / 10000n));
  return info;
}
