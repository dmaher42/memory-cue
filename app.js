import { initViewportHeight } from './js/modules/viewport-height.js';
import { initReminders } from './js/reminders.js';
import { startSignInFlow, startSignOutFlow } from './js/supabase-auth.js';
import {
  CUE_FIELD_DEFINITIONS,
  DEFAULT_CUE_MODAL_TITLE,
  EDIT_CUE_MODAL_TITLE,
  getFieldElements,
  getCueFieldValueFromData,
  populateCueFormFields,
  clearCueFormFields,
  gatherCueFormData,
  escapeCueText
} from './js/modules/field-helpers.js';
import { createModalController } from './js/modules/modal-controller.js';
import { initSupabaseAuth } from './js/supabase-auth.js';

initViewportHeight();

function initReminderModalUI() {
  if (typeof document === 'undefined') {
    return;
  }

  const modal = document.getElementById('add-reminder-modal') ?? document.getElementById('reminder-modal');
  const form = document.getElementById('add-reminder-form') ?? document.getElementById('reminder-form');
  const titleField = document.getElementById('reminder-title');

  if (!modal || !form || !titleField) {
    return;
  }

  const openButtons = document.querySelectorAll('[data-open-reminder-modal]');

  if (!openButtons.length) {
    return;
  }

  const backdrop = modal.querySelector('[data-reminder-modal-backdrop]');
  const closeButtons = modal.querySelectorAll('[data-close-modal]');
  const mainContent = document.getElementById('mainContent');
  const primaryNav = document.querySelector('nav[aria-label="Primary"]');
  const backgroundTargets = [mainContent, primaryNav];
  const focusTrapRoot = modal.querySelector('[role="dialog"]') ?? modal;
  const focusableSelectors = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ];

  let lastActiveElement = null;

  const getFocusableElements = () => {
    if (!(focusTrapRoot instanceof HTMLElement)) {
      return [];
    }

    const nodes = focusTrapRoot.querySelectorAll(focusableSelectors.join(','));

    return Array.from(nodes).filter((element) => {
      const isHtmlElement = element instanceof HTMLElement;
      const isSvgElement = typeof SVGElement !== 'undefined' && element instanceof SVGElement;

      if (!isHtmlElement && !isSvgElement) {
        return false;
      }

      if (element.getAttribute('aria-hidden') === 'true') {
        return false;
      }

      if ('disabled' in element && element.disabled) {
        return false;
      }

      if (element.hidden || element.closest('[hidden]')) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };

  const focusFirstElement = () => {
    const focusableElements = getFocusableElements();
    const preferredElement =
      focusableElements.find((node) => node.hasAttribute('data-autofocus') || node.hasAttribute('autofocus')) ||
      (titleField && focusableElements.includes(titleField) ? titleField : null) ||
      focusableElements[0];

    if (preferredElement && typeof preferredElement.focus === 'function') {
      preferredElement.focus({ preventScroll: true });
      return;
    }

    if (focusTrapRoot instanceof HTMLElement && typeof focusTrapRoot.focus === 'function') {
      focusTrapRoot.focus({ preventScroll: true });
    }
  };

  const enforceFocusWithinModal = (event) => {
    if (!(focusTrapRoot instanceof HTMLElement)) {
      return;
    }

    if (!(event.target instanceof Node) || !focusTrapRoot.contains(event.target)) {
      event.stopPropagation();
      focusFirstElement();
    }
  };

  const handleTabKey = (event) => {
    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableElements();

    if (!focusableElements.length) {
      event.preventDefault();
      if (focusTrapRoot instanceof HTMLElement) {
        focusTrapRoot.focus({ preventScroll: true });
      }
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (!focusTrapRoot.contains(activeElement) || activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (!focusTrapRoot.contains(activeElement) || activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const setBackgroundInert = (shouldInert) => {
    backgroundTargets.forEach((node) => {
      if (!node) {
        return;
      }
      if (shouldInert) {
        node.setAttribute('inert', '');
      } else {
        node.removeAttribute('inert');
      }
    });
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('inert', '');
    setBackgroundInert(false);
    document.removeEventListener('keydown', handleEscape, true);
    modal.removeEventListener('keydown', handleTabKey, true);
    modal.removeEventListener('focusin', enforceFocusWithinModal, true);
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
    lastActiveElement = null;
  };

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  };

  const openModal = ({ triggerElement } = {}) => {
    if (triggerElement && typeof triggerElement.focus === 'function') {
      lastActiveElement = triggerElement;
    } else {
      lastActiveElement = document.activeElement;
    }
    modal.classList.remove('hidden');
    modal.removeAttribute('aria-hidden');
    modal.removeAttribute('inert');
    setBackgroundInert(true);
    document.addEventListener('keydown', handleEscape, true);
    modal.addEventListener('keydown', handleTabKey, true);
    modal.addEventListener('focusin', enforceFocusWithinModal, true);
    window.requestAnimationFrame(() => {
      focusFirstElement();
    });
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const triggerElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      openModal({ triggerElement });
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      closeModal();
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  const remindersList = document.getElementById('reminders-list');
  const dateField = document.getElementById('reminder-date');
  const priorityField = document.getElementById('reminder-priority');
  const notesField = document.getElementById('reminder-notes');

  const formatDueDate = (value) => {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const createReminderItem = ({ title, dueDate, priority, notes }) => {
    if (typeof document === 'undefined') {
      return null;
    }

    const item = document.createElement('li');
    item.className = 'reminder-item';

    const main = document.createElement('div');
    main.className = 'reminder-main space-y-2';
    const titleEl = document.createElement('p');
    titleEl.className = 'font-semibold text-base-content';
    titleEl.textContent = title;
    main.appendChild(titleEl);

    const detailParts = [];
    const formattedDate = formatDueDate(dueDate);
    if (formattedDate) {
      detailParts.push(`Due ${formattedDate}`);
    }

    const priorityKey = priority ? priority.trim().toLowerCase() : '';
    const priorityConfig = {
      high: { badgeClass: 'badge badge-outline text-error', badgeLabel: 'High priority', detailLabel: 'High priority' },
      medium: { badgeClass: 'badge badge-outline text-warning', badgeLabel: 'Due soon', detailLabel: 'Medium priority' },
      low: { badgeClass: 'badge badge-outline text-secondary', badgeLabel: 'Scheduled', detailLabel: 'Low priority' }
    };

    const priorityData = priorityConfig[priorityKey] ?? {
      badgeClass: 'badge badge-outline text-secondary',
      badgeLabel: 'Scheduled',
      detailLabel: priority || ''
    };

    if (priorityData.detailLabel) {
      detailParts.push(priorityData.detailLabel);
    }

    if (detailParts.length) {
      const detailsEl = document.createElement('p');
      detailsEl.className = 'text-sm text-base-content/70';
      detailsEl.textContent = detailParts.join(' · ');
      main.appendChild(detailsEl);
    }

    if (notes) {
      const notesEl = document.createElement('p');
      notesEl.className = 'text-sm text-base-content/60';
      notesEl.textContent = notes;
      main.appendChild(notesEl);
    }

    item.appendChild(main);

    const meta = document.createElement('div');
    meta.className = 'reminder-meta flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3';

    const badge = document.createElement('span');
    badge.className = priorityData.badgeClass;
    badge.textContent = priorityData.badgeLabel;
    meta.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'reminder-actions flex flex-wrap items-center justify-end gap-2';

    const completeBtn = document.createElement('button');
    completeBtn.className = 'btn btn-sm btn-success';
    completeBtn.type = 'button';
    completeBtn.textContent = 'Complete';
    completeBtn.disabled = true;
    completeBtn.title = 'Coming soon';

    const snoozeBtn = document.createElement('button');
    snoozeBtn.className = 'btn btn-sm btn-outline';
    snoozeBtn.type = 'button';
    snoozeBtn.textContent = 'Snooze';
    snoozeBtn.disabled = true;
    snoozeBtn.title = 'Coming soon';

    actions.append(completeBtn, snoozeBtn);
    meta.appendChild(actions);
    item.appendChild(meta);

    return item;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const title = titleField.value.trim();
    if (!title) {
      titleField.focus();
      return;
    }

    const notesValue = notesField?.value ?? '';
    const reminderData = {
      title,
      dueDate: dateField?.value || '',
      priority: priorityField?.value || '',
      notes: notesValue.trim()
    };

    const reminderItem = remindersList ? createReminderItem(reminderData) : null;
    if (reminderItem && remindersList) {
      remindersList.prepend(reminderItem);
    }

    form.reset();
    closeModal();
  });
}

initReminderModalUI();

let routeFocusTimeoutId = null;

function getActiveRouteFromHash() {
  if (typeof window === 'undefined') {
    return '';
  }

  const hash = window.location.hash || '#dashboard';
  const route = hash.startsWith('#') ? hash.slice(1) : hash;

  return route || 'dashboard';
}

function focusPrimaryRouteHeading(route) {
  if (typeof document === 'undefined' || !route) {
    return;
  }

  window.clearTimeout(routeFocusTimeoutId);
  routeFocusTimeoutId = window.setTimeout(() => {
    const section = document.querySelector(`[data-route="${route}"]`);
    if (!section) {
      return;
    }

    const heading = section.querySelector('h1, [data-primary-heading]');
    if (!(heading instanceof HTMLElement)) {
      return;
    }

    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }

    if (typeof heading.focus !== 'function') {
      return;
    }

    try {
      heading.focus({ preventScroll: true });
    } catch {
      heading.focus();
    }
  }, 0);
}

function scheduleRouteFocus(route) {
  const activeRoute = route || getActiveRouteFromHash();
  if (!activeRoute) {
    return;
  }

  focusPrimaryRouteHeading(activeRoute);
}

function initRouteFocusManagement() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const handleRouteFocus = () => {
    scheduleRouteFocus();
  };

  window.addEventListener('hashchange', handleRouteFocus);
  window.addEventListener('DOMContentLoaded', handleRouteFocus);

  const navLinks = document.querySelectorAll('[data-nav]');
  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!(event.currentTarget instanceof HTMLAnchorElement)) {
        return;
      }

      const href = event.currentTarget.getAttribute('href') || '';
      if (!href.startsWith('#')) {
        return;
      }

      event.preventDefault();

      const targetHash = href || '#dashboard';
      const targetRoute = targetHash.replace('#', '') || 'dashboard';

      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }

      if (typeof window.renderRoute === 'function') {
        window.renderRoute();
      }

      scheduleRouteFocus(targetRoute);
    });
  });

  if (typeof window.renderRoute === 'function') {
    window.renderRoute();
  }

  scheduleRouteFocus();
}

