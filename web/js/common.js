// Shared by the host and viewer pages: DOM helpers, a reconnecting websocket
// and the editor sync used by whoever holds the pen.

import { render } from './sanitize.js';
import { LANGS, parseCode, codeHtml, codeView, codeInput, paint } from './code.js';
export { render };

export const $ = (id) => document.getElementById(id);
export const roomId = decodeURIComponent(location.pathname.split('/')[2] || '');

const MAX_MESSAGE_BYTES = 256 * 1024;
const SEND_EVERY_MS = 50;

// connect sends hello() on every (re)connect and retries with backoff
// 1s, 2s, 4s ... 15s. Close codes 4000-4999 mean the session is over.
export function connect({ hello, onMessage, onStatus }) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${encodeURIComponent(roomId)}`;
  let ws;
  let delay = 1000;

  function open() {
    ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify(hello()));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'welcome') {
        delay = 1000;
        onStatus('live');
      }
      onMessage(m);
    };
    ws.onclose = (e) => {
      if (e.code >= 4000 && e.code < 5000) {
        onStatus('ended', e.reason || 'This session has ended.');
        return;
      }
      onStatus('reconnecting');
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  }
  open();

  return {
    send(msg) {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return true;
    },
  };
}

// makeEditor syncs a contenteditable element with the server. Typing sends the
// whole HTML at most every 50 ms, and always sends the final state. Snapshots
// never touch the element while we hold the pen, so the cursor does not jump.
export function makeEditor(el, conn, onTooLarge) {
  let writable = false;
  let known = ''; // the text the server has, as far as we know
  let timer = null;
  let lang = ''; // set while the document is code
  const input = codeInput();

  const read = () => (lang ? codeHtml(lang, input.value) : el.innerHTML);

  // show displays html; while writable, code gets the editable textarea.
  function show(html) {
    const code = parseCode(html);
    lang = code ? code.lang : '';
    el.contentEditable = writable && !lang;
    el.classList.toggle('has-code', !!lang);
    if (lang && writable) {
      input.value = code.code;
      el.replaceChildren(codeView(lang, code.code, input));
    } else {
      render(el, html);
    }
    api.onMode?.(lang);
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    const text = read();
    if (!writable || text === known) return;
    const msg = JSON.stringify({ type: 'update', text });
    if (new Blob([msg]).size > MAX_MESSAGE_BYTES) {
      onTooLarge();
      return;
    }
    if (conn.send(msg)) known = text;
  }
  const schedule = () => {
    if (writable && !timer) timer = setTimeout(flush, SEND_EVERY_MS);
  };

  // Pasted content arrives as plain text so foreign markup never enters the doc.
  el.addEventListener('paste', (e) => {
    if (e.target === input) return; // a textarea pastes plain text already
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });

  el.addEventListener('input', schedule);
  input.addEventListener('input', () => paint(el.querySelector('.code'), lang, input.value)); // bubbles to el, which sends it

  const api = {
    flush,
    get writable() { return writable; },
    get text() { return writable ? read() : known; },
    get lang() { return lang; },

    // After a reconnect, keep local edits if we held the pen before and still
    // do: nobody else can have written in between, so ours are the newest.
    welcome(text, canWrite) {
      const keep = writable && canWrite;
      writable = canWrite;
      known = text;
      if (keep) flush();
      else show(text);
    },

    snapshot(text) {
      known = text;
      if (!writable) show(text);
    },

    // A change of writer replaces the editor with the server's text.
    setWritable(canWrite) {
      if (canWrite === writable) return;
      clearTimeout(timer);
      timer = null;
      writable = canWrite;
      show(known);
    },

    // setMode switches the writer's document between rich text ('') and a
    // code language. The text is kept; formatting is dropped going to code.
    setMode(next) {
      if (!writable || next === lang) return;
      const plain = lang ? input.value : el.innerText.replace(/\n$/, '');
      if (next) {
        show(codeHtml(next, plain));
      } else {
        show('');
        el.textContent = plain;
      }
      flush();
      (lang ? input : el).focus();
    },
  };
  return api;
}

let toastTimer;
export function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

export function copy(text) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard.'),
    () => toast('Copy failed. Select the text and copy it manually.'),
  );
}

export function setStatus(state, label) {
  const el = $('status');
  el.dataset.state = state;
  el.textContent = label;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------- formatting toolbar ----------

const FONTS = ['Monospace', 'System UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'];
const FONT_STACKS = { Monospace: 'ui-monospace, Menlo, Consolas, monospace', 'System UI': 'system-ui, sans-serif' };
// execCommand('fontSize') only takes levels 1-7; these are their pixel sizes.
const SIZES = [10, 13, 16, 18, 24, 32, 48];
const CASES = {
  'Sentence case.': (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()),
  lowercase: (t) => t.toLowerCase(),
  UPPERCASE: (t) => t.toUpperCase(),
  'Capitalize Each Word': (t) => t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()),
  'tOGGLE cASE': (t) => [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''),
};
const TOGGLES = [
  ['bold', '<b>B</b>', 'Bold (Ctrl+B)'],
  ['italic', '<i>I</i>', 'Italic (Ctrl+I)'],
  ['underline', '<u>U</u>', 'Underline (Ctrl+U)'],
  ['strikeThrough', '<s>ab</s>', 'Strikethrough'],
  ['subscript', 'x<sub>2</sub>', 'Subscript'],
  ['superscript', 'x<sup>2</sup>', 'Superscript'],
];

// makeToolbar returns a Word-style font toolbar that formats the selection in el.
export function makeToolbar(el, editor) {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatting');

  // Clicking a <select> or color input moves focus out of the editor, so keep
  // the last selection made inside it and put it back before each command.
  let saved = null;
  document.addEventListener('selectionchange', () => {
    const sel = getSelection();
    if (sel.rangeCount && el.contains(sel.anchorNode)) saved = sel.getRangeAt(0);
    sync();
  });
  function exec(cmd, value) {
    if (el.contentEditable !== 'true') return;
    el.focus();
    if (saved) getSelection().removeAllRanges(), getSelection().addRange(saved);
    document.execCommand('styleWithCSS', false, false); // tags, not CSS spans: Chrome's CSS mode overwrites one span style with the next
    const before = el.innerHTML;
    document.execCommand(cmd, false, value);
    // Chrome skips 'input' when a command only restyles an existing element
    // (e.g. hiliteColor on a <font>), so the change would never be sent.
    if (el.innerHTML !== before) el.dispatchEvent(new Event('input'));
    sync();
  }

  const font = select('Font', FONTS.map((f) => [f, f]), (v) => exec('fontName', FONT_STACKS[v] || v));
  const size = select('Font size', SIZES.map((px, i) => [i + 1, px]), (v) => exec('fontSize', v));
  size.value = 3;
  const level = () => Number(document.queryCommandValue('fontSize')) || 3;
  const grow = tool('A<sup>+</sup>', 'Increase font size', () => exec('fontSize', Math.min(7, level() + 1)));
  const shrink = tool('A<sup>−</sup>', 'Decrease font size', () => exec('fontSize', Math.max(1, level() - 1)));
  const cases = select('Change case', Object.keys(CASES).map((k) => [k, k]), (v) => {
    const text = (saved || getSelection()).toString();
    // ponytail: rewrites the selection as plain text, so mixed formatting
    // inside it is lost. Walking the text nodes would keep it.
    if (text) exec('insertText', CASES[v](text));
  }, 'Aa');
  cases.classList.add('narrow');
  const clear = tool('<svg class="icon" viewBox="0 0 24 24"><path d="m7 21-4-4L14 6l5 5-8 8"/><path d="M7 21h14M10 10l5 5"/></svg>',
    'Clear formatting', () => exec('removeFormat'));
  const toggles = TOGGLES.map(([cmd, html, label]) => {
    const b = tool(html, label, () => exec(cmd));
    b.dataset.cmd = cmd;
    return b;
  });
  const highlight = color('<span class="mark-hl">ab</span>', 'Highlight color', '#fde047', (v) => exec('hiliteColor', v));
  const fg = color('<span class="mark-fg">A</span>', 'Font color', '#dc2626', (v) => exec('foreColor', v));

  const group = (...kids) => {
    const g = document.createElement('span');
    g.className = 'tool-group';
    g.append(...kids);
    return g;
  };
  const mode = select('Text or code', [['', 'Text'], ...Object.entries(LANGS).map(([id, l]) => [id, l.name])], (v) => editor.setMode(v));
  mode.classList.add('mode');
  const formats = [group(font, size, grow, shrink, cases, clear), group(...toggles), group(...highlight, ...fg)];
  bar.append(group(mode), ...formats);
  // Code has no fonts or colours: hide those tools while the document is code.
  editor.onMode = (lang) => {
    mode.value = lang;
    for (const g of formats) g.hidden = !!lang;
  };
  editor.onMode(editor.lang);

  function sync() {
    if (el.contentEditable !== 'true') return;
    for (const b of toggles) b.setAttribute('aria-pressed', document.queryCommandState(b.dataset.cmd));
    size.value = level();
  }

  function tool(html, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.innerHTML = html;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
    b.addEventListener('click', onClick);
    return b;
  }

  function select(label, options, onChange, placeholder) {
    const s = document.createElement('select');
    s.className = 'tool';
    s.title = label;
    s.setAttribute('aria-label', label);
    if (placeholder) s.add(new Option(placeholder, '', true, true));
    for (const [value, text] of options) s.add(new Option(text, value));
    s.addEventListener('change', () => {
      onChange(s.value);
      if (placeholder) s.value = '';
    });
    return s;
  }

  // A button that applies the current color, plus a picker that changes it.
  function color(html, label, initialColor, apply) {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = initialColor;
    picker.className = 'tool-color';
    picker.title = `${label}: choose`;
    picker.setAttribute('aria-label', `${label}: choose`);
    const b = tool(html, label, () => apply(picker.value));
    b.style.setProperty('--swatch', initialColor);
    picker.addEventListener('input', () => b.style.setProperty('--swatch', picker.value));
    picker.addEventListener('change', () => apply(picker.value));
    // The native swatch is hidden inside a small ▾ that opens the palette.
    const caret = document.createElement('label');
    caret.className = 'tool tool-caret';
    caret.title = `${label}: choose`;
    caret.append('▾', picker);
    return [b, caret];
  }

  return {
    el: bar,
    setEnabled(on) {
      for (const c of bar.querySelectorAll('.tool-group :is(button, select, input)')) c.disabled = !on;
    },
  };
}

// ---------- downloads ----------

// Word opens an HTML file served as application/msword, keeping the formatting.
// ponytail: .doc, not .docx; a real .docx needs a zip library.
// PDF goes through the browser's print dialog ("Save as PDF"); print CSS hides everything but the text.
// A code document is exported as one <pre> rebuilt from its text, not the on-screen view.
export function bindDownloads(getHtml, editor) {
  const docHtml = () => {
    const c = parseCode(editor.text);
    return c ? codeHtml(c.lang, c.code) : getHtml();
  };
  $('dl-doc').addEventListener('click', () => {
    const html = `<html><head><meta charset="utf-8"></head><body style="white-space:pre-wrap">${docHtml()}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
    a.download = 'devshire.doc';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('dl-doc').closest('details').open = false;
  });
  $('dl-pdf').addEventListener('click', () => {
    $('dl-pdf').closest('details').open = false;
    print();
  });
}

