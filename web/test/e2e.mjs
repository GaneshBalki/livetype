// End-to-end test for the editor, toolbar, sanitizer, downloads, pen hand-over
// and dark mode. Drives a host tab and a viewer tab in headless Chrome/Brave.
//
//   go run ./cmd/server &
//   "<chrome or brave binary>" --headless=new --remote-debugging-port=9333 --user-data-dir=$(mktemp -d) &
//   node web/test/e2e.mjs /tmp/livetype-e2e     # screenshots and PDFs land here
//
// Needs Node 22+ (built-in WebSocket). Not embedded in the server binary.
import { writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8080', CDP = 'http://localhost:9333';
const OUT = process.argv[2] || (await import("node:os")).tmpdir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  -> ' + info}`); };

async function tab(url) {
  const t = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result.exceptionDetails) throw new Error(expr + ': ' + r.result.exceptionDetails.exception?.description);
    return r.result.result.value;
  };
  return { send, ev, errors, close: () => fetch(`${CDP}/json/close/${t.id}`) };
}
async function until(fn, ms = 3000) {
  const end = Date.now() + ms; let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(50); }
  return v;
}

{ const t = await tab('about:blank'); await t.send('Network.clearBrowserCache'); await t.close(); }
const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json();
const hostUrl = room.hostUrl.startsWith('http') ? room.hostUrl : BASE + room.hostUrl;
const host = await tab(hostUrl);
await until(() => host.ev(`document.getElementById('status')?.textContent === 'Live'`));
const viewerUrl = await host.ev(`document.getElementById('viewer-link').value`);
const viewer = await tab(viewerUrl);
await until(() => viewer.ev(`document.getElementById('status')?.textContent === 'Live'`));

const H = host.ev, V = viewer.ev;
const viewHtml = () => V(`document.getElementById('text').innerHTML`);
// select all text in the host editor, then click a toolbar control
const selectAll = (ev = H) => ev(`(() => { const e = document.getElementById('editor'); e.focus(); const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
const click = (sel, ev = H) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true})), document.querySelector(${JSON.stringify(sel)}).click()`);
const tool = (label) => `.toolbar [aria-label="${label}"]`;
const choose = (label, value, ev = H) => ev(`(() => { const s = document.querySelector('${tool(label)}'); s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change')); })()`);
const viewerSees = (re) => until(async () => re.test(await viewHtml()));

// --- host editing basics
check('host editor editable', await H(`document.getElementById('editor').contentEditable`) === 'true');
check('host toolbar enabled', await H(`!document.querySelector('.toolbar button').disabled`));
check('viewer toolbar hidden', await V(`document.querySelector('.toolbar').hidden`));
await H(`document.getElementById('editor').focus(); document.execCommand('insertText', false, 'hello world. second line')`);
check('typing reaches viewer', await viewerSees(/hello world\. second line/), await viewHtml());

// --- each toggle
for (const [label, re] of [['Bold (Ctrl+B)', /font-weight: bold|<b>/], ['Italic (Ctrl+I)', /font-style: italic|<i>/],
  ['Underline (Ctrl+U)', /underline|<u>/], ['Strikethrough', /line-through|<s>|<strike>/], ['Subscript', /<sub>|vertical-align: sub/], ['Superscript', /<sup>|vertical-align: super/]]) {
  await selectAll();
  await click(tool(label));
  check(`${label} reaches viewer`, await viewerSees(re), await viewHtml());
  if (!label.startsWith('Sub') && !label.startsWith('Super')) check(`${label} button shows pressed`, await until(() => H(`document.querySelector('${tool(label)}').getAttribute('aria-pressed') === 'true'`)));
}
check('all six formats stack', await viewerSees(/<b>.*<i>.*<u>.*(<s>|<strike>)/), await viewHtml());
await selectAll(); await click(tool('Clear formatting'));
check('clear formatting removes styles', await until(async () => !/<b>|<i>|<u>|<s>|<sub>|<sup>|font-weight|italic|underline|line-through/.test(await viewHtml())), await viewHtml());

