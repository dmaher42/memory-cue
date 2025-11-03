(function () {
  const html = document.documentElement;
  const STORAGE_KEY = 'theme';

  const fallbackApplyTheme = (theme) => {
    const next = theme === 'dark' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    html.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage might be unavailable */
    }
  };

  const applyTheme =
    typeof window !== 'undefined' && typeof window.__mcApplyTheme === 'function'
      ? window.__mcApplyTheme
      : fallbackApplyTheme;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      applyTheme(stored);
    }
  } catch {
    /* ignore storage read failures */
  }

  const toggleTheme = () => {
    const current = html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      toggleTheme();
    });
  }
})();