initRouteFocusManagement();

const settingsSaveButton = document.getElementById('settings-save-button');
const settingsSaveConfirmation = document.getElementById('settings-save-confirmation');
const liveStatusRegion = document.getElementById('live-status');
let hideSettingsSaveConfirmationTimeoutId = null;

if (settingsSaveButton && settingsSaveConfirmation) {
  settingsSaveButton.addEventListener('click', (event) => {
    event.preventDefault();
    settingsSaveConfirmation.classList.remove('hidden');
    settingsSaveConfirmation.textContent = 'Settings saved!';
    if (liveStatusRegion) {
      liveStatusRegion.textContent = 'Settings saved!';
    }
    if (hideSettingsSaveConfirmationTimeoutId) {
      window.clearTimeout(hideSettingsSaveConfirmationTimeoutId);
    }
    hideSettingsSaveConfirmationTimeoutId = window.setTimeout(() => {
      settingsSaveConfirmation.classList.add('hidden');
    }, 3000);
  });
}

const titleInput = document.getElementById('title');
const mobileTitleInput = document.getElementById('reminderText');

const modalController = (() => {
  const modalElement = document.getElementById('cue-modal') ?? document.getElementById('cue_modal');
  return createModalController({
    modalElement,
    openButton: document.getElementById('openCueModal'),
    closeButton: document.getElementById('closeCueModal'),
    backdropButton: modalElement?.querySelector('.modal-backdrop button') ?? null,
    titleInput,
    modalTitle: document.getElementById('modal-title'),
    defaultTitle: DEFAULT_CUE_MODAL_TITLE,
    editTitle: EDIT_CUE_MODAL_TITLE
  });
})();

modalController?.setEditMode(false);

const initialiseReminders = () => {
  const hasDesktopForm = Boolean(titleInput);
  const hasMobileForm = Boolean(mobileTitleInput);

  if (!hasDesktopForm && !hasMobileForm) {
    return Promise.resolve();
  }

  if (hasMobileForm) {
    return initReminders({
      variant: 'mobile',
      titleSel: '#reminderText',
      dateSel: '#reminderDate',
      timeSel: '#reminderTime',
      detailsSel: '#reminderDetails',
      prioritySel: '#priority',
      categorySel: '#category',
      saveBtnSel: '#saveReminder',
      cancelEditBtnSel: '#cancelEditBtn',
      listSel: '#reminderList',
      listWrapperSel: '#remindersWrapper',
      emptyStateSel: '#emptyState',
      statusSel: '#statusMessage',
      syncStatusSel: '#syncStatus',
      voiceBtnSel: '#voiceBtn',
      notifBtnSel: '#notifBtn',
      categoryOptionsSel: '#categorySuggestions',
      countTotalSel: '#totalCount',
      googleSignInBtnSel: '#googleSignInBtn',
      googleSignOutBtnSel: '#googleSignOutBtn',
      googleAvatarSel: '#googleAvatar',
      googleUserNameSel: '#googleUserName',
      syncAllBtnSel: '#syncAll',
      syncUrlInputSel: '#syncUrl',
      saveSettingsSel: '#saveSyncSettings',
      testSyncSel: '#testSync',
      openSettingsSel: '[data-open="settings"]',
      dateFeedbackSel: '#dateFeedback'
    });
  }

  return initReminders({
    titleSel: '#title',
    dateSel: '#date',
    timeSel: '#time',
    detailsSel: '#details',
    prioritySel: '#priority',
    categorySel: '#category',
    saveBtnSel: '#saveBtn',
    cancelEditBtnSel: '#cancelEditBtn',
    listSel: '#reminderList',
    statusSel: '#auth-feedback',
    syncStatusSel: '#syncStatus',
    voiceBtnSel: '#voiceBtn',
    categoryOptionsSel: '#categorySuggestions',
    countTotalSel: '#inlineTotalCount',
    emptyStateSel: '#emptyState',
    listWrapperSel: '#remindersWrapper',
    dateFeedbackSel: '#dateFeedback',
    googleSignInBtnSel: '#googleSignInBtn',
    googleSignOutBtnSel: '#googleSignOutBtn',
    googleUserNameSel: '#googleUserName',
    variant: 'desktop'
  });
};

