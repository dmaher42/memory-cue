(function () {
  const html = document.documentElement;
  const stored = localStorage.getItem('theme');
  if (stored) html.setAttribute('data-theme', stored);
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
})();
