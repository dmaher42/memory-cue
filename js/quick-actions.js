const QUICK_ACTIONS = [
  {
    id: 'add-reminder',
    label: 'Add reminder',
    icon: '⏰',
    description: 'Create a reminder',
    attributes: {
      'data-open-reminder-modal': '',
      'aria-haspopup': 'dialog',
      'aria-controls': 'add-reminder-form',
    },
  },
  {
    id: 'new-note',
    label: 'New note',
    icon: '📝',
    description: 'Start a fresh note',
    onActivate: handleNewNoteShortcut,
  },
  {
    id: 'activity-ideas',
    label: 'Activity ideas',
    icon: '✨',
    description: 'Brainstorm lessons',
    onActivate: () => {
      openActivityIdeasModal();
    },
  },
];

let activityIdeasModalCleanup = null;
let activityIdeasPreviousFocus = null;

function isFocusable(element) {
  if (!element) {
    return false;
  }
  if (!(element instanceof HTMLElement) && !(typeof SVGElement !== 'undefined' && element instanceof SVGElement)) {
    return false;
  }
  if (element.hasAttribute('disabled')) {
    return false;
  }
  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  if (element.tabIndex === -1 && !element.hasAttribute('tabindex')) {
    return false;
  }
  if (element.hidden || element.closest('[hidden]')) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getFocusableElements(container) {
  if (!(container instanceof HTMLElement)) {
    return [];
  }
  const selectors = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ];
  const nodes = container.querySelectorAll(selectors.join(','));
  return Array.from(nodes).filter((node) => isFocusable(node));
}

function focusFirstElement(container) {
  const candidates = getFocusableElements(container);
  const preferred =
    container?.querySelector('[data-autofocus]') ||
    (activityIdeasPreviousFocus && container?.contains(activityIdeasPreviousFocus) ? activityIdeasPreviousFocus : null) ||
    candidates[0];

  if (preferred && typeof preferred.focus === 'function') {
    try {
      preferred.focus({ preventScroll: true });
    } catch {
      preferred.focus();
    }
  }
}

export function closeActivityIdeasModal() {
  if (typeof document === 'undefined') {
    return;
  }
  const modal = document.getElementById('activity-ideas-modal');
  if (!modal || modal.dataset.open !== 'true') {
    return;
  }

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  modal.setAttribute('hidden', '');
  modal.dataset.open = 'false';

  if (typeof activityIdeasModalCleanup === 'function') {
    activityIdeasModalCleanup();
    activityIdeasModalCleanup = null;
  }

  const target = activityIdeasPreviousFocus;
  activityIdeasPreviousFocus = null;
  if (target && typeof target.focus === 'function') {
    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }
  }
}

export function openActivityIdeasModal() {
  if (typeof document === 'undefined') {
    return;
  }
  const modal = document.getElementById('activity-ideas-modal');
  if (!modal || modal.dataset.open === 'true') {
    return;
  }

  const dialog = modal.querySelector('[role="dialog"]');
  const closeButtons = modal.querySelectorAll('[data-close-modal]');
  const backdropTarget = modal.querySelector('[data-activity-ideas-backdrop]') || modal;

  activityIdeasPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeActivityIdeasModal();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = getFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !dialog?.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleCloseClick = (event) => {
    event.preventDefault();
    closeActivityIdeasModal();
  };

  const handleBackdropClick = (event) => {
    if (event.target === backdropTarget) {
      closeActivityIdeasModal();
    }
  };

  closeButtons.forEach((button) => button.addEventListener('click', handleCloseClick));
  document.addEventListener('keydown', handleKeydown);
  backdropTarget.addEventListener('click', handleBackdropClick);

  activityIdeasModalCleanup = () => {
    document.removeEventListener('keydown', handleKeydown);
    backdropTarget.removeEventListener('click', handleBackdropClick);
    closeButtons.forEach((button) => button.removeEventListener('click', handleCloseClick));
  };

  modal.classList.remove('hidden');
  modal.removeAttribute('hidden');
  modal.removeAttribute('aria-hidden');
  modal.removeAttribute('inert');
  modal.dataset.open = 'true';

  requestAnimationFrame(() => {
    focusFirstElement(dialog || modal);
  });
}

function ensureRoute(targetHash) {
  if (typeof window === 'undefined' || !targetHash) {
    return;
  }
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
    if (typeof window.renderRoute === 'function') {
      window.renderRoute();
    }
  }
}

function handleNewNoteShortcut() {
  ensureRoute('#notes');
  const button = document.getElementById('noteNewBtn');
  if (button) {
    button.click();
  }
}

function createActionButton(action, variant = 'toolbar') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    variant === 'toolbar'
      ? 'quick-action-btn inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60'
      : 'btn btn-sm btn-outline';
  button.dataset.quickAction = action.id;
  button.title = action.description;

  if (action.attributes) {
    Object.entries(action.attributes).forEach(([key, value]) => {
      if (value === '') {
        button.setAttribute(key, '');
      } else {
        button.setAttribute(key, value);
      }
    });
  }

  const iconSpan = document.createElement('span');
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = action.icon;

  const labelSpan = document.createElement('span');
  labelSpan.textContent = action.label;

  if (variant === 'toolbar') {
    button.append(iconSpan, labelSpan);
  } else {
    const textWrapper = document.createElement('span');
    textWrapper.className = 'inline-flex items-center gap-1';
    textWrapper.append(iconSpan, labelSpan);
    button.appendChild(textWrapper);
  }

  if (typeof action.onActivate === 'function') {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      action.onActivate();
    });
  }

  return button;
}

function renderQuickActions(target, variant) {
  if (!target) {
    return;
  }
  const fragment = document.createDocumentFragment();
  QUICK_ACTIONS.forEach((action) => {
    fragment.appendChild(createActionButton(action, variant));
  });
  target.innerHTML = '';
  target.appendChild(fragment);
}

function initQuickActionToolbar() {
  const toolbar = document.getElementById('quick-action-toolbar');
  if (!toolbar) {
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-wrap items-center gap-3';
  renderQuickActions(wrapper, 'toolbar');
  toolbar.innerHTML = '';
  toolbar.appendChild(wrapper);
  toolbar.hidden = false;
  toolbar.removeAttribute('hidden');
}

function initActionShortcutsCard() {
  const container = document.querySelector('[data-action-shortcuts-target]');
  if (!container) {
    return;
  }
  renderQuickActions(container, 'card');
  const fallback = document.querySelector('[data-action-shortcuts-fallback]');
  if (fallback) {
    fallback.setAttribute('hidden', 'hidden');
    fallback.classList.add('hidden');
  }
}

function initQuickActions() {
  if (typeof document === 'undefined') {
    return;
  }
  initQuickActionToolbar();
  initActionShortcutsCard();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuickActions, { once: true });
  } else {
    initQuickActions();
  }
}

if (typeof window !== 'undefined') {
  window.openActivityIdeasModal = openActivityIdeasModal;
  window.closeActivityIdeasModal = closeActivityIdeasModal;
}
