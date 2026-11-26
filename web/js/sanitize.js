import { parseCode, codeView } from './code.js';

// The document is HTML written by whoever holds the pen, and viewers may hold
// it, so every page rebuilds incoming HTML from an allowlist before showing it.
// A code document (one <pre data-lang>) is shown as highlighted code instead.
// Only formatting survives: no attributes besides filtered styles and <font>'s
// face/color/size, so no scripts, handlers, links or URLs.

const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'SPAN', 'FONT', 'DIV', 'P', 'BR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE']);
const STYLES = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'vertical-align'];
const FONT_ATTRS = ['face', 'color', 'size'];

export function sanitize(html) {
  const src = new DOMParser().parseFromString(html, 'text/html').body;
  const out = document.createDocumentFragment();
  copyChildren(src, out);
  return out;
}

function copyChildren(from, to) {
  for (const node of from.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      to.append(node.data);
    } else if (node.nodeType === Node.ELEMENT_NODE && !DROP.has(node.tagName)) {
      if (!TAGS.has(node.tagName)) {
        copyChildren(node, to); // unknown wrapper: keep its text, lose the tag
        continue;
      }
      const el = document.createElement(node.tagName);
      // Parse the attribute text ourselves: the page's CSP (no inline styles)
      // leaves node.style empty. Setting styles through the CSSOM is allowed,
      // and setProperty drops invalid values.
      for (const decl of (node.getAttribute('style') || '').split(';')) {
        const i = decl.indexOf(':');
        const p = decl.slice(0, i).trim().toLowerCase();
        const v = decl.slice(i + 1).trim();
        if (i > 0 && STYLES.includes(p) && !/url\(|expression|\\/i.test(v)) el.style.setProperty(p, v);
      }
      if (node.tagName === 'FONT') {
        for (const a of FONT_ATTRS) if (node.hasAttribute(a)) el.setAttribute(a, node.getAttribute(a));
      }
      copyChildren(node, el);
      to.append(el);
    }
  }
}

// render replaces el's content with the sanitized document.
export function render(el, html) {
  const code = parseCode(html);
  el.replaceChildren(code ? codeView(code.lang, code.code) : sanitize(html));
}
