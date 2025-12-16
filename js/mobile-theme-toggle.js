const themeToggleButton =
  document.getElementById('themeToggle') || document.getElementById('theme-toggle-button');
const htmlElement = document.documentElement;
const themeStorageKey = 'memory-cue-theme';

if (themeToggleButton) {
  const themeIcon =
    themeToggleButton.querySelector('.quick-action-icon') ||
    themeToggleButton.querySelector('.material-symbols-rounded');

  const updateIcon = (theme) => {
    if (!themeIcon) return;
    if (theme === 'professional-dark') {
      themeIcon.textContent = themeIcon.classList.contains('quick-action-icon') ? '🌞' : 'light_mode';
    } else {
      themeIcon.textContent = themeIcon.classList.contains('quick-action-icon') ? '🌗' : 'dark_mode';
    }
  };

  // Load saved theme
  const savedTheme = localStorage.getItem(themeStorageKey) || 'light';
  htmlElement.setAttribute('data-theme', savedTheme);
  updateIcon(savedTheme);

  themeToggleButton.addEventListener('click', () => {
    const newTheme =
      htmlElement.getAttribute('data-theme') === 'light' ? 'professional-dark' : 'light';
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(themeStorageKey, newTheme);
    updateIcon(newTheme);
  });
}
