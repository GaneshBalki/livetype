import { showReplay } from './replay.js';
import { $, roomId, connect, makeEditor, makeToolbar, bindDownloads, floatReaction, renderQuestions, toast, copy, setStatus, plural } from './common.js';

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
  const toolbar = makeToolbar($('editor'), editor);
  $('editor').before(toolbar.el);
  toolbar.el.append($('replay-btn'), document.querySelector('.download')); // Replay and Download sit at the toolbar's right end
  $('replay-btn').addEventListener('click', () => conn.send({ type: 'history' }));

  bindDownloads(() => $('editor').innerHTML, editor);

  $('take-back').addEventListener('click', () => conn.send({ type: 'revoke' }));
  $('lower-hands').addEventListener('click', () => conn.send({ type: 'lower_hands' }));
  let hands = 0;
  let questionIds = null; // null until the first list, so a reload does not toast old questions

  function onMessage(m) {
    switch (m.type) {
      case 'welcome':
        editor.welcome(m.text, !m.writer);
        showWriter(m.writer);
        showPresence(m);
        toolbar.setEnabled(editor.writable);
        break;
      case 'snapshot':
        editor.snapshot(m.text);
        editor.setWritable(!m.writer);
        toolbar.setEnabled(editor.writable);
        showWriter(m.writer);
        break;
      case 'requests':
        renderRequests(m.list);
        break;
      case 'presence':
        showPresence(m);
        break;
      case 'history':
        showReplay(m);
        break;
      case 'reaction':
        floatReaction(m.emoji);
        break;
      case 'hands':
        if (m.count > hands) toast('✋ A viewer raised their hand.');
        hands = m.count;
        $('hands').hidden = !m.count;
        $('hand-count').textContent = `${plural(m.count, 'hand')} raised`;
        break;
      case 'questions':
        if (questionIds && m.list.some((q) => !questionIds.has(q.id))) toast('New question from a viewer.');
        questionIds = new Set(m.list.map((q) => q.id));
        renderQuestions($('questions'), m.list, questionActions);
        $('no-questions').hidden = m.list.length > 0;
        $('question-count').textContent = m.list.filter((q) => !q.answer).length || '';
        break;
      case 'error':
        if (m.code !== 'not_writer') toast(m.message); // not_writer only happens in a hand-over race
        break;
    }
  }

  function questionActions(q) {
    const box = document.createElement('form');
    box.className = 'q-actions';
    if (!q.answer) {
      const input = document.createElement('input');
      input.dataset.q = q.id;
      input.maxLength = 280;
      input.required = true;
      input.placeholder = 'Type an answer';
      input.setAttribute('aria-label', `Answer ${q.name}`);
      box.append(input, button('Answer', 'primary sm', null, 'submit'));
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        conn.send({ type: 'answer', id: q.id, text: input.value });
      });
    }
    box.append(button('Dismiss', 'sm', () => conn.send({ type: 'dismiss', id: q.id })));
    return box;
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

function button(text, cls, onClick, type = 'button') {
  const b = document.createElement('button');
  b.type = type;
  b.textContent = text;
  if (cls) b.className = cls;
  if (onClick) b.addEventListener('click', onClick);
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
  $('editor').contentEditable = false;
  for (const c of document.querySelectorAll('.tool-group :is(button, select, input), .requests :is(button, input)')) c.disabled = true;
  $('writer-banner').hidden = true;
  $('ended').textContent = reason;
  $('ended').hidden = false;
}
