// Shared by the host and viewer pages: DOM helpers, a reconnecting websocket
// and the editor sync used by whoever holds the pen.

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

// makeEditor syncs a textarea with the server. Typing sends the whole text at
// most every 50 ms, and always sends the final state. Snapshots never touch
// the textarea while we hold the pen, so the cursor does not jump.
export function makeEditor(textarea, conn, onTooLarge) {
  let writable = false;
  let known = ''; // the text the server has, as far as we know
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    const text = textarea.value;
    if (!writable || text === known) return;
    const msg = JSON.stringify({ type: 'update', text });
    if (new Blob([msg]).size > MAX_MESSAGE_BYTES) {
      onTooLarge();
      return;
    }
    if (conn.send(msg)) known = text;
  }

  textarea.addEventListener('input', () => {
    if (writable && !timer) timer = setTimeout(flush, SEND_EVERY_MS);
  });

  return {
    flush,
    get writable() { return writable; },
    get text() { return writable ? textarea.value : known; },

    // After a reconnect, keep local edits if we held the pen before and still
    // do: nobody else can have written in between, so ours are the newest.
    welcome(text, canWrite) {
      const keep = writable && canWrite;
      writable = canWrite;
      textarea.readOnly = !canWrite;
      known = text;
      if (keep) flush();
      else textarea.value = text;
    },

    snapshot(text) {
      known = text;
      if (!writable) textarea.value = text;
    },

    // A change of writer replaces the editor with the server's text.
    setWritable(canWrite) {
      if (canWrite === writable) return;
      clearTimeout(timer);
      timer = null;
      writable = canWrite;
      textarea.readOnly = !canWrite;
      textarea.value = known;
    },
  };
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