const desktopGoogleSignInBtn = document.getElementById('googleSignInBtn');
const desktopGoogleSignOutBtn = document.getElementById('googleSignOutBtn');

initialiseReminders()
  .then(() => {
    if (desktopGoogleSignInBtn && !desktopGoogleSignInBtn._authWired) {
      desktopGoogleSignInBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          await startSignInFlow();
        } catch (error) {
          console.error('Sign-in failed:', error);
          const feedback = document.getElementById('auth-feedback');
          if (feedback) {
            feedback.textContent = 'Sign-in failed. Please try again.';
          }
        }
      });
      desktopGoogleSignInBtn._authWired = true;
    }

    if (desktopGoogleSignOutBtn && !desktopGoogleSignOutBtn._authWired) {
      desktopGoogleSignOutBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          await startSignOutFlow();
        } catch (error) {
          console.error('Sign-out failed:', error);
        }
      });
      desktopGoogleSignOutBtn._authWired = true;
    }
  })
  .catch((error) => {
    console.error('Failed to initialise reminders', error);
  });

initSupabaseAuth({
  selectors: {
    signInButtons: ['#googleSignInBtn'],
    signOutButtons: ['#googleSignOutBtn'],
    userBadge: '#user-badge',
    userBadgeEmail: '#user-badge-email',
    userBadgeInitial: '#user-badge-initial',
    userName: '#googleUserName',
    syncStatus: ['#sync-status'],
    feedback: '#auth-feedback',
  },
  disableButtonBinding: true,
});

const cuesList = document.getElementById('cues-list');
const pinnedNotesCard = document.getElementById('pinnedNotesCard');
const pinnedNotesList = document.getElementById('pinnedNotesList');
const cueForm = document.getElementById('cue-form');
const cueIdInput = cueForm?.querySelector('#cue-id-input');
const defaultCueModalTitle =
  modalController?.defaultTitle ||
  modalController?.modalTitle?.textContent?.trim() ||
  DEFAULT_CUE_MODAL_TITLE;
const editCueModalTitle = modalController?.editTitle || EDIT_CUE_MODAL_TITLE;

const cuesTab = document.getElementById('tab-cues');
const dailyTab = document.getElementById('tab-daily');
const cuesView = document.getElementById('cues-view');
const dailyListView = document.getElementById('daily-list-view');
const dailyListHeader = document.getElementById('daily-list-header');
const quickAddForm = document.getElementById('quick-add-form');
const quickAddInput = document.getElementById('quick-add-input');
const quickAddVoiceButton = document.getElementById('daily-voice-btn');
const dailyTasksContainer = document.getElementById('daily-tasks-container');
const clearCompletedButton = document.getElementById('clear-completed-btn');
const dailyListPermissionNotice = document.getElementById('daily-list-permission-notice');

const remindersCountElement = document.getElementById('remindersCount');
const plannerCountElement = document.getElementById('plannerCount');
const resourcesCountElement = document.getElementById('resourcesCount');
const templatesCountElement = document.getElementById('templatesCount');
const dailySnapshotList = document.getElementById('dailySnapshotList');
const todaysFocusList = document.getElementById('todaysFocusList');
const weekAtAGlanceList = document.getElementById('weekAtAGlanceList');

let weekAtAGlanceEmptyState = null;

if (weekAtAGlanceList) {
  weekAtAGlanceEmptyState = document.createElement('li');
  weekAtAGlanceEmptyState.dataset.emptyState = 'week';
  weekAtAGlanceEmptyState.className =
    'list-none rounded-xl border border-dashed border-base-300/70 bg-base-100/60 p-4 text-sm italic text-base-content/60';
  weekAtAGlanceEmptyState.textContent = 'No upcoming events this week.';
}

const updateWeekAtAGlanceEmptyState = () => {
  if (!weekAtAGlanceList || !weekAtAGlanceEmptyState) {
    return;
  }
  const visibleItems = weekAtAGlanceList.querySelectorAll(
    ':scope > li:not([data-empty-state]):not(.hidden):not([hidden])'
  );
  if (visibleItems.length === 0) {
    if (!weekAtAGlanceList.contains(weekAtAGlanceEmptyState)) {
      weekAtAGlanceList.appendChild(weekAtAGlanceEmptyState);
    }
  } else if (weekAtAGlanceList.contains(weekAtAGlanceEmptyState)) {
    weekAtAGlanceList.removeChild(weekAtAGlanceEmptyState);
  }
};

if (weekAtAGlanceList) {
  updateWeekAtAGlanceEmptyState();
  new MutationObserver(updateWeekAtAGlanceEmptyState).observe(weekAtAGlanceList, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden']
  });
}

const setPinnedNotesCardVisibility = (shouldShow) => {
  if (!pinnedNotesCard) {
    return;
  }
  if (shouldShow) {
    pinnedNotesCard.classList.remove('hidden');
  } else {
    pinnedNotesCard.classList.add('hidden');
  }
};

const REMINDER_PRIORITY_CONFIG = {
  high: { badgeClass: 'badge badge-outline text-error', badgeLabel: 'High priority', rank: 0 },
  medium: { badgeClass: 'badge badge-outline text-warning', badgeLabel: 'Due soon', rank: 1 },
  low: { badgeClass: 'badge badge-outline text-secondary', badgeLabel: 'Scheduled', rank: 2 }
};

const reminderTimeFormatter = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
})();

const reminderDateFormatter = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
})();

const getReminderTitle = (reminder) => {
  if (!reminder) {
    return '';
  }
  const title = typeof reminder.title === 'string' ? reminder.title.trim() : '';
  return title || 'Untitled reminder';
};

