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

  const themeToggleBtns = Array.from(document.querySelectorAll('#themeToggle')).filter(
    (btn) => btn instanceof HTMLElement
  );
  if (themeToggleBtns.length) {
    const handleToggle = (event) => {
      event.preventDefault();
      toggleTheme();
    };
    themeToggleBtns.forEach((btn) => {
      btn.addEventListener('click', handleToggle);
    });
  }
})();
