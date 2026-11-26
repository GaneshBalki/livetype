// Loaded as a classic script in <head> so the theme is set before first paint.
// A saved choice wins; otherwise follow the system and track its changes.
(() => {
  const key = 'livetype:theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let saved = null;
  try { saved = localStorage.getItem(key); } catch { /* storage blocked: follow the system */ }

  const apply = (theme) => {
    root.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', theme === 'dark');
  };
  apply(saved || (system.matches ? 'dark' : 'light'));
  // Printing reports a light system theme; ignore it so Download as PDF doesn't flip the page.
  const printing = matchMedia('print');
  const follow = () => { if (!saved && !printing.matches) apply(system.matches ? 'dark' : 'light'); };
  system.addEventListener('change', follow);
  addEventListener('afterprint', follow);

  addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    apply(root.dataset.theme);
    btn.addEventListener('click', () => {
      saved = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, saved); } catch { /* choice lasts for this page only */ }
      apply(saved);
    });
  });
})();
