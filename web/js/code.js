// Developer mode. A code document is stored as one <pre data-lang="go">…</pre>,
// so the server, replay and downloads treat it like any other document.
// Highlighting is a small tokenizer: comments, strings, numbers, keywords,
// function calls and capitalized types. Everything is built with textContent.
// ponytail: regex tokenizer, not a parser; nested template strings or Rust raw
// strings can be coloured wrong. Swap in a real highlighter if that matters.

const C = { line: '//', block: true, str: `"'` };
const kw = (s) => new Set(s.split(' '));
export const LANGS = {
  javascript: { name: 'JavaScript', ext: 'js', ...C, str: '"\'`', kw: kw('async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield') },
  typescript: { name: 'TypeScript', ext: 'ts', ...C, str: '"\'`', kw: kw('abstract any as async await boolean break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while yield') },
  python: { name: 'Python', ext: 'py', line: '#', str: `"'`, triple: true, kw: kw('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print len range') },
  go: { name: 'Go', ext: 'go', ...C, str: '"\'`', kw: kw('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false error string int int64 float64 bool byte rune any make new len append') },
  rust: { name: 'Rust', ext: 'rs', ...C, kw: kw('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while i32 i64 u8 u32 u64 usize f64 bool str String Vec Option Some None Ok Err') },
  java: { name: 'Java', ext: 'java', ...C, kw: kw('abstract boolean break byte case catch char class continue default do double else enum extends false final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true try var void while String') },
  c: { name: 'C', ext: 'c', ...C, hash: true, kw: kw('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL #include #define #if #ifdef #ifndef #else #endif #pragma') },
  cpp: { name: 'C++', ext: 'cpp', ...C, hash: true, kw: kw('auto bool break case catch char class const constexpr continue default delete do double else enum explicit false float for if inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void while std string vector #include #define #if #ifdef #ifndef #else #endif #pragma') },
  csharp: { name: 'C#', ext: 'cs', ...C, hash: true, kw: kw('abstract as async await base bool break case catch class const continue decimal default do double else enum false finally float for foreach if in int interface internal is long namespace new null object out override private protected public readonly return static string struct switch this throw true try using var virtual void while #region #endregion') },
  sql: { name: 'SQL', ext: 'sql', line: '--', block: true, str: `'"`, nocase: true, kw: kw('select from where and or not insert into values update set delete create table alter drop index join left right inner outer on as group by order having limit offset distinct null is in like between case when then else end primary key foreign references union all count sum avg min max') },
  shell: { name: 'Shell', ext: 'sh', line: '#', str: `"'`, kw: kw('if then else elif fi for while do done case esac in function return exit echo export local cd ls grep sed awk cat sudo') },
  json: { name: 'JSON', ext: 'json', str: '"', kw: kw('true false null') },
  plain: { name: 'Plain code', ext: 'txt', plain: true },
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const res = {};
function tokenRe(id) {
  const l = LANGS[id];
  const com = [];
  if (l.block) com.push('/\\*[\\s\\S]*?(?:\\*/|$)');
  if (l.line) com.push(`${esc(l.line)}.*`);
  const str = [...(l.str || '')].map((q) => (q === '`' ? '`[^`]*`?' : `${q}(?:\\\\.|[^${q}\\\\\\n])*${q}?`));
  if (l.triple) str.unshift('"""[\\s\\S]*?(?:"""|$)', "'''[\\s\\S]*?(?:'''|$)");
  return new RegExp(`(${com.join('|') || '(?!)'})|(${str.join('|') || '(?!)'})|(\\b(?:0x[\\da-fA-F]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)|(${l.hash ? '#?' : ''}[A-Za-z_$][\\w$]*)`, 'g');
}

// highlight returns coloured spans for code.
export function highlight(code, id) {
  const out = document.createDocumentFragment();
  const l = LANGS[id];
  if (!l || l.plain) {
    out.append(code);
    return out;
  }
  const re = (res[id] ??= tokenRe(id));
  re.lastIndex = 0;
  let at = 0;
  for (let m; (m = re.exec(code));) {
    let cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : '';
    if (m[4]) {
      const w = l.nocase ? m[4].toLowerCase() : m[4];
      if (l.kw.has(w)) cls = 'k';
      else if (code[re.lastIndex] === '(') cls = 'f';
      else if (/^[A-Z][a-z]/.test(w)) cls = 't';
    }
    if (!cls) continue;
    out.append(code.slice(at, m.index));
    const s = document.createElement('span');
    s.className = `tok-${cls}`;
    s.textContent = m[0];
    out.append(s);
    at = m.index + m[0].length;
  }
  out.append(code.slice(at));
  return out;
}

// parseCode returns {lang, code} when html is a code document, else null.
export function parseCode(html) {
  if (!html.startsWith('<pre')) return null;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const pre = body.firstElementChild;
  if (body.childElementCount !== 1 || pre.tagName !== 'PRE' || !LANGS[pre.dataset.lang]) return null;
  return { lang: pre.dataset.lang, code: pre.textContent };
}

export function codeHtml(lang, code) {
  const pre = document.createElement('pre');
  pre.dataset.lang = lang;
  pre.textContent = code;
  return pre.outerHTML;
}

// codeView builds the read-only view: language, Copy, line numbers, code.
// Pass input (a textarea from codeInput) to make it editable.
export function codeView(lang, code, input) {
  const view = document.createElement('div');
  view.className = 'code';
  view.innerHTML = `<div class="code-head"><span class="code-lang"></span><button type="button" class="ghost sm code-copy">Copy code</button></div>
    <div class="code-body"><pre class="code-gutter" aria-hidden="true"></pre><div class="code-stack"><pre class="code-hl"></pre></div></div>`;
  view.querySelector('.code-lang').textContent = LANGS[lang].name;
  const copyBtn = view.querySelector('.code-copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(input ? input.value : code).then(
      () => { copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy code'; }, 1500); },
      () => { copyBtn.textContent = 'Copy failed'; },
    );
  });
  if (input) view.querySelector('.code-stack').append(input);
  paint(view, lang, code);
  return view;
}

export function paint(view, lang, code) {
  view.querySelector('.code-hl').replaceChildren(highlight(code, lang), '\n'); // the extra line keeps a trailing newline visible
  const lines = code.split('\n').length;
  const gutter = view.querySelector('.code-gutter');
  if (gutter.dataset.n !== String(lines)) {
    gutter.dataset.n = lines;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }
}

// codeInput is the writer's transparent textarea over the highlighted code.
// Tab indents (Esc then Tab leaves the editor); Enter keeps the indent and
// adds one level after { [ ( or :.
export function codeInput() {
  const ta = document.createElement('textarea');
  ta.className = 'code-input';
  ta.spellcheck = false;
  ta.wrap = 'off';
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('aria-label', 'Code. Press Escape then Tab to leave.');
  let escaped = false;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !escaped && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '    ');
    } else if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
      const i = ta.selectionStart;
      const line = ta.value.slice(ta.value.lastIndexOf('\n', i - 1) + 1, i);
      const indent = line.match(/^[ \t]*/)[0] + (/[{[(:]\s*$/.test(line) ? '    ' : '');
      e.preventDefault();
      document.execCommand('insertText', false, `\n${indent}`);
    }
    escaped = e.key === 'Escape';
  });
  return ta;
}
