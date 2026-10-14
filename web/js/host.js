import { $, roomId, connect, makeEditor, toast, copy, setStatus, plural } from './common.js';

const hostKey = new URLSearchParams(location.hash.slice(1)).get('k');
const viewerUrl = `${location.origin}/v/${encodeURIComponent(roomId)}`;
let ended = false;

$('viewer-link').value = viewerUrl;
$('copy-viewer').addEventListener('click', () => copy(viewerUrl));
$('copy-host').addEventListener('click', () => copy(location.href));
addEventListener('beforeunload', (e) => {
  if (!ended) e.preventDefault();
});

if (hostKey) start();
else end('This host link is missing its key. Use the full link you were given.');

function start() {
  const conn = connect({
    hello: () => ({ type: 'hello', role: 'host', hostKey }),
    onMessage,
    onStatus(state, reason) {
      if (state === 'live') setStatus('live', 'Live');
      else if (state === 'reconnecting') setStatus('waiting', 'Reconnecting…');
      else end(reason);
    },
  });
  const editor = makeEditor($('editor'), conn, () => toast('Text is over 200 KB. Changes are not being sent.'));

  $('take-back').addEventListener('click', () => conn.send({ type: 'revoke' }));

  function onMessage(m) {
    switch (m.type) {
      case 'welcome':
        editor.welcome(m.text, !m.writer);
        showWriter(m.writer);
        showPresence(m);
        break;
      case 'snapshot':
        editor.snapshot(m.text);
        editor.setWritable(!m.writer);
        showWriter(m.writer);
        break;
      case 'requests':
        renderRequests(m.list);
        break;
      case 'presence':
        showPresence(m);
        break;
      case 'error':
        if (m.code !== 'not_writer') toast(m.message); // not_writer only happens in a hand-over race
        break;
    }
  }

  function renderRequests(list) {
    $('requests').replaceChildren(...list.map(({ viewerId, name }) => {
      const li = document.createElement('li');
      li.dataset.initial = initial(name);
      const label = document.createElement('span');
      label.textContent = name;
      const approve = button('Approve', 'primary sm', () => {
        editor.flush(); // our last keystrokes reach the server before the pen moves
        conn.send({ type: 'grant', viewerId });
      });
      const deny = button('Deny', 'sm', () => conn.send({ type: 'deny', viewerId }));
      li.append(label, approve, deny);
      return li;
    }));
    $('no-requests').hidden = list.length > 0;
    $('request-count').textContent = list.length || '';
  }
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function showWriter(writer) {
  $('writer-banner').dataset.initial = writer ? initial(writer.name) : '';
  $('writer-banner').hidden = !writer;
  $('writer-name').textContent = writer ? writer.name : '';
}

function initial(name) {
  return ([...name.trim()][0] || '?').toUpperCase();
}

function showPresence(m) {
  $('viewer-count').textContent = plural(m.viewerCount, 'viewer');
}

function end(reason) {
  ended = true;
  setStatus('ended', 'Ended');
  $('editor').readOnly = true;
  $('writer-banner').hidden = true;
  $('ended').textContent = reason;
  $('ended').hidden = false;
}
