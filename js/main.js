
import { initViewportHeight } from './modules/viewport-height.js';

initViewportHeight();

(function () {
  if (typeof document === 'undefined') {
    return;
  }

  const THEME_STORAGE_KEY = 'theme';
  const DEFAULT_THEME = 'light';

  function safeGetItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.warn('Memory Cue: unable to read storage', error);
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn('Memory Cue: unable to persist storage', error);
    }
  }

  const THEME_CHANGE_EVENT = 'memoryCue:theme-change';

  function dispatchThemeChange(theme) {
    if (typeof window === 'undefined' || !theme) return;
    try {
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
    } catch (error) {
      if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
        const fallbackEvent = document.createEvent('CustomEvent');
        fallbackEvent.initCustomEvent(THEME_CHANGE_EVENT, true, true, { theme });
        window.dispatchEvent(fallbackEvent);
      }
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function resolveInitialTheme() {
    const stored = safeGetItem(THEME_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const prefersDark = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = prefersDark ? 'dark' : DEFAULT_THEME;
    safeSetItem(THEME_STORAGE_KEY, theme);
    return theme;
  }

  function updateThemeButton(button, theme) {
    if (!button) return;
    const icon = theme === 'dark'
      ? button.dataset.iconDark || '🌙'
      : button.dataset.iconLight || '☀️';
    button.textContent = icon;
    const label = theme === 'dark'
      ? 'Switch to light theme'
      : 'Switch to dark theme';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }

  function initThemeToggle() {
    const button = document.getElementById('theme-toggle');
    let theme = resolveInitialTheme();
    applyTheme(theme);
    updateThemeButton(button, theme);
    dispatchThemeChange(theme);

    if (!button) {
      return;
    }

    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      safeSetItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme);
      updateThemeButton(button, theme);
      dispatchThemeChange(theme);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener(THEME_CHANGE_EVENT, (event) => {
        const newTheme = event?.detail?.theme;
        if (!newTheme) {
          return;
        }
        if (newTheme !== theme) {
          theme = newTheme;
          safeSetItem(THEME_STORAGE_KEY, theme);
          applyTheme(theme);
        }
        updateThemeButton(button, theme);
      });
    }
  }

  function getCurrentRoute() {
    if (typeof window === 'undefined') return 'dashboard';
    const hash = window.location.hash || '#dashboard';
    const route = hash.startsWith('#') ? hash.slice(1) : hash;
    return route || 'dashboard';
  }

  function updateActiveNavigation(route) {
    document.querySelectorAll('[data-nav]').forEach((link) => {
      const target = link.dataset.nav;
      const isActive = target === route;
      if (isActive) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('btn-active');
      } else {
        link.removeAttribute('aria-current');
        link.classList.remove('btn-active');
      }
    });
  }

  function ensureDefaultHash() {
    if (typeof window === 'undefined') return;
    if (!window.location.hash) {
      window.location.replace('#dashboard');
    }
  }

  function initSkipLink() {
    const skipLink = document.querySelector('a.skip-link');
    const main = document.getElementById('mainContent');
    if (!skipLink || !main) return;

    skipLink.addEventListener('click', (event) => {
      const targetId = (skipLink.getAttribute('href') || '').replace('#', '');
      if (targetId !== main.id) return;
      event.preventDefault();
      window.requestAnimationFrame(() => {
        if (typeof main.focus === 'function') {
          main.focus({ preventScroll: false });
        }
      });
    });
  }

  function handleRouteUpdate() {
    const route = getCurrentRoute();
    updateActiveNavigation(route);
    if (typeof window !== 'undefined' && typeof window.renderRoute === 'function') {
      window.renderRoute();
    }
  }

  function init() {
    ensureDefaultHash();
    initThemeToggle();
    initSkipLink();
    handleRouteUpdate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      updateActiveNavigation(getCurrentRoute());
    });
  }
})();
