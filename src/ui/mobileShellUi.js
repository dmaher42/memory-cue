import { startSignInFlow, startSignOutFlow } from '../../js/auth.js';

export const initHeaderIconShortcuts = () => {
  const notifShortcutButton = document.getElementById('notifHeaderBtn');
  const notificationCta = document.getElementById('notifBtn');

  if (notifShortcutButton instanceof HTMLElement && notificationCta instanceof HTMLElement) {
    notifShortcutButton.addEventListener('click', () => {
      notificationCta.click();
    });
  }
};

export const initHeaderOverflowMenu = () => {
  const menuBtn =
    document.getElementById('headerMenuBtn') ||
    document.getElementById('overflowMenuBtn') ||
    document.getElementById('headerMenuBtnSlim');

  const menu =
    document.getElementById('headerMenu') ||
    document.getElementById('overflowMenu') ||
    document.getElementById('headerMenuSlim');

  if (!(menuBtn instanceof HTMLElement) || !(menu instanceof HTMLElement)) {
    return;
  }

  menuBtn.dataset.overflowMenuHandled = 'mobile-shell-ui';

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

  let restoreFocusTo = menuBtn;

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.hasAttribute('disabled')) return false;
    if (element.tabIndex < 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  const getFocusableItems = () =>
    Array.from(menu.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);

  const focusElement = (element) => {
    if (!(element instanceof HTMLElement) || typeof element.focus !== 'function') {
      return false;
    }

    try {
      element.focus();
      return true;
    } catch {
      return false;
    }
  };

  const focusFirstDescendant = (container) => {
    if (!(container instanceof HTMLElement)) {
      return false;
    }

    const firstFocusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).find(isVisible);
    return focusElement(firstFocusable);
  };

  const updateAriaHidden = () => {
    const hidden = menu.classList.contains('hidden');
    menu.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if (hidden) {
      menu.setAttribute('inert', '');
    } else {
      menu.removeAttribute('inert');
    }
  };

  updateAriaHidden();

  const handleFocusIn = (event) => {
    if (!menu.contains(event.target) && event.target !== menuBtn) {
      closeMenu({ restoreFocus: false });
    }
  };

  const focusFirstItem = () => {
    const [firstItem] = getFocusableItems();
    if (firstItem instanceof HTMLElement) {
      try {
        firstItem.focus();
      } catch {
        /* ignore */
      }
    }
  };

  const positionMenu = () => {
    if (menu.classList.contains('hidden')) {
      menu.style.left = '';
      menu.style.right = '';
      menu.style.top = '';
      return;
    }

    const parentRect = menu.parentElement?.getBoundingClientRect?.() || menuBtn.parentElement?.getBoundingClientRect?.();
    const buttonRect = menuBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    if (!parentRect) {
      return;
    }

    const top = Math.max(0, buttonRect.bottom - parentRect.top + 6);
    const left = Math.max(
      8,
      Math.min(
        buttonRect.right - parentRect.left - menuRect.width,
        parentRect.width - menuRect.width - 8,
      ),
    );

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
  };

  const openMenu = () => {
    if (!menu.classList.contains('hidden')) return;
    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : menuBtn;
    menu.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    updateAriaHidden();
    positionMenu();
    document.addEventListener('focusin', handleFocusIn);

    if (!menu.contains(document.activeElement)) {
      focusFirstItem();
    }
  };

  const getSafeFocusTarget = ({ restoreFocus = true, focusTarget = null } = {}) => {
    const candidates = [
      focusTarget instanceof HTMLElement ? focusTarget : null,
      restoreFocus ? restoreFocusTo : null,
      menuBtn,
      document.body instanceof HTMLElement ? document.body : null,
    ];

    return candidates.find((candidate) => isVisible(candidate)) || null;
  };

  const moveFocusSafely = (target) => {
    if (!(target instanceof HTMLElement) || typeof target.focus !== 'function') {
      return;
    }

    try {
      target.focus({ preventScroll: true });
    } catch {
      try {
        target.focus();
      } catch {
        /* ignore */
      }
    }
  };

  const closeMenu = ({ restoreFocus = true, focusTarget = null } = {}) => {
    if (menu.classList.contains('hidden')) return;

    const activeElement = document.activeElement;
    const activeInsideMenu = activeElement instanceof HTMLElement && menu.contains(activeElement);
    const safeFocusTarget = activeInsideMenu
      ? getSafeFocusTarget({ restoreFocus, focusTarget })
      : null;

    if (safeFocusTarget && safeFocusTarget !== activeElement) {
      moveFocusSafely(safeFocusTarget);
    }

    menu.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    updateAriaHidden();
    document.removeEventListener('focusin', handleFocusIn);

    if (
      safeFocusTarget &&
      document.activeElement !== safeFocusTarget &&
      !menu.contains(document.activeElement)
    ) {
      moveFocusSafely(safeFocusTarget);
    }
  };

  const runMenuAction = (callback, options = {}) => {
    const {
      restoreFocus = false,
      focusTarget = menuBtn,
      defer = true,
    } = options;

    closeMenu({ restoreFocus, focusTarget });

    if (typeof callback !== 'function') {
      return;
    }

    const runCallback = () => {
      try {
        callback();
      } catch (error) {
        console.warn('[overflow-menu] action failed', error);
      }
    };

    if (!defer) {
      runCallback();
      return;
    }

    requestAnimationFrame(runCallback);
  };

  const applyTheme = (theme) => {
    const root = document.documentElement;
    if (!root) return;

    if (theme) {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }

    try {
      window.localStorage?.setItem('mc-theme', theme || '');
    } catch {
      /* ignore */
    }
  };

  const applyLayout = (variant) => {
    const body = document.body;
    if (!body) return;

    body.classList.remove('layout-cozy', 'layout-compact');
    if (variant) {
      body.classList.add(`layout-${variant}`);
    }
  };

  const getMenuActionTarget = (event) => {
    const target = event.target;
    if (typeof Element === 'undefined' || !(target instanceof Element)) return null;
    return target.closest('[data-menu-action]');
  };

  const handleMenuAction = (event) => {
    const button = getMenuActionTarget(event);
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.getAttribute('data-menu-action');
    if (!action) return;

    switch (action) {
      case 'completed':
      case 'completed-reminders': {
        const completedTab =
          document.querySelector('[data-reminders-tab="completed"]') ||
          document.querySelector('[data-reminders-filter="completed"]');
        runMenuAction(() => {
          if (completedTab instanceof HTMLElement) {
            completedTab.click();
            focusElement(completedTab);
          } else if (typeof window.setMobileRemindersFilter === 'function') {
            window.setMobileRemindersFilter('completed');
          }
        });
        break;
      }

      case 'settings': {
        const settingsTrigger = document.querySelector('[data-open="settings"]');
        const settingsModal = document.getElementById('settingsModal');
        runMenuAction(() => {
          if (settingsTrigger instanceof HTMLElement) {
            settingsTrigger.click();
          } else if (settingsModal instanceof HTMLElement) {
            settingsModal.classList.remove('hidden');
            settingsModal.removeAttribute('aria-hidden');
          }

          const primaryFocusTarget =
            document.getElementById('settingsCloseBtn') ||
            document.getElementById('closeSettings') ||
            settingsModal;

          if (!focusElement(primaryFocusTarget)) {
            focusFirstDescendant(settingsModal);
          }
        });
        break;
      }

      case 'saved-notes': {
        runMenuAction(() => {
          try {
            if (typeof window.showSavedNotesSheet === 'function') {
              window.showSavedNotesSheet();
            } else {
              const trigger =
                document.getElementById('openSavedNotesGlobal') ||
                document.getElementById('openSavedNotesSheetButton') ||
                document.getElementById('openSavedNotesSheet') ||
                document.getElementById('savedNotesShortcut') ||
                document.querySelector('.open-saved-notes-global');
              if (trigger instanceof HTMLElement) {
                trigger.click();
                focusElement(trigger);
              }
            }
          } catch (error) {
            console.warn('[overflow-menu] failed to open saved notes sheet', error);
          }
        });
        break;
      }

      case 'sign-in': {
        const primarySignInBtn = document.getElementById('googleSignInBtn');
        runMenuAction(() => {
          if (primarySignInBtn instanceof HTMLElement) {
            primarySignInBtn.click();
            focusElement(primarySignInBtn);
          } else {
            startSignInFlow().catch((error) => {
              console.warn('[overflow-menu] sign-in failed', error);
            });
          }
        }, { defer: false });
        break;
      }

      case 'sign-out': {
        const primarySignOutBtn = document.getElementById('googleSignOutBtn');
        runMenuAction(() => {
          if (primarySignOutBtn instanceof HTMLElement) {
            primarySignOutBtn.click();
            focusElement(primarySignOutBtn);
          } else {
            startSignOutFlow().catch((error) => {
              console.warn('[overflow-menu] sign-out failed', error);
            });
          }
        }, { defer: false });
        break;
      }

      case 'sync-all':
      case 'sync-now': {
        const syncBtn = document.getElementById('syncAll');
        runMenuAction(() => {
          if (syncBtn instanceof HTMLElement) {
            syncBtn.click();
            focusElement(syncBtn);
          } else if (window.remindersController && typeof window.remindersController.syncAll === 'function') {
            window.remindersController.syncAll().catch(() => {});
          } else if (typeof window.syncAllReminders === 'function') {
            window.syncAllReminders();
          }
        });
        break;
      }

      case 'theme-light':
        runMenuAction(() => {
          applyTheme('light');
        });
        break;
      case 'theme-dark':
        runMenuAction(() => {
          applyTheme('dark');
        });
        break;
      case 'theme-professional-dark':
        runMenuAction(() => {
          applyTheme('professional-dark');
        });
        break;

      case 'layout-cozy':
        runMenuAction(() => {
          applyLayout('cozy');
        });
        break;
      case 'layout-compact':
        runMenuAction(() => {
          applyLayout('compact');
        });
        break;

      case 'about': {
        const aboutTrigger =
          document.querySelector('[data-open="about"]') ||
          document.getElementById('aboutMemoryCueBtn');
        runMenuAction(() => {
          if (aboutTrigger instanceof HTMLElement) {
            aboutTrigger.click();
            focusElement(aboutTrigger);
          } else if (typeof window.showAboutMemoryCue === 'function') {
            window.showAboutMemoryCue();
          }
        });
        break;
      }

      default:
        closeMenu();
        break;
    }
  };

  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('hidden')) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target === menuBtn || menu.contains(event.target)) {
      return;
    }
    closeMenu({ restoreFocus: false });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }

    if (event.key === 'ArrowDown' && !menu.classList.contains('hidden')) {
      event.preventDefault();
      focusFirstItem();
    }
  });

  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) {
      positionMenu();
    }
  });

  menu.addEventListener('click', handleMenuAction);

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const items = getFocusableItems();
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);
    const lastIndex = items.length - 1;
    let nextIndex = currentIndex;

    if (event.shiftKey) {
      nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    } else {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    }

    event.preventDefault();
    const target = items[nextIndex] || items[0];
    if (target instanceof HTMLElement) {
      try {
        target.focus();
      } catch {
        /* ignore */
      }
    }
  });
};

