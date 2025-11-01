
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

    if (!button) {
      return;
    }

    button.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      safeSetItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme);
      updateThemeButton(button, theme);
    });
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

  function initMobileNav() {
    const toggle = document.getElementById('mobile-nav-toggle');
    const menu = document.getElementById('mobile-nav-menu');
    if (!toggle || !menu) return;

    const close = () => {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onOutsideClick, true);
    };

    const open = () => {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      const first = menu.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('click', onOutsideClick, true);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    const onOutsideClick = (event) => {
      if (!menu.contains(event.target) && event.target !== toggle) {
        close();
      }
    };

    toggle.addEventListener('click', () => {
      if (menu.hidden) {
        open();
      } else {
        close();
      }
    });

    menu.addEventListener('click', (event) => {
      const link = event.target.closest('[data-nav]');
      if (link) {
        close();
      }
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
    initMobileNav();
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
