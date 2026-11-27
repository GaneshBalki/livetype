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