export const initVoiceAddBridge = () => {
  const voiceAddBtn = document.getElementById('voiceAddBtn');

  if (!(voiceAddBtn instanceof HTMLElement)) {
    return;
  }

  const getVoiceBtn = () => {
    const el =
      document.getElementById('startVoiceCaptureGlobal') ||
      document.getElementById('quickAddVoice');
    return el instanceof HTMLElement ? el : null;
  };

  const syncVoiceAvailability = () => {
    const voiceBtn = getVoiceBtn();
    if (!voiceBtn) return;

    const applyState = () => {
      const isDisabled =
        voiceBtn.hasAttribute('disabled') ||
        voiceBtn.getAttribute('aria-disabled') === 'true';

      if (isDisabled) {
        voiceAddBtn.setAttribute('disabled', 'true');
        voiceAddBtn.setAttribute('aria-disabled', 'true');
      } else {
        voiceAddBtn.removeAttribute('disabled');
        voiceAddBtn.removeAttribute('aria-disabled');
      }

      const title = voiceBtn.getAttribute('title');
      if (title) {
        voiceAddBtn.setAttribute('title', title);
      }
    };

    applyState();

    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(applyState);
      observer.observe(voiceBtn, {
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'title'],
      });
    }
  };

  const startDictation = () => {
    const voiceBtn = getVoiceBtn();
    if (!voiceBtn) return;

    if (voiceBtn.hasAttribute('disabled') || voiceBtn.getAttribute('aria-disabled') === 'true') {
      return;
    }

    try {
      voiceBtn.focus({ preventScroll: true });
    } catch {
      try {
        voiceBtn.focus();
      } catch {
        /* ignore */
      }
    }

    try {
      voiceBtn.click();
    } catch (error) {
      console.warn('Voice add trigger failed', error);
    }
  };

  syncVoiceAvailability();

  voiceAddBtn.addEventListener('click', (event) => {
    event.preventDefault();

    let didTrigger = false;
    let fallbackTimer = null;

    const startIfNeeded = () => {
      if (didTrigger) return;
      didTrigger = true;
      document.removeEventListener('reminder:sheet-opened', handleOpened);
      startDictation();
    };

    const handleOpened = (evt) => {
      if (evt?.detail?.trigger !== voiceAddBtn) return;

      if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function' && fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }

      const delayFn =
        typeof window !== 'undefined' && typeof window.setTimeout === 'function'
          ? window.setTimeout
          : setTimeout;

      delayFn(startIfNeeded, 150);
    };

    document.addEventListener('reminder:sheet-opened', handleOpened);

    try {
      document.dispatchEvent(
        new CustomEvent('cue:open', {
          detail: { trigger: voiceAddBtn },
        }),
      );
    } catch (error) {
      document.removeEventListener('reminder:sheet-opened', handleOpened);
      if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function' && fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      console.warn('Voice add open failed', error);
      return;
    }

    const sheet = document.getElementById('create-sheet');
    if (sheet instanceof HTMLElement && sheet.classList.contains('open')) {
      const delayFn =
        typeof window !== 'undefined' && typeof window.setTimeout === 'function'
          ? window.setTimeout
          : setTimeout;
      fallbackTimer = delayFn(startIfNeeded, 120);
    }
  });
};