const getReminderDueDate = (reminder) => {
  if (!reminder?.due) {
    return null;
  }
  try {
    const date = new Date(reminder.due);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

const isSameDay = (date, reference) => {
  if (!date || !reference) {
    return false;
  }
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
};

const formatReminderTime = (date) => {
  if (!date) {
    return '';
  }
  if (reminderTimeFormatter) {
    try {
      return reminderTimeFormatter.format(date);
    } catch {
      // fall through to manual formatting
    }
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const formatReminderDate = (date) => {
  if (!date) {
    return '';
  }
  if (reminderDateFormatter) {
    try {
      return reminderDateFormatter.format(date);
    } catch {
      // ignore formatter failures and use fallback below
    }
  }
  return date.toLocaleDateString();
};

const getPriorityKey = (reminder) => {
  const value = typeof reminder?.priority === 'string' ? reminder.priority.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(REMINDER_PRIORITY_CONFIG, value) ? value : 'medium';
};

const getPriorityRank = (reminder) => {
  const key = getPriorityKey(reminder);
  return REMINDER_PRIORITY_CONFIG[key]?.rank ?? REMINDER_PRIORITY_CONFIG.medium.rank;
};

const getPriorityDisplay = (reminder) => {
  const key = getPriorityKey(reminder);
  return REMINDER_PRIORITY_CONFIG[key] ?? REMINDER_PRIORITY_CONFIG.medium;
};

const getDueTimestamp = (reminder) => {
  const date = getReminderDueDate(reminder);
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
};

function updateDailySnapshot(items = []) {
  if (!dailySnapshotList) {
    return;
  }

  const now = new Date();
  const todaysReminders = (Array.isArray(items) ? items : [])
    .map((reminder) => ({ reminder, date: getReminderDueDate(reminder) }))
    .filter(({ date }) => date && isSameDay(date, now))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (!todaysReminders.length) {
    dailySnapshotList.innerHTML = '<p class="text-sm italic text-base-content/60">No reminders due today.</p>';
    return;
  }

  dailySnapshotList.innerHTML = '';

  todaysReminders.forEach(({ reminder, date }) => {
    const listItem = document.createElement('li');
    listItem.className = 'rounded-xl border border-base-200 bg-base-100/80 p-3 shadow-sm';

    const titleEl = document.createElement('p');
    titleEl.className = 'font-semibold text-base-content';
    titleEl.textContent = getReminderTitle(reminder);
    listItem.appendChild(titleEl);

    const timeLabel = formatReminderTime(date);
    const metaEl = document.createElement('p');
    metaEl.className = 'text-xs text-base-content/70';
    metaEl.textContent = timeLabel ? `Due ${timeLabel}` : 'Due today';
    listItem.appendChild(metaEl);

    dailySnapshotList.appendChild(listItem);
  });
}

function updateTodaysFocus(items = []) {
  if (!todaysFocusList) {
    return;
  }

  const focusCandidates = (Array.isArray(items) ? items : [])
    .filter((item) => item && !item.done)
    .sort((a, b) => {
      const priorityDiff = getPriorityRank(a) - getPriorityRank(b);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const dueDiff = getDueTimestamp(a) - getDueTimestamp(b);
      if (dueDiff !== 0) {
        return dueDiff;
      }

      return getReminderTitle(a).localeCompare(getReminderTitle(b), undefined, { sensitivity: 'base' });
    })
    .slice(0, 3);

  if (!focusCandidates.length) {
    todaysFocusList.innerHTML =
      '<li class="list-none text-sm italic text-base-content/60">No focus items.</li>';
    return;
  }

  todaysFocusList.innerHTML = '';

  focusCandidates.forEach((reminder) => {
    const listItem = document.createElement('li');
    listItem.className = 'rounded-xl border border-base-200 bg-base-100/80 p-4 shadow-sm';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-3';

    const titleEl = document.createElement('p');
    titleEl.className = 'font-semibold text-base-content';
    titleEl.textContent = getReminderTitle(reminder);
    header.appendChild(titleEl);

    const priorityDisplay = getPriorityDisplay(reminder);
    const badge = document.createElement('span');
    badge.className = priorityDisplay.badgeClass;
    badge.textContent = priorityDisplay.badgeLabel;
    header.appendChild(badge);

    listItem.appendChild(header);

    const dueDate = getReminderDueDate(reminder);
    const metaEl = document.createElement('p');
    metaEl.className = 'text-xs text-base-content/70';
    if (dueDate) {
      const timeLabel = formatReminderTime(dueDate);
      const dateLabel = formatReminderDate(dueDate);
      const parts = [];
      if (timeLabel) {
        parts.push(`Due ${timeLabel}`);
      }
      if (dateLabel) {
        parts.push(dateLabel);
      }
      metaEl.textContent = parts.length ? parts.join(' • ') : 'Due soon';
    } else {
      metaEl.textContent = 'No due date';
    }
    listItem.appendChild(metaEl);

    todaysFocusList.appendChild(listItem);
  });
}

const updateRemindersCountDisplay = (items) => {
  if (!remindersCountElement) {
    return;
  }
  const count = Array.isArray(items) ? items.length : 0;
  remindersCountElement.textContent = String(count);
};

const handleRemindersUpdated = (event) => {
  const items = Array.isArray(event?.detail?.items) ? event.detail.items : [];
  updateRemindersCountDisplay(items);
  updateDailySnapshot(items);
  updateTodaysFocus(items);
};

document.addEventListener('memoryCue:remindersUpdated', handleRemindersUpdated);

updateDailySnapshot();
updateTodaysFocus();

const cueFieldElements = getFieldElements(CUE_FIELD_DEFINITIONS);

const firebaseCueConfig = {
  apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
  authDomain: 'memory-cue-app.firebaseapp.com',
  projectId: 'memory-cue-app',
  storageBucket: 'memory-cue-app.firebasestorage.app',
  messagingSenderId: '751284466633',
  appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
  measurementId: 'G-R0V4M7VCE6'
};

let firestoreCueContextPromise = null;

const PINNED_NOTES_DISPLAY_LIMIT = 3;
const PINNED_NOTES_EXCERPT_LIMIT = 120;

function normaliseCueExcerpt(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  if (text.length <= PINNED_NOTES_EXCERPT_LIMIT) {
    return text;
  }

  return `${text.slice(0, PINNED_NOTES_EXCERPT_LIMIT - 1)}…`;
}

function isCueMarkedPinned(cue) {
  if (!cue || typeof cue !== 'object') {
    return false;
  }

  const candidates = [cue.pinned, cue.isPinned, cue.pin];
  return candidates.some((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalised = value.trim().toLowerCase();
      return normalised === 'true' || normalised === '1' || normalised === 'yes';
    }
    return false;
  });
}

function renderPinnedNotesList(cues) {
  if (!pinnedNotesList) {
    return;
  }

  const list = Array.isArray(cues) ? cues : [];

  if (!list.length) {
    pinnedNotesList.innerHTML =
      '<li class="list-none text-sm italic text-base-content/60">No pinned notes yet.</li>';
    setPinnedNotesCardVisibility(false);
    return;
  }

  const pinnedCues = list.filter((cue) => isCueMarkedPinned(cue));

  if (!pinnedCues.length) {
    pinnedNotesList.innerHTML =
      '<li class="list-none text-sm italic text-base-content/60">No pinned notes yet.</li>';
    setPinnedNotesCardVisibility(false);
    return;
  }

  setPinnedNotesCardVisibility(true);

  const cuesToRender = pinnedCues.slice(0, PINNED_NOTES_DISPLAY_LIMIT);

  const markup = cuesToRender
    .map((cue) => {
      const title = escapeCueText(getCueFieldValueFromData(cue, 'title') || 'Untitled Cue');
      const rawDetails = getCueFieldValueFromData(cue, 'details');
      const excerpt = escapeCueText(normaliseCueExcerpt(rawDetails));
      const detailsMarkup = excerpt
        ? `<p class="mt-1 text-sm text-base-content/70">${excerpt}</p>`
        : '';

      return `
        <li class="rounded-xl border border-base-300 bg-base-100/80 p-3">
          <p class="font-medium text-base-content">${title}</p>
          ${detailsMarkup}
        </li>
      `;
    })
    .join('');

  pinnedNotesList.innerHTML = markup;
}

function renderCueListMessage(message, { tone = 'muted' } = {}) {
  if (!cuesList) {
    return;
  }
  const classes = ['text-sm'];
  classes.push(tone === 'error' ? 'text-error' : 'text-base-content/60');
  cuesList.innerHTML = `<p class="${classes.join(' ')}">${escapeCueText(message)}</p>`;
}

function renderCueList(cues) {
  if (!cuesList) {
    return;
  }
  if (!Array.isArray(cues) || cues.length === 0) {
    renderCueListMessage('No cues yet.');
    return;
  }
  const markup = cues
    .map((cue) => {
      const title = escapeCueText(getCueFieldValueFromData(cue, 'title') || 'Untitled Cue');
      const details = escapeCueText(getCueFieldValueFromData(cue, 'details'));
      return `
        <div class="card w-96 bg-base-100 shadow-xl">
          <div class="card-body">
            <h2 class="card-title">${title}</h2>
            ${details ? `<p>${details}</p>` : ''}
            <div class="card-actions justify-end">
              <div class="dropdown dropdown-left">
                <label tabindex="0" class="btn btn-ghost btn-xs m-1">...</label>
                <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                  <li><a class="edit-btn" data-id="${escapeCueText(cue.id)}">Edit</a></li>
                  <li><a class="delete-btn" data-id="${escapeCueText(cue.id)}">Delete</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
  cuesList.innerHTML = markup;
}

async function ensureCueFirestore() {
  if (firestoreCueContextPromise) {
    return firestoreCueContextPromise;
  }
  firestoreCueContextPromise = (async () => {
    const [
      { initializeApp, getApps },
      {
        getFirestore,
        enableMultiTabIndexedDbPersistence,
        enableIndexedDbPersistence,
        collection: getCollection,
        doc,
        getDoc,
        addDoc,
        updateDoc,
        getDocs,
        query,
        orderBy,
        serverTimestamp,
        setDoc,
        arrayUnion
      }
    ]
      = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js')
      ]);
    const apps = getApps();
    const app = apps && apps.length ? apps[0] : initializeApp(firebaseCueConfig);
    const db = getFirestore(app);
    // Firestore offline persistence: prefer multi-tab, fallback to single-tab
    // Runs once per app load, before any reads/writes/listeners.
    (function initFirestorePersistence() {
      const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
      if (!scope) {
        return;
      }
      // Guard against accidental double-initialization
      if (scope.__persistenceInitialized__) return;
      scope.__persistenceInitialized__ = true;

      (async () => {
        try {
          await enableMultiTabIndexedDbPersistence(db);
          console.info('[Firestore] Persistence: multi-tab enabled');
        } catch (err) {
          if (err && err.code === 'failed-precondition') {
            // Multi-tab not available (e.g., private mode or another constraint) -> try single-tab
            try {
              await enableIndexedDbPersistence(db);
              console.info('[Firestore] Persistence: single-tab fallback enabled');
            } catch (e2) {
              console.warn('[Firestore] Persistence disabled (single-tab fallback failed):', e2?.code || e2);
            }
          } else if (err && err.code === 'unimplemented') {
            // IndexedDB not supported in this browser/environment
            console.warn('[Firestore] Persistence not supported in this browser (online-only).');
          } else {
            console.warn('[Firestore] Persistence initialization error:', err?.code || err);
          }
        }
      })();
    })();
    const cuesCollection = getCollection(db, 'cues');
    return {
      db,
      cuesCollection,
      getCollection,
      doc,
      getDoc,
      addDoc,
      updateDoc,
      getDocs,
      query,
      orderBy,
      serverTimestamp,
      setDoc,
      arrayUnion
    };
  })().catch((error) => {
    console.error('Failed to initialise Firestore for cues', error);
    throw error;
  });
  return firestoreCueContextPromise;
}

async function fetchCues() {
  const firestore = await ensureCueFirestore();
  const { getDocs, cuesCollection, query, orderBy } = firestore;
  const baseQuery = query && orderBy ? query(cuesCollection, orderBy('createdAt', 'desc')) : cuesCollection;
  const snapshot = await getDocs(baseQuery);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function fetchCueById(id) {
  if (!id) {
    return null;
  }
  const firestore = await ensureCueFirestore();
  const { db, doc, getDoc } = firestore;
  const ref = doc(db, 'cues', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }
  return { id: snapshot.id, ...snapshot.data() };
}

async function refreshCueList() {
  if (!cuesList && !pinnedNotesList) {
    return;
  }
  try {
    const cues = await fetchCues();
    renderCueList(cues);
    renderPinnedNotesList(cues);
  } catch (error) {
    console.error('Failed to load cues', error);
    if (isPermissionDeniedError(error)) {
      renderCueListMessage('Sign in to view your cues.', { tone: 'muted' });
    } else {
      renderCueListMessage('Unable to load cues right now.', { tone: 'error' });
    }
    renderPinnedNotesList([]);
  }
}

function enterCueEditMode(cue) {
  if (!cueForm || !cueIdInput) {
    return;
  }
  populateCueFormFields(cue, cueFieldElements);
  cueIdInput.value = cue?.id || '';
  modalController?.setEditMode(true);
  modalController?.show({ mode: 'edit' });
}

async function handleCueEditClick(event) {
  const target = event.target instanceof Element ? event.target.closest('.edit-btn') : null;
  if (!target) {
    return;
  }
  event.preventDefault();
  const cueId = target.getAttribute('data-id');
  if (!cueId) {
    return;
  }
  try {
    const cue = await fetchCueById(cueId);
    if (!cue) {
      return;
    }
    enterCueEditMode(cue);
  } catch (error) {
    console.error('Failed to prepare cue for editing', error);
  }
}

async function handleCueFormSubmit(event) {
  event.preventDefault();
  if (!cueForm || !cueIdInput) {
    return;
  }
  const cueId = cueIdInput.value.trim();
  const data = gatherCueFormData(cueFieldElements);
  try {
    const firestore = await ensureCueFirestore();
    const { db, doc, addDoc, updateDoc, cuesCollection, serverTimestamp } = firestore;
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : null;
    if (cueId) {
      const ref = doc(db, 'cues', cueId);
      const payload = { ...data };
      if (timestamp) {
        payload.updatedAt = timestamp;
      }
      await updateDoc(ref, payload);
    } else {
      const payload = { ...data };
      if (timestamp) {
        payload.createdAt = timestamp;
        payload.updatedAt = timestamp;
      }
      await addDoc(cuesCollection, payload);
    }
    await refreshCueList();
    clearCueFormFields(
      cueFieldElements,
      cueIdInput,
      modalController?.modalTitle ?? null,
      defaultCueModalTitle
    );
    await modalController?.hide({ reason: 'form-submit' });
  } catch (error) {
    console.error('Failed to save cue', error);
  }
}

async function initialiseCueEditing() {
  if (!cueForm || !cueIdInput || !cuesList) {
    return;
  }
  cuesList.addEventListener('click', handleCueEditClick);
  cueForm.addEventListener('submit', handleCueFormSubmit);
}

if (cueForm && cueIdInput) {
  document.addEventListener('cue:prepare', () => {
    cueIdInput.value = '';
    modalController?.setEditMode(false);
  });
  document.addEventListener('cue:close', () => {
    cueIdInput.value = '';
    modalController?.setEditMode(false);
  });
}

if (cueForm && cueIdInput && cuesList) {
  initialiseCueEditing().catch((error) => {
    console.error('Failed to initialise cue editing', error);
  });
}

if (cuesList || pinnedNotesList) {
  refreshCueList();
}

let currentDailyTasks = [];
let dailyListLoadPromise = null;
let shouldUseLocalDailyList = false;

const updatePlannerCountDisplay = (tasks) => {
  if (!plannerCountElement) {
    return;
  }
  const taskList = Array.isArray(tasks) ? tasks : [];
  plannerCountElement.textContent = String(taskList.length);
};

const trackPlannerCountFromPromise = (maybePromise) => {
  if (!maybePromise || typeof maybePromise.then !== 'function') {
    updatePlannerCountDisplay(currentDailyTasks);
    return;
  }
  maybePromise
    .then((tasks) => {
      if (Array.isArray(tasks)) {
        updatePlannerCountDisplay(tasks);
        return;
      }
      updatePlannerCountDisplay(currentDailyTasks);
    })
    .catch(() => {
      updatePlannerCountDisplay(currentDailyTasks);
    });
};

const DAILY_TASKS_STORAGE_KEY = 'dailyTasksByDate';
let firestoreDailyListContextPromise = null;

function getTodayDateId() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateForHeader(dateId) {
  if (typeof dateId !== 'string') {
    return '';
  }
  const [yearRaw, monthRaw, dayRaw] = dateId.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateId;
  }
  const displayDate = new Date(year, month - 1, day);
  if (Number.isNaN(displayDate.getTime())) {
    return dateId;
  }
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return formatter.format(displayDate);
}

function updateClearCompletedButtonState(tasks) {
  if (!clearCompletedButton) {
    return;
  }
  const hasCompletedTasks = Array.isArray(tasks) && tasks.some((task) => Boolean(task?.completed));
  clearCompletedButton.disabled = !hasCompletedTasks;
}

function renderDailyTasks(tasks) {
  if (!dailyTasksContainer) {
    return;
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">No tasks for today yet.</p>';
    updateClearCompletedButtonState([]);
    return;
  }
  const markup = tasks
    .map((task, index) => {
      const safeText = escapeCueText(task?.text || '');
      const completed = Boolean(task?.completed);
      const textClasses = ['ml-3', 'flex-1', 'text-sm', 'sm:text-base', 'text-base-content'];
      if (completed) {
        textClasses.push('line-through', 'text-opacity-50');
      }
      return `
        <div class="flex items-center p-3 border-b border-base-200" data-task-index="${index}">
          <input type="checkbox" class="checkbox checkbox-sm" data-task-index="${index}" data-task-text="${safeText}" ${completed ? 'checked' : ''} />
          <span class="${textClasses.join(' ')}">${safeText}</span>
        </div>
      `;
    })
    .join('');
  dailyTasksContainer.innerHTML = markup;
  updateClearCompletedButtonState(tasks);
}

function showDailyListPermissionNotice() {
  if (dailyListPermissionNotice) {
    dailyListPermissionNotice.classList.remove('hidden');
  }
}

function hideDailyListPermissionNotice() {
  if (dailyListPermissionNotice) {
    dailyListPermissionNotice.classList.add('hidden');
  }
}

function normaliseDailyTask(task) {
  return {
    text: typeof task?.text === 'string' ? task.text : '',
    completed: Boolean(task?.completed)
  };
}

function normaliseDailyTaskArray(tasks) {
  return Array.isArray(tasks) ? tasks.map((task) => normaliseDailyTask(task)) : [];
}

function readDailyTaskStorage() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(DAILY_TASKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to read daily tasks from storage', error);
    return {};
  }
}

function writeDailyTaskStorage(map) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const payload = map && typeof map === 'object' ? map : {};
    localStorage.setItem(DAILY_TASKS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist daily tasks locally', error);
  }
}

function getLocalDailyTasks(dateId) {
  const map = readDailyTaskStorage();
  const tasks = map && typeof map === 'object' ? map[dateId] : [];
  return normaliseDailyTaskArray(tasks);
}

function setLocalDailyTasks(dateId, tasks) {
  const map = readDailyTaskStorage();
  const payload = normaliseDailyTaskArray(tasks);
  map[dateId] = payload;
  writeDailyTaskStorage(map);
  return payload;
}

function appendLocalDailyTask(dateId, task) {
  const map = readDailyTaskStorage();
  const existing = normaliseDailyTaskArray(map[dateId]);
  existing.push(normaliseDailyTask(task));
  map[dateId] = existing;
  writeDailyTaskStorage(map);
  return existing;
}

function isPermissionDeniedError(error) {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  if (code) {
    return code.includes('permission-denied') || code.includes('insufficient-permission');
  }
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return Boolean(message && message.includes('permission'));
}

async function ensureDailyListFirestore() {
  if (firestoreDailyListContextPromise) {
    return firestoreDailyListContextPromise;
  }
  firestoreDailyListContextPromise = ensureCueFirestore()
    .then((base) => {
      const { db, getCollection } = base;
      const dailyListsCollection = typeof getCollection === 'function' && db ? getCollection(db, 'dailyLists') : null;
      return { ...base, dailyListsCollection };
    })
    .catch((error) => {
      console.error('Failed to initialise Firestore for daily lists', error);
      throw error;
    });
  return firestoreDailyListContextPromise;
}

function getDailyListDocRef(firestore, dateId) {
  const { doc, dailyListsCollection, db } = firestore || {};
  if (typeof doc !== 'function') {
    throw new Error('Firestore document helper is unavailable');
  }
  if (dailyListsCollection) {
    return doc(dailyListsCollection, dateId);
  }
  return doc(db, 'dailyLists', dateId);
}

async function loadDailyList() {
  if (!dailyListHeader || !dailyTasksContainer) {
    return;
  }
  const todayId = getTodayDateId();
  const formatted = formatDateForHeader(todayId);
  dailyListHeader.textContent = formatted ? `Today's List - ${formatted}` : "Today's List";
  if (shouldUseLocalDailyList) {
    showDailyListPermissionNotice();
    const localTasks = getLocalDailyTasks(todayId);
    currentDailyTasks = localTasks;
    renderDailyTasks(localTasks);
    updatePlannerCountDisplay(localTasks);
    return Promise.resolve(localTasks);
  }
  if (!dailyListLoadPromise) {
    dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">Loading tasks…</p>';
    updateClearCompletedButtonState([]);
    dailyListLoadPromise = (async () => {
      try {
        const firestore = await ensureDailyListFirestore();
        const ref = getDailyListDocRef(firestore, todayId);
        const snapshot = await firestore.getDoc(ref);
        const rawTasks = snapshot.exists() ? snapshot.data()?.tasks : [];
        currentDailyTasks = normaliseDailyTaskArray(rawTasks);
        renderDailyTasks(currentDailyTasks);
        setLocalDailyTasks(todayId, currentDailyTasks);
        shouldUseLocalDailyList = false;
        hideDailyListPermissionNotice();
        updatePlannerCountDisplay(currentDailyTasks);
        return currentDailyTasks;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          console.warn('Falling back to local daily tasks due to permission issue', error);
          shouldUseLocalDailyList = true;
          showDailyListPermissionNotice();
          const localTasks = getLocalDailyTasks(todayId);
          currentDailyTasks = localTasks;
          renderDailyTasks(localTasks);
          updatePlannerCountDisplay(localTasks);
          return localTasks;
        }
        console.error('Failed to load daily list', error);
        dailyTasksContainer.innerHTML = '<p class="text-sm text-error">Unable to load daily tasks right now.</p>';
        currentDailyTasks = [];
        updateClearCompletedButtonState(currentDailyTasks);
        updatePlannerCountDisplay(currentDailyTasks);
        return currentDailyTasks;
      }
    })().finally(() => {
      dailyListLoadPromise = null;
    });
  }
  return dailyListLoadPromise;
}

async function addTaskToDailyList(task) {
  const todayId = getTodayDateId();
  const normalisedTask = normaliseDailyTask(task);
  if (shouldUseLocalDailyList) {
    appendLocalDailyTask(todayId, normalisedTask);
    return;
  }
  try {
    const firestore = await ensureDailyListFirestore();
    const ref = getDailyListDocRef(firestore, todayId);
    const snapshot = await firestore.getDoc(ref);
    if (snapshot.exists() && typeof firestore.arrayUnion === 'function') {
      await firestore.updateDoc(ref, { tasks: firestore.arrayUnion(normalisedTask) });
    } else {
      const existing = snapshot.exists() ? snapshot.data()?.tasks : [];
      const nextTasks = Array.isArray(existing) ? normaliseDailyTaskArray(existing) : [];
      nextTasks.push(normalisedTask);
      if (typeof firestore.setDoc === 'function') {
        await firestore.setDoc(ref, { tasks: nextTasks }, { merge: true });
      } else {
        await firestore.updateDoc(ref, { tasks: nextTasks });
      }
    }
    appendLocalDailyTask(todayId, normalisedTask);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Saving task locally because cloud sync is unavailable', error);
      shouldUseLocalDailyList = true;
      showDailyListPermissionNotice();
      appendLocalDailyTask(todayId, normalisedTask);
      return;
    }
    throw error;
  }
}

async function saveDailyTasks(tasks) {
  const todayId = getTodayDateId();
  const payload = normaliseDailyTaskArray(tasks);
  if (shouldUseLocalDailyList) {
    setLocalDailyTasks(todayId, payload);
    return;
  }
  try {
    const firestore = await ensureDailyListFirestore();
    const ref = getDailyListDocRef(firestore, todayId);
    if (typeof firestore.setDoc === 'function') {
      await firestore.setDoc(ref, { tasks: payload }, { merge: true });
    } else {
      await firestore.updateDoc(ref, { tasks: payload });
    }
    setLocalDailyTasks(todayId, payload);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Persisting daily tasks locally because cloud sync is unavailable', error);
      shouldUseLocalDailyList = true;
      showDailyListPermissionNotice();
      setLocalDailyTasks(todayId, payload);
      return;
    }
    throw error;
  }
}

function activateTab(tabToActivate) {
  [cuesTab, dailyTab].forEach((tab) => {
    if (!tab) {
      return;
    }
    const isActive = tab === tabToActivate;
    tab.classList.toggle('tab-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function showCuesTab() {
  if (!cuesView || !dailyListView) {
    return;
  }
  cuesView.classList.remove('hidden');
  dailyListView.classList.add('hidden');
  activateTab(cuesTab);
}

function showDailyTab() {
  if (!cuesView || !dailyListView) {
    return;
  }
  cuesView.classList.add('hidden');
  dailyListView.classList.remove('hidden');
  activateTab(dailyTab);
  trackPlannerCountFromPromise(loadDailyList());
}

if (cuesTab && dailyTab && cuesView && dailyListView) {
  cuesTab.addEventListener('click', (event) => {
    event.preventDefault();
    showCuesTab();
  });
  dailyTab.addEventListener('click', (event) => {
    event.preventDefault();
    showDailyTab();
  });
}

let quickAddVoiceRecognition = null;
let quickAddVoiceListening = false;
let quickAddVoiceRestartTimer = null;

function setQuickAddVoiceButtonActive(isActive) {
  if (!quickAddVoiceButton) {
    return;
  }
  quickAddVoiceButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  const iconSpan = quickAddVoiceButton.querySelector('[aria-hidden="true"]');
  if (iconSpan) {
    iconSpan.textContent = isActive ? '👂' : '🎙️';
  } else {
    quickAddVoiceButton.textContent = isActive ? '👂' : '🎙️';
  }
}

function scheduleQuickAddVoiceRestart() {
  if (!quickAddVoiceListening) {
    return;
  }
  window.clearTimeout(quickAddVoiceRestartTimer);
  quickAddVoiceRestartTimer = window.setTimeout(() => {
    quickAddVoiceRestartTimer = null;
    if (quickAddVoiceListening) {
      startQuickAddVoiceRecognition(true);
    }
  }, 400);
}

function startQuickAddVoiceRecognition(forceRestart = false) {
  if (!quickAddVoiceRecognition) {
    return false;
  }
  if (quickAddVoiceListening && !forceRestart) {
    return true;
  }
  try {
    quickAddVoiceRecognition.start();
    quickAddVoiceListening = true;
    setQuickAddVoiceButtonActive(true);
    return true;
  } catch {
    quickAddVoiceListening = false;
    setQuickAddVoiceButtonActive(false);
    return false;
  }
}

function stopQuickAddVoiceRecognition() {
  if (!quickAddVoiceRecognition) {
    return;
  }
  quickAddVoiceListening = false;
  window.clearTimeout(quickAddVoiceRestartTimer);
  try {
    quickAddVoiceRecognition.stop();
  } catch {
    // ignore stop errors so the UI can recover
  }
  setQuickAddVoiceButtonActive(false);
}

function initialiseQuickAddVoiceRecognition() {
  if (!quickAddVoiceButton) {
    return;
  }
  try {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      quickAddVoiceButton.setAttribute('disabled', 'true');
      quickAddVoiceButton.setAttribute('aria-disabled', 'true');
      quickAddVoiceButton.title = 'Voice input is not supported in this browser.';
      return;
    }
    quickAddVoiceRecognition = new SpeechRecognitionCtor();
    const lang = document.documentElement?.lang || navigator?.language || 'en-AU';
    quickAddVoiceRecognition.lang = lang;
    quickAddVoiceRecognition.interimResults = false;
    if ('continuous' in quickAddVoiceRecognition) {
      try {
        quickAddVoiceRecognition.continuous = true;
      } catch {
        // ignore unsupported assignments
      }
    }
    quickAddVoiceRecognition.onresult = (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      if (!transcript) {
        return;
      }
      if (quickAddInput) {
        quickAddInput.value = transcript.trim();
        try {
          quickAddInput.focus({ preventScroll: true });
        } catch {
          quickAddInput.focus();
        }
        try {
          const length = quickAddInput.value.length;
          quickAddInput.setSelectionRange(length, length);
        } catch {
          // ignore selection errors in unsupported browsers
        }
      }
    };
    quickAddVoiceRecognition.onend = () => {
      if (!quickAddVoiceListening) {
        setQuickAddVoiceButtonActive(false);
        return;
      }
      scheduleQuickAddVoiceRestart();
    };
    quickAddVoiceRecognition.onerror = () => {
      quickAddVoiceListening = false;
      setQuickAddVoiceButtonActive(false);
    };
  } catch {
    quickAddVoiceRecognition = null;
    setQuickAddVoiceButtonActive(false);
    quickAddVoiceButton.setAttribute('disabled', 'true');
    quickAddVoiceButton.setAttribute('aria-disabled', 'true');
  }
}

initialiseQuickAddVoiceRecognition();

quickAddVoiceButton?.addEventListener('click', () => {
  if (!quickAddVoiceRecognition) {
    return;
  }
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  } else {
    startQuickAddVoiceRecognition();
  }
});

quickAddForm?.addEventListener('submit', () => {
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  }
});

window.addEventListener('pagehide', () => {
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  }
});

quickAddForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!quickAddInput) {
    return;
  }
  const value = quickAddInput.value.trim();
  if (!value) {
    quickAddInput.focus();
    return;
  }
  const task = { text: value, completed: false };
  quickAddInput.value = '';
  quickAddInput.focus();
  try {
    await addTaskToDailyList(task);
    const tasksForToday = await loadDailyList();
    updatePlannerCountDisplay(tasksForToday ?? currentDailyTasks);
  } catch (error) {
    console.error('Failed to add task to the daily list', error);
    quickAddInput.value = value;
    quickAddInput.focus();
  }
});

