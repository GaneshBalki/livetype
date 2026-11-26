import { $, roomId, connect, makeEditor, makeToolbar, bindDownloads, floatReaction, renderQuestions, render as renderHtml, toast, copy, setStatus, plural } from './common.js';

const storageKey = `livetype:${roomId}`;
const pre = $('text');
const textarea = $('editor');

let viewerId = load();
let connected = false;
let ended = false;
let hostOnline = true;
let writer = null;
let request = 'none'; // none | form | pending | denied
let handUp = false;

const conn = connect({
  hello: () => ({ type: 'hello', role: 'viewer', viewerId }),
  onMessage,
  onStatus(state, reason) {
    connected = state === 'live';
    if (state === 'ended') {
      ended = true;
      textarea.contentEditable = false;
      $('ended').textContent = reason;
      $('ended').hidden = false;
    }
    render();
  },
});
const editor = makeEditor(textarea, conn, () => toast('Text is over 200 KB. Changes are not being sent.'));
const toolbar = makeToolbar(textarea);
textarea.before(toolbar.el);

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      viewerId = m.viewerId;
      save(viewerId);
      editor.welcome(m.text, m.role === 'writer');
      showText(m.text);
      request = 'none'; // a pending request is re-announced right after welcome
      hostOnline = m.hostOnline;
      writer = m.writer;
      showCount(m.viewerCount);
      break;
    case 'snapshot':
      editor.snapshot(m.text);
      showText(m.text);
      writer = m.writer;
      break;
    case 'role':
      editor.setWritable(m.role === 'writer');
      showText(editor.text);
      request = 'none';
      if (m.reason) toast(m.reason);
      break;
    case 'request_state':
      request = m.state;
      break;
    case 'presence':
      hostOnline = m.hostOnline;
      showCount(m.viewerCount);
      break;
    case 'reaction':
      floatReaction(m.emoji);
      break;
    case 'hand':
      handUp = m.up;
      break;
    case 'questions':
      renderQuestions($('questions'), m.list);
      break;
    case 'error':
      if (m.code !== 'not_writer') toast(m.message); // not_writer only happens in a hand-over race
      break;
  }
  render();
}

function render() {
  const writing = editor.writable && !ended;
  pre.hidden = writing;
  textarea.hidden = !writing;
  toolbar.el.hidden = !writing;
  toolbar.setEnabled(writing);

  if (ended) setStatus('ended', 'Ended');
  else if (!connected) setStatus('waiting', 'Reconnecting…');
  else if (!hostOnline) setStatus('offline', 'Host offline');
  else setStatus('live', 'Live');

  if (writing) $('writer-info').textContent = 'You are writing';
  else $('writer-info').textContent = writer ? `${writer.name} is writing` : '';

  $('controls').disabled = !connected;
  $('controls').hidden = ended;
  $('interact').disabled = !connected;
  $('interact').hidden = ended;
  $('hand-btn').setAttribute('aria-pressed', handUp);
  $('hand-label').textContent = handUp ? 'Lower hand' : 'Raise hand';
  $('request-btn').hidden = writing || !(request === 'none' || request === 'denied');
  $('denied').hidden = writing || request !== 'denied';
  $('request-form').hidden = writing || request !== 'form';
  $('waiting').hidden = writing || request !== 'pending';
  $('stop-writing').hidden = !writing;
}

function showText(text) {
  if (editor.writable) return;
  renderHtml(pre, text);
  if ($('autoscroll').checked) pre.scrollTop = pre.scrollHeight;
}

function showCount(n) {
  $('viewer-count').textContent = plural(n, 'viewer');
}

$('request-btn').addEventListener('click', () => {
  request = 'form';
  render();
  $('name').focus();
});
$('cancel-form').addEventListener('click', () => {
  request = 'none';
  render();
});
$('request-form').addEventListener('submit', (e) => {
  e.preventDefault();
  conn.send({ type: 'request_write', name: $('name').value });
});
$('cancel-request').addEventListener('click', () => conn.send({ type: 'cancel_request' }));
$('stop-writing').addEventListener('click', () => {
  editor.flush();
  conn.send({ type: 'release_write' });
});

$('copy-all').addEventListener('click', () => copy((editor.writable ? textarea : pre).innerText));
bindDownloads(() => (editor.writable ? textarea : pre).innerHTML);

for (const b of document.querySelectorAll('[data-emoji]')) {
  b.addEventListener('click', () => conn.send({ type: 'react', emoji: b.dataset.emoji }));
}
$('hand-btn').addEventListener('click', () => conn.send({ type: 'hand', up: !handUp }));
$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('ask-name').value || $('name').value;
  if (conn.send({ type: 'ask', name, text: $('ask-text').value })) $('ask-text').value = '';
  if (!$('name').value) $('name').value = name; // one name for questions and write requests
});
$('autoscroll').addEventListener('change', (e) => {
  if (e.target.checked) pre.scrollTop = pre.scrollHeight;
});
$('font-size').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--text-size', `${e.target.value}px`);
});

// localStorage can be unavailable (private mode, blocked storage); the
// server then just issues a new ID on each visit.
function load() {
  try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
}
function save(id) {
  try { localStorage.setItem(storageKey, id); } catch { /* see load */ }
}