export const initReminderFilterToggle = () => {
  const toggleBtn = document.getElementById('toggleReminderFilters');
  const filterPanel = document.getElementById('reminderFilters');

  if (!(toggleBtn instanceof HTMLElement) || !(filterPanel instanceof HTMLElement)) {
    return;
  }

  const focusSelectors = ['input', 'select', 'button', 'textarea', '[tabindex]:not([tabindex="-1"])'];

  const syncState = () => {
    const isOpen = filterPanel.hasAttribute('open');
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    toggleBtn.classList.toggle('btn-active', isOpen);
  };

  const focusFirstControl = () => {
    for (const selector of focusSelectors) {
      const control = filterPanel.querySelector(selector);
      if (control instanceof HTMLElement && !control.hasAttribute('disabled')) {
        try {
          control.focus({ preventScroll: true });
        } catch {
          control.focus();
        }
        return;
      }
    }
  };

  toggleBtn.addEventListener('click', () => {
    const isOpen = filterPanel.hasAttribute('open');
    filterPanel.open = !isOpen;
    if (!isOpen) {
      focusFirstControl();
    }
    syncState();
  });

  filterPanel.addEventListener('toggle', syncState);
  syncState();
};

export const initReminderSheetCloseOnUpdate = () => {
  const sheetEl = document.getElementById('create-sheet');

  if (!(sheetEl instanceof HTMLElement)) {
    return;
  }

  function closeSheetIfOpen() {
    if (!sheetEl.classList.contains('open') && sheetEl.classList.contains('hidden')) {
      return;
    }
    if (typeof window !== 'undefined' && typeof window.closeAddTask === 'function') {
      window.closeAddTask();
    }
  }

  document.addEventListener('memoryCue:remindersUpdated', closeSheetIfOpen);
  document.addEventListener('reminders:updated', closeSheetIfOpen);
};