// --- font, size, grow/shrink, colors
await selectAll(); await choose('Font', 'Georgia');
check('font family reaches viewer', await viewerSees(/Georgia/), await viewHtml());
await selectAll(); await choose('Font size', 6);
check('font size reaches viewer', await viewerSees(/size="6"/), await viewHtml());
check('size dropdown reflects selection', await until(() => H(`document.querySelector('${tool('Font size')}').value === '6'`)));
await selectAll(); await click(tool('Increase font size'));
check('grow font', await viewerSees(/size="7"/), await viewHtml());
await selectAll(); await click(tool('Decrease font size')); await selectAll(); await click(tool('Decrease font size'));
check('shrink font', await viewerSees(/size="5"/), await viewHtml());
await H(`(() => { const p = document.querySelector('${tool('Font color: choose')}'); p.value = '#00ff00'; p.dispatchEvent(new Event('input')); })()`);
await selectAll(); await click(tool('Font color'));
check('font color reaches viewer', await viewerSees(/color="#00ff00"/), await viewHtml());
await selectAll(); await click(tool('Highlight color'));
check('highlight reaches viewer', await viewerSees(/background-color: rgb\(253, 224, 71\)/), await viewHtml());

// --- change case
await selectAll(); await choose('Change case', 'UPPERCASE');
check('UPPERCASE', await viewerSees(/HELLO WORLD\. SECOND LINE/), await viewHtml());
await selectAll(); await choose('Change case', 'Sentence case.');
check('Sentence case', await viewerSees(/Hello world\. Second line/), await viewHtml());
await selectAll(); await choose('Change case', 'Capitalize Each Word');
check('Capitalize Each Word', await viewerSees(/Hello World\. Second Line/), await viewHtml());
await selectAll(); await choose('Change case', 'tOGGLE cASE');
check('tOGGLE cASE', await viewerSees(/hELLO wORLD\. sECOND lINE/), await viewHtml());
check('case dropdown resets to Aa', await H(`document.querySelector('${tool('Change case')}').value === ''`));

