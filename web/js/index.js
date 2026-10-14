const start = document.getElementById('start');
const error = document.getElementById('error');

start.addEventListener('click', async () => {
  start.disabled = true;
  error.hidden = true;
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    location.href = (await res.json()).hostUrl;
  } catch (e) {
    error.textContent = e.message || 'Could not start a session.';
    error.hidden = false;
    start.disabled = false;
  }
});
