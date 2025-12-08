const themeToggleButton = document.getElementById('theme-toggle-button');
const htmlElement = document.documentElement;
const themeStorageKey = 'memory-cue-theme';

if (themeToggleButton) {
  const themeIcon = themeToggleButton.querySelector('.material-symbols-rounded');

  const updateIcon = (theme) => {
    if (theme === 'professional-dark') {
      themeIcon.textContent = 'light_mode';
    } else {
      themeIcon.textContent = 'dark_mode';
    }
  };

  // Load saved theme
  const savedTheme = localStorage.getItem(themeStorageKey) || 'light';
  htmlElement.setAttribute('data-theme', savedTheme);
  updateIcon(savedTheme);

  themeToggleButton.addEventListener('click', () => {
    const newTheme = htmlElement.getAttribute('data-theme') === 'light' ? 'professional-dark' : 'light';
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(themeStorageKey, newTheme);
    updateIcon(newTheme);
  });
}
