
import { initViewportHeight } from './modules/viewport-height.js';

initViewportHeight();

(function () {
  if (typeof document === 'undefined') {
    return;
  }

  const THEME_STORAGE_KEY = 'theme';
  const DEFAULT_THEME = 'professional';
  const SUPPORTED_THEMES = ['professional', 'night'];
  const LEGACY_THEME_MAP = {
    dark: 'night',
    light: 'professional',
  };

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
    document.documentElement.dataset.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
  }

  function normalizeTheme(theme) {
    if (!theme) return DEFAULT_THEME;
    if (SUPPORTED_THEMES.includes(theme)) {
      return theme;
    }
    if (LEGACY_THEME_MAP[theme]) {
      return LEGACY_THEME_MAP[theme];
    }
    return DEFAULT_THEME;
  }

  function resolveInitialTheme() {
    const stored = safeGetItem(THEME_STORAGE_KEY);
    const normalized = normalizeTheme(stored);
    if (normalized !== stored && stored) {
      safeSetItem(THEME_STORAGE_KEY, normalized);
    }
    return normalized;
  }

  function getNextTheme(current) {
    const currentIndex = SUPPORTED_THEMES.indexOf(current);
    if (currentIndex === -1) {
      return SUPPORTED_THEMES[0];
    }
    return SUPPORTED_THEMES[(currentIndex + 1) % SUPPORTED_THEMES.length];
  }

  function getThemeIcon(button, theme) {
    const dataset = button?.dataset || {};
    switch (theme) {
      case 'night':
        return dataset.iconNight || dataset.iconDark || '🌙';
      case 'professional':
      default:
        return dataset.iconProfessional || dataset.iconLight || '💼';
    }
  }

  function getThemeLabel(theme) {
    switch (theme) {
      case 'night':
        return 'Theme: Night';
      case 'professional':
      default:
        return 'Theme: Professional';
    }
  }

  function updateThemeButton(button, theme) {
    if (!button) return;
    button.textContent = getThemeIcon(button, theme);
    button.setAttribute('aria-label', getThemeLabel(theme));
    button.setAttribute('aria-pressed', theme === DEFAULT_THEME ? 'false' : 'true');
  }

  function initThemeToggle() {
    const button = document.getElementById('theme-toggle');
    let theme = resolveInitialTheme();
    if (!SUPPORTED_THEMES.includes(theme)) {
      theme = DEFAULT_THEME;
    }
    applyTheme(theme);
    updateThemeButton(button, theme);
    dispatchThemeChange(theme);

    if (!button) {
      return;
    }

    button.addEventListener('click', () => {
      theme = getNextTheme(theme);
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
        if (!SUPPORTED_THEMES.includes(newTheme)) {
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