// ---------- reactions and questions ----------

// floatReaction shows an emoji rising from the bottom right corner.
export function floatReaction(emoji) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.createElement('span');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--x', `${Math.round(Math.random() * 80)}px`);
  el.addEventListener('animationend', () => el.remove());
  document.body.append(el);
}

// renderQuestions draws the question list into ul. Questions are plain text
// from viewers, so they only ever go through textContent. For the host,
// actions(q) returns extra controls; drafts typed into them survive a redraw.
export function renderQuestions(ul, list, actions) {
  const drafts = new Map([...ul.querySelectorAll('input[data-q]')].map((i) => [i.dataset.q, i.value]));
  const focused = document.activeElement?.dataset?.q;
  ul.replaceChildren(...list.map((q) => {
    const li = document.createElement('li');
    li.className = q.answer ? 'answered' : '';
    const who = document.createElement('span');
    who.className = 'q-name';
    who.textContent = q.mine ? `${q.name} (you)` : q.name;
    const text = document.createElement('p');
    text.className = 'q-text';
    text.textContent = q.text;
    li.append(who, text);
    if (q.answer) {
      const a = document.createElement('p');
      a.className = 'q-answer';
      a.textContent = q.answer;
      li.append(a);
    } else if (q.mine) {
      const w = document.createElement('p');
      w.className = 'q-wait';
      w.textContent = 'Waiting for the host to answer';
      li.append(w);
    }
    if (actions) li.append(actions(q));
    return li;
  }));
  for (const i of ul.querySelectorAll('input[data-q]')) {
    if (drafts.has(i.dataset.q)) i.value = drafts.get(i.dataset.q);
    if (i.dataset.q === focused) i.focus();
  }
}