dailyTasksContainer?.addEventListener('change', async (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target || target.type !== 'checkbox') {
    return;
  }
  const index = Number.parseInt(target.getAttribute('data-task-index') || '', 10);
  if (!Array.isArray(currentDailyTasks) || Number.isNaN(index) || !currentDailyTasks[index]) {
    return;
  }
  const previousState = currentDailyTasks.map((task) => ({ ...task }));
  const updatedTasks = previousState.map((task, taskIndex) =>
    taskIndex === index ? { ...task, completed: target.checked } : task
  );
  currentDailyTasks = updatedTasks;
  renderDailyTasks(updatedTasks);
  updatePlannerCountDisplay(updatedTasks);
  try {
    await saveDailyTasks(updatedTasks);
  } catch (error) {
    console.error('Failed to update task completion state', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
    updatePlannerCountDisplay(previousState);
  }
});

clearCompletedButton?.addEventListener('click', async () => {
  if (!Array.isArray(currentDailyTasks) || currentDailyTasks.length === 0) {
    return;
  }
  const remainingTasks = currentDailyTasks.filter((task) => !task.completed);
  if (remainingTasks.length === currentDailyTasks.length) {
    return;
  }
  const previousState = currentDailyTasks.map((task) => ({ ...task }));
  currentDailyTasks = remainingTasks;
  renderDailyTasks(remainingTasks);
  updatePlannerCountDisplay(remainingTasks);
  try {
    await saveDailyTasks(remainingTasks);
  } catch (error) {
    console.error('Failed to clear completed tasks', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
    updatePlannerCountDisplay(previousState);
  }
});

updateClearCompletedButtonState(currentDailyTasks);
updatePlannerCountDisplay(currentDailyTasks);
trackPlannerCountFromPromise(loadDailyList());

const THEME_STORAGE_KEY = 'theme';
const THEME_CHANGE_EVENT = 'memoryCue:theme-change';
const themeMenu = document.getElementById('theme-menu');
const themeOptionSelector = '[data-theme-name],[data-theme-option]';

const darkThemes = new Set(['dark', 'dracula', 'synthwave']);

function normaliseThemeName(themeName) {
  return typeof themeName === 'string' ? themeName.trim() : '';
}

function getThemeOptionName(node) {
  if (!(node instanceof HTMLElement)) {
    return '';
  }
  return normaliseThemeName(node.getAttribute('data-theme-name') || node.getAttribute('data-theme-option') || '');
}

function applyTheme(themeName) {
  const resolvedTheme = normaliseThemeName(themeName);
  if (!resolvedTheme) {
    return;
  }
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  document.documentElement.classList.toggle('dark', darkThemes.has(resolvedTheme));
}

function saveTheme(themeName) {
  const resolvedTheme = normaliseThemeName(themeName);
  if (!resolvedTheme) {
    return;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
  } catch (error) {
    console.warn('Unable to save theme preference', error);
  }
}

function updateThemeMenuSelection(themeName) {
  if (!themeMenu) {
    return;
  }
  const resolvedTheme = normaliseThemeName(themeName);
  const options = themeMenu.querySelectorAll(themeOptionSelector);
  options.forEach((option) => {
    if (!(option instanceof HTMLElement)) {
      return;
    }
    const optionName = getThemeOptionName(option);
    const isActive = resolvedTheme && optionName === resolvedTheme;
    option.setAttribute('aria-checked', isActive ? 'true' : 'false');
    option.classList.toggle('active', isActive);
  });
}

function dispatchThemeChange(themeName) {
  const resolvedTheme = normaliseThemeName(themeName);
  if (typeof window === 'undefined' || !resolvedTheme) {
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: resolvedTheme } }));
  } catch (error) {
    if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
      const fallbackEvent = document.createEvent('CustomEvent');
      fallbackEvent.initCustomEvent(THEME_CHANGE_EVENT, true, true, { theme: resolvedTheme });
      window.dispatchEvent(fallbackEvent);
    }
  }
}