// --- paste is plain text
await selectAll();
await H(`(() => { const dt = new DataTransfer(); dt.setData('text/html', '<b style="color:red">pasted</b><img src=x>'); dt.setData('text/plain', 'pasted plain');
  document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
check('paste inserts plain text', await viewerSees(/pasted plain/) && !/pasted<|<img|color: red/.test(await viewHtml()), await viewHtml());

// --- XSS: hostile HTML sent straight over the socket is neutralised on the viewer
await H(`(() => { const e = document.getElementById('editor'); e.innerHTML = '<img src=x onerror="window.pwned=1"><b onclick="x()">safe</b><script>window.pwned=2<\\/script><a href="javascript:alert(1)">lnk</a><span style="background-image:url(http://evil/x)">s</span>'; e.dispatchEvent(new Event('input')); })()`);
await viewerSees(/safe/); await sleep(300);
const vh = await viewHtml();
check('XSS: no img/script/a/handlers/url on viewer', !/<img|<script|<a |onerror|onclick|url\(/.test(vh) && /<b>safe<\/b>/.test(vh), vh);
check('XSS: no script ran on viewer', await V(`window.pwned === undefined`));

check('sanitizer under real CSP keeps safe styles, drops url()', await V(`import('/js/sanitize.js').then(({sanitize}) => { const d = document.createElement('div');
  d.append(sanitize('<span style="background-color: red; color: blue; background-image: url(http://e); position: fixed">a</span>')); return d.innerHTML; })`) === '<span style="background-color: red; color: blue;">a</span>');
// --- download .doc
await H(`(() => { const e = document.getElementById('editor'); e.innerHTML = '<b>Report</b> body'; e.dispatchEvent(new Event('input')); })()`);
const doc = await H(`new Promise((res) => { const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(res); return orig(b); }; document.getElementById('dl-doc').click(); })`);
check('.doc download has formatted HTML', /<b>Report<\/b> body/.test(doc) && /<html>/.test(doc), doc.slice(0, 200));
await viewerSees(/Report/);
const vdoc = await V(`new Promise((res) => { const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(res); return orig(b); }; document.getElementById('dl-doc').click(); })`);
check('viewer .doc download works', /<b>Report<\/b>/.test(vdoc), vdoc.slice(0, 200));

// --- PDF: print is called and print CSS leaves only the document
check('PDF button calls print()', await H(`new Promise((res) => { window.print = () => res(true); document.getElementById('dl-pdf').click(); })`));
for (const [name, t] of [['host', host], ['viewer', viewer]]) {
  const pdf = await t.send('Page.printToPDF', {});
  writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(pdf.result.data, 'base64'));
}

// --- pen handover: viewer writes with the toolbar, host sees it
await click('#request-btn', V); await V(`document.getElementById('name').value = 'Tester'; document.getElementById('request-form').requestSubmit()`);
await until(() => H(`document.querySelectorAll('#requests li').length === 1`));
await H(`[...document.querySelectorAll('#requests button')].find((b) => b.textContent === 'Approve').click()`);
check('viewer becomes writer', await until(() => V(`document.getElementById('editor').contentEditable === 'true' && !document.getElementById('editor').hidden`)));
check('viewer toolbar shown + enabled', await V(`!document.querySelector('.toolbar').hidden && !document.querySelector('.toolbar button').disabled`));
check('host toolbar disabled while viewer writes', await until(() => H(`document.querySelector('.toolbar button').disabled && document.getElementById('editor').contentEditable === 'false'`)));
check('host Download stays usable while viewer writes', await H(`!document.getElementById('dl-doc').disabled && !document.querySelector('.download summary').closest(':disabled')`));
check('viewer .doc download works while writing', await V(`new Promise((res) => { const c = URL.createObjectURL; URL.createObjectURL = (b) => { URL.createObjectURL = c; res(b.size > 0); return c(b); }; document.getElementById('dl-doc').click(); })`));
await selectAll(V); await click(tool('Italic (Ctrl+I)'), V);
check('viewer formatting reaches host', await until(async () => /italic|<i>/.test(await H(`document.getElementById('editor').innerHTML`))), await H(`document.getElementById('editor').innerHTML`));
await click('#take-back');
check('host takes back pen', await until(() => H(`document.getElementById('editor').contentEditable === 'true' && !document.querySelector('.toolbar button').disabled`)));
check('viewer toolbar hidden again', await until(() => V(`document.querySelector('.toolbar').hidden`)));

// --- typing playback
await sleep(1100); // let the last edit settle into its own frame
await host.send('Page.bringToFront'); // hidden tabs get no animation frames
await click('#replay-btn');
check('replay dialog opens and plays', await until(() => H(`document.querySelector('dialog.replay')?.open && document.querySelector('.replay-play').getAttribute('aria-label') === 'Pause'`)));
const seekTo = (v, ev = H) => ev(`(() => { const s = document.querySelector('.replay-seek'); s.value = ${v}; s.dispatchEvent(new Event('input')); return document.querySelector('.replay-text').innerHTML; })()`);
await H(`document.querySelector('.replay-play').click()`); // pause
const endHtml = await seekTo(`s.max`);
const liveHtml = await H(`document.getElementById('editor').innerHTML`);
check('replay end matches the live document', endHtml === liveHtml, `${endHtml} != ${liveHtml}`);
check('replay shows who was writing', /Tester writing/.test(await H(`document.querySelector('.replay-writer').textContent`)), await H(`document.querySelector('.replay-writer').textContent`));
const startHtml = await seekTo(0);
check('replay start is earlier text', startHtml !== endHtml && startHtml.length < endHtml.length, startHtml);
check('replay time label', /^0:00 \/ \d+:\d\d$/.test(await H(`document.querySelector('.replay-time').textContent`)), await H(`document.querySelector('.replay-time').textContent`));
await H(`document.querySelector('.replay-speed').value = '4'; document.querySelector('.replay-play').click()`);
const t0 = Date.now();
const done = await until(() => H(`document.querySelector('.replay-play').getAttribute('aria-label') === 'Play'`), 15000);
const total = Number(await H(`document.querySelector('.replay-seek').max`)), took = Date.now() - t0;
check('4x playback runs to the end at ~4x speed', done && took < total / 4 + 1500 && took > total / 4 - 500, `total ${total}ms took ${took}ms`);
await H(`document.querySelector('.replay-close').click()`);
check('replay closes', await H(`!document.querySelector('dialog.replay').open`));
await click('#replay-btn', V);
check('viewer can replay too', await until(() => V(`document.querySelector('dialog.replay')?.open`)));
await V(`document.querySelector('.replay-close').click()`);

// --- reactions, raised hands, questions
await click('[data-emoji="🎉"]', V);
check('reaction floats on host', await until(() => H(`[...document.querySelectorAll('.float-emoji')].some((e) => e.textContent === '🎉')`)));
check('reaction floats on viewer too', await until(() => V(`!!document.querySelector('.float-emoji')`)));
await click('#hand-btn', V);
check('raised hand shows on host', await until(() => H(`!document.getElementById('hands').hidden && document.getElementById('hand-count').textContent === '1 hand raised'`)));
check('viewer hand button pressed', await until(() => V(`document.getElementById('hand-btn').getAttribute('aria-pressed') === 'true'`)));
await click('#lower-hands');
check('host lowers all hands', await until(() => V(`document.getElementById('hand-btn').getAttribute('aria-pressed') === 'false'`)) && await H(`document.getElementById('hands').hidden`));
await V(`document.getElementById('ask-text').value = '<img src=x onerror="window.pwned=1"> why?'; document.getElementById('ask-form').requestSubmit()`);
check('question reaches host', await until(() => H(`document.querySelector('#questions .q-text')?.textContent === '<img src=x onerror="window.pwned=1"> why?'`)));
check('question shown as text, not HTML', await H(`!document.querySelector('#questions img') && window.pwned === undefined`));
check('host toasted the new question', await H(`document.getElementById('toast').textContent`) === 'New question from a viewer.');
check('asker sees own question waiting', await until(() => V(`!!document.querySelector('#questions .q-wait')`)));
await H(`document.querySelector('#questions input').value = 'Because.'; document.querySelector('#questions form').requestSubmit()`);
check('answer reaches viewer', await until(() => V(`document.querySelector('#questions .q-answer')?.textContent === 'Because.'`)));
await H(`[...document.querySelectorAll('#questions button')].find((b) => b.textContent === 'Dismiss').click()`);
check('dismiss clears it for viewer', await until(() => V(`document.querySelectorAll('#questions li').length === 0`)));

// --- developer mode (code documents)
await choose('Text or code', 'python');
check('code mode shows the code editor', await until(() => H(`!!document.querySelector('#editor .code-input') && document.querySelectorAll('.toolbar .tool-group[hidden]').length === 3`)));
await H(`(() => { const t = document.querySelector('#editor .code-input'); t.focus(); t.select(); document.execCommand('insertText', false, 'def hi(name):'); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); document.execCommand('insertText', false, "return 'x' + 42  # done"); })()`);
check('Enter auto-indents after a colon', await H(`document.querySelector('#editor .code-input').value`) === "def hi(name):\n    return 'x' + 42  # done", await H(`document.querySelector('#editor .code-input').value`));
const vcode = (sel) => V(`[...document.querySelectorAll('#text ${sel}')].map((e) => e.textContent).join('|')`);
check('viewer sees highlighted keywords', await until(async () => (await vcode('.tok-k')) === 'def|return'), await vcode('.tok-k'));
check('viewer sees strings, numbers, comments, functions', (await vcode('.tok-s')) === "'x'" && (await vcode('.tok-n')) === '42' && (await vcode('.tok-c')) === '# done' && (await vcode('.tok-f')) === 'hi', [await vcode('.tok-s'), await vcode('.tok-n'), await vcode('.tok-c'), await vcode('.tok-f')].join(' '));
check('viewer sees line numbers and language', (await vcode('.code-gutter')) === '1\n2' && (await vcode('.code-lang')) === 'Python');
check('host editor highlights while typing', await H(`document.querySelector('#editor .code-hl .tok-k')?.textContent === 'def'`));
const cdoc = await H(`new Promise((res) => { const orig = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(res); return orig(b); }; document.getElementById('dl-doc').click(); })`);
check('.doc download of code is the plain code', /<pre data-lang="python">def hi\(name\):\n    return 'x' \+ 42  # done<\/pre>/.test(cdoc) && !/code-gutter|Copy code/.test(cdoc), cdoc.slice(0, 300));
check('code view never runs markup', await V(`import('/js/sanitize.js').then(({ render }) => { const d = document.createElement('div'); render(d, '<pre data-lang="go"><img src=x onerror="window.pwned=1">x</pre>'); return !d.querySelector('img') && d.querySelector('.code-hl').textContent.includes('x'); })`));
check('live cursor hidden in code mode', await V(`getComputedStyle(document.getElementById('text'), '::after').display === 'none'`));
writeFileSync(`${OUT}/code-viewer.png`, Buffer.from((await viewer.send('Page.captureScreenshot', {})).result.data, 'base64'));
writeFileSync(`${OUT}/code-host.png`, Buffer.from((await host.send('Page.captureScreenshot', {})).result.data, 'base64'));
await choose('Text or code', '');
check('switching back to Text keeps the text', await until(async () => !(await V(`!!document.querySelector('#text .code')`)) && /def hi\(name\):/.test(await V(`document.getElementById('text').textContent`))), await viewHtml());
check('formatting tools return in Text mode', await H(`document.querySelectorAll('.toolbar .tool-group[hidden]').length === 0`));

// --- dark mode
const before = await H(`document.documentElement.dataset.theme`);
await click('#theme-toggle');
const after = await H(`document.documentElement.dataset.theme`);
check('toggle flips theme', before !== after && ['light', 'dark'].includes(after), `${before}->${after}`);
check('dark bg applied', await H(`getComputedStyle(document.body).backgroundColor`) === (after === 'dark' ? 'rgb(9, 12, 10)' : 'rgb(247, 246, 242)'), await H(`getComputedStyle(document.body).backgroundColor`));
check('aria-pressed tracks theme', await H(`document.getElementById('theme-toggle').getAttribute('aria-pressed')`) === String(after === 'dark'));
await V(`location.reload()`); await sleep(1500);
check('theme persists across pages/reload', await V(`document.documentElement.dataset.theme`) === after);
const home = await tab(BASE + '/'); await sleep(800);
check('home page uses saved theme', await home.ev(`document.documentElement.dataset.theme`) === after);
for (const [n, t, w] of [['host-light-or-dark', host, 1300], ['viewer', viewer, 1300], ['home', home, 1300]]) {
  const s = await t.send('Page.captureScreenshot', {});
  writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.result.data, 'base64'));
}
await host.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
await sleep(300);
check('no horizontal scroll at phone width', await H(`document.documentElement.scrollWidth <= 390`), await H(`document.documentElement.scrollWidth`));
writeFileSync(`${OUT}/host-mobile.png`, Buffer.from((await host.send('Page.captureScreenshot', {})).result.data, 'base64'));

for (const [n, t] of [['host', host], ['viewer', viewer], ['home', home]]) check(`no JS errors on ${n}`, t.errors.length === 0, t.errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
