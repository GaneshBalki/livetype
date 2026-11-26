// Typing playback. The server sends a base text plus frames that splice UTF-8
// bytes ({t, at, del, ins, w}); this rebuilds any moment of the session and
// plays it back in a dialog.

import { render } from './sanitize.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAX_GAP = 2000; // pauses longer than this are shortened, so idle time does not drag
const KEY_EVERY = 100; // keep a full copy every N frames so seeking stays fast
const SPEEDS = [0.5, 1, 2, 4];

function apply(bytes, f) {
  const ins = enc.encode(f.ins);
  const out = new Uint8Array(bytes.length - f.del + ins.length);
  out.set(bytes.subarray(0, f.at));
  out.set(ins, f.at);
  out.set(bytes.subarray(f.at + f.del), f.at + ins.length);
  return out;
}

// build returns the playback timeline. State i is the text after i frames.
export function build(h) {
  let v = 0;
  let prev = h.baseT;
  const times = h.frames.map((f) => {
    v += Math.min(Math.max(f.t - prev, 0), MAX_GAP);
    prev = f.t;
    return v;
  });
  const keys = [enc.encode(h.base)];
  let b = keys[0];
  h.frames.forEach((f, i) => {
    b = apply(b, f);
    if ((i + 1) % KEY_EVERY === 0) keys.push(b);
  });
  return {
    total: v,
    count: h.frames.length,
    // index of the last state shown at time t: the number of frames with time <= t
    indexAt(t) {
      let lo = 0;
      let hi = times.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    textAt(i) {
      const k = Math.floor(i / KEY_EVERY);
      let x = keys[k];
      for (let j = k * KEY_EVERY; j < i; j++) x = apply(x, h.frames[j]);
      return dec.decode(x);
    },
    writerAt: (i) => (i === 0 ? h.baseW : h.frames[i - 1].w) || 'Host',
  };
}

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let dialog;

// showReplay opens the player for a 'history' message.
export function showReplay(h) {
  dialog ??= makeDialog();
  dialog.load(build(h));
  dialog.el.showModal();
}

function makeDialog() {
  const el = document.createElement('dialog');
  el.className = 'card replay';
  el.setAttribute('aria-labelledby', 'replay-title');
  el.innerHTML = `
    <div class="replay-head">
      <h2 id="replay-title">Replay</h2>
      <span class="pill writer replay-writer"></span>
      <button type="button" class="ghost sm replay-close" aria-label="Close replay">✕</button>
    </div>
    <div class="text replay-text" aria-live="off"></div>
    <div class="replay-controls">
      <button type="button" class="sm replay-restart" aria-label="Restart" title="Restart">⏮</button>
      <button type="button" class="primary sm replay-play" aria-label="Play">▶</button>
      <input type="range" class="replay-seek" min="0" step="1" value="0" aria-label="Timeline">
      <span class="replay-time"></span>
      <select class="replay-speed" aria-label="Playback speed">${SPEEDS.map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}×</option>`).join('')}</select>
    </div>
    <p class="replay-note">Pauses longer than 2 seconds are shortened.</p>`;
  document.body.append(el);
  const q = (c) => el.querySelector(c);
  const text = q('.replay-text');
  const seek = q('.replay-seek');
  const play = q('.replay-play');

  let tl = null;
  let pos = 0;
  let shown = -1;
  let playing = false;
  let last = 0;

  function draw() {
    const i = tl.indexAt(pos);
    if (i !== shown) {
      shown = i;
      render(text, tl.textAt(i));
      text.scrollTop = text.scrollHeight;
      q('.replay-writer').textContent = `${tl.writerAt(i)} writing`;
    }
    seek.value = pos;
    q('.replay-time').textContent = `${clock(pos)} / ${clock(tl.total)}`;
  }
  function setPlaying(on) {
    playing = on && tl.count > 0;
    play.textContent = playing ? '⏸' : '▶';
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (playing) {
      if (pos >= tl.total) pos = 0;
      last = performance.now();
      requestAnimationFrame(tick);
    }
  }
  function tick(now) {
    if (!playing) return;
    pos = Math.min(tl.total, pos + (now - last) * Number(q('.replay-speed').value));
    last = now;
    draw();
    if (pos >= tl.total) setPlaying(false);
    else requestAnimationFrame(tick);
  }

  play.addEventListener('click', () => setPlaying(!playing));
  q('.replay-restart').addEventListener('click', () => { pos = 0; draw(); setPlaying(true); });
  seek.addEventListener('input', () => { pos = Number(seek.value); draw(); });
  q('.replay-close').addEventListener('click', () => el.close());
  el.addEventListener('close', () => setPlaying(false));

  return {
    el,
    load(timeline) {
      tl = timeline;
      pos = 0;
      shown = -1;
      seek.max = tl.total;
      seek.disabled = play.disabled = q('.replay-restart').disabled = q('.replay-speed').disabled = tl.count === 0;
      draw();
      if (tl.count === 0) text.textContent = 'Nothing to replay yet. Start typing first.';
      q('.replay-writer').hidden = tl.count === 0;
      setPlaying(tl.count > 0);
    },
  };
}