function setTheme(themeName, { persist = true, notify = true } = {}) {
  const resolvedTheme = normaliseThemeName(themeName);
  if (!resolvedTheme) {
    return;
  }
  const currentTheme = normaliseThemeName(document.documentElement.getAttribute('data-theme'));
  if (currentTheme !== resolvedTheme) {
    applyTheme(resolvedTheme);
    if (persist) {
      saveTheme(resolvedTheme);
    }
  } else if (persist) {
    saveTheme(resolvedTheme);
  }
  updateThemeMenuSelection(resolvedTheme);
  if (notify) {
    dispatchThemeChange(resolvedTheme);
  }
}

function loadSavedTheme() {
  let storedTheme = '';
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Unable to load theme preference', error);
  }

  const fallbackTheme = storedTheme || document.documentElement.getAttribute('data-theme') || '';
  if (!fallbackTheme) {
    return;
  }
  setTheme(fallbackTheme, { persist: false, notify: true });
}

themeMenu?.addEventListener('click', (event) => {
  const targetElement = event.target instanceof HTMLElement
    ? event.target.closest(themeOptionSelector)
    : null;
  if (!targetElement) {
    return;
  }
  event.preventDefault();
  const themeName = getThemeOptionName(targetElement);
  if (!themeName) {
    return;
  }
  setTheme(themeName, { persist: true, notify: true });
});

if (typeof window !== 'undefined') {
  window.addEventListener(THEME_CHANGE_EVENT, (event) => {
    const themeName = normaliseThemeName(event?.detail?.theme);
    if (!themeName) {
      return;
    }
    updateThemeMenuSelection(themeName);
  });
}

loadSavedTheme();