export const initReminderTotalCount = () => {
  document.addEventListener('memoryCue:remindersUpdated', (event) => {
    const totalCountEl = document.getElementById('totalCount');
    if (!totalCountEl) return;
    const total = Array.isArray(event?.detail?.items) ? event.detail.items.length : 0;
    totalCountEl.textContent = String(total);
  });
};

export const initSettingsModal = () => {
  const openButtons = Array.from(
    new Set([
      ...Array.from(document.querySelectorAll('[data-open="settings"]')),
      ...Array.from(document.querySelectorAll('#openSettings')),
    ]),
  ).filter((btn) => btn instanceof HTMLElement);

  const modal = document.getElementById('settingsModal');
  const closeBtn =
    document.getElementById('settingsCloseBtn') ||
    document.getElementById('closeSettings');

  if (!openButtons.length || !(modal instanceof HTMLElement) || !(closeBtn instanceof HTMLElement)) {
    return;
  }

  function open() {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function close() {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  openButtons.forEach((btn) => {
    btn.addEventListener('click', open);
  });

  closeBtn.addEventListener('click', close);

  modal.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.matches('[data-close]')) {
      close();
    }
  });

  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });
};

export const initMobileShellUi = () => {
  initHeaderIconShortcuts();
  initHeaderOverflowMenu();
  initVoiceAddBridge();
  initReminderFilterToggle();
  initReminderSheetCloseOnUpdate();
  initReminderTotalCount();
  initSettingsModal();
};
