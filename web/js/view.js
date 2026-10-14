import { $, roomId, connect, makeEditor, toast, copy, setStatus, plural } from './common.js';

const storageKey = `livetype:${roomId}`;
const pre = $('text');
const textarea = $('editor');

let viewerId = load();
let connected = false;
let ended = false;
let hostOnline = true;
let writer = null;
let request = 'none'; // none | form | pending | denied

const conn = connect({
  hello: () => ({ type: 'hello', role: 'viewer', viewerId }),
  onMessage,
  onStatus(state, reason) {
    connected = state === 'live';
    if (state === 'ended') {
      ended = true;
      textarea.readOnly = true;
      $('ended').textContent = reason;
      $('ended').hidden = false;
    }
    render();
  },
});
const editor = makeEditor(textarea, conn, () => toast('Text is over 200 KB. Changes are not being sent.'));

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

  if (ended) setStatus('ended', 'Ended');
  else if (!connected) setStatus('waiting', 'Reconnecting…');
  else if (!hostOnline) setStatus('offline', 'Host offline');
  else setStatus('live', 'Live');

  if (writing) $('writer-info').textContent = 'You are writing';
  else $('writer-info').textContent = writer ? `${writer.name} is writing` : '';

  $('controls').disabled = !connected;
  $('controls').hidden = ended;
  $('request-btn').hidden = writing || !(request === 'none' || request === 'denied');
  $('denied').hidden = writing || request !== 'denied';
  $('request-form').hidden = writing || request !== 'form';
  $('waiting').hidden = writing || request !== 'pending';
  $('stop-writing').hidden = !writing;
}

function showText(text) {
  if (editor.writable) return;
  pre.textContent = text;
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

$('copy-all').addEventListener('click', () => copy(editor.text));
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
