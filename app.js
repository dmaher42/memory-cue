import { initViewportHeight } from './js/modules/viewport-height.js';
import { initReminders } from './js/reminders.js';
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
import { loadAllNotes, saveAllNotes, createNote } from './js/modules/notes-storage.js';
import { initNotesSync } from './js/modules/notes-sync.js';
import {
  initPlannerStore,
  getWeekIdFromDate as getPlannerWeekIdFromDate,
  getWeekIdFromOffset,
  getWeekLabel,
  loadWeekPlan,
  addLessonToWeek,
  updateLessonInWeek,
  deleteLessonFromWeek,
  movePlannerLesson,
  addLessonDetail,
  duplicateWeekPlan,
  clearWeekPlan,
  PLANNER_UPDATED_EVENT,
  getPlannerLessonsForWeek,
  getWeekDateForDayIndex,
  updatePlannerTeacherNotes
} from './js/modules/planner.js';

// Planner structure:
// - app.js: planner UI rendering, lesson cards, templates, resources, week view toggle, and teacher notes panel.
// - js/modules/planner.js: planner data store, lesson normalisation, and persistence helpers.
// - index.html / docs/index.html: planner layout, modal markup, and toolbar controls.
// Planner updates:
// - Added lesson status, subject tags, templates, resources, teacher notes panel, week view, and duplicate functionality.
// Teacher notes are stored per week alongside the lesson plan data.

initViewportHeight();

function initReminderModalUI() {
  if (typeof document === 'undefined') {
    return;
  }

  const modal = document.getElementById('add-reminder-modal') ?? document.getElementById('reminder-modal');
  const form = document.getElementById('add-reminder-form') ?? document.getElementById('reminder-form');
  const titleField = document.getElementById('reminder-title');

  if (!form || !titleField) {
    return;
  }

  const openButtons = document.querySelectorAll('[data-open-reminder-modal]');

  if (!openButtons.length) {
    return;
  }

  if (!modal) {
    const focusForm = () => {
      if (!(titleField instanceof HTMLElement) || typeof titleField.focus !== 'function') {
        return;
      }
      try {
        titleField.focus({ preventScroll: false });
      } catch {
        titleField.focus();
      }
    };

    openButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (typeof window !== 'undefined') {
          const targetHash = '#reminders';
          if (window.location.hash !== targetHash) {
            window.location.hash = targetHash;
            if (typeof window.renderRoute === 'function') {
              window.renderRoute();
            }
          } else if (typeof window.renderRoute === 'function') {
            window.renderRoute();
          }
        }

        window.requestAnimationFrame(() => {
          focusForm();
        });
      });
    });

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

  const dispatchCueEvent = (type, detail = {}) => {
    try {
      document.dispatchEvent(new CustomEvent(type, { detail }));
    } catch {
      if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
        const legacyEvent = document.createEvent('CustomEvent');
        legacyEvent.initCustomEvent(type, true, true, detail);
        document.dispatchEvent(legacyEvent);
      }
    }
  };

  const handleCancelRequest = (detail = {}) => {
    dispatchCueEvent('cue:cancelled', detail);
  };

  openButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const triggerElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      const detail = { trigger: triggerElement, mode: 'create' };
      dispatchCueEvent('cue:prepare', detail);
      dispatchCueEvent('cue:open', detail);
    });
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      handleCancelRequest({ trigger: button, reason: 'button' });
    });
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      handleCancelRequest({ reason: 'backdrop' });
    }
  });

  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      handleCancelRequest({ reason: 'backdrop' });
    }
  });

  document.addEventListener('cue:open', (event) => {
    const trigger = event?.detail?.trigger;
    const triggerElement = trigger instanceof HTMLElement ? trigger : null;
    openModal({ triggerElement });
  });

  const handleExternalClose = () => {
    closeModal();
  };

  document.addEventListener('cue:close', handleExternalClose);
  document.addEventListener('cue:cancelled', handleExternalClose);

  const saveButton = modal.querySelector('#saveReminder');

  if (form instanceof HTMLFormElement && saveButton instanceof HTMLElement) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saveButton.matches(':disabled')) {
        return;
      }
      saveButton.click();
    });
  }

  if (saveButton instanceof HTMLElement) {
    document.addEventListener('reminder:save', (event) => {
      const trigger = event?.detail?.trigger;
      if (trigger && trigger !== saveButton) {
        return;
      }
      if (saveButton.matches(':disabled')) {
        return;
      }
      saveButton.click();
    });
  }
}

initReminderModalUI();

function safeDispatchDocumentEvent(eventName, detail = {}) {
  if (typeof document === 'undefined' || !eventName) {
    return;
  }
  try {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch {
    if (typeof document.createEvent === 'function') {
      const fallbackEvent = document.createEvent('CustomEvent');
      fallbackEvent.initCustomEvent(eventName, true, true, detail);
      document.dispatchEvent(fallbackEvent);
    }
  }
}

let routeFocusTimeoutId = null;

function getSectionForRoute(route) {
  if (!route || typeof document === 'undefined') {
    return null;
  }

  return document.querySelector(`[data-route="${route}"]`);
}

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
    const section = getSectionForRoute(route);
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
const resourcePlannerStatusElement = document.getElementById('resourcePlannerStatus');
let resourcePlannerStatusTimeoutId = null;

document.addEventListener('planner:reminderCreated', (event) => {
  if (!liveStatusRegion) {
    return;
  }
  const detail = event?.detail || {};
  const lessonTitle = typeof detail.lessonTitle === 'string' && detail.lessonTitle.trim() ? detail.lessonTitle.trim() : '';
  const dayLabel = typeof detail.dayLabel === 'string' && detail.dayLabel.trim() ? detail.dayLabel.trim() : '';
  const message = dayLabel
    ? `Reminder saved for ${dayLabel}${lessonTitle ? ` · ${lessonTitle}` : ''}.`
    : lessonTitle
      ? `Reminder saved for ${lessonTitle}.`
      : 'Planner reminder saved.';
  liveStatusRegion.textContent = message;
});

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

function handlePlannerQuickAction(event) {
  if (typeof window === 'undefined') {
    return;
  }

  event.preventDefault();

  const targetRoute = 'planner';
  const targetHash = '#planner';

  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }

  if (typeof window.renderRoute === 'function') {
    window.renderRoute();
  }

  scheduleRouteFocus(targetRoute);

  if (liveStatusRegion) {
    liveStatusRegion.textContent = 'Opening planner to add a new lesson.';
  }

  initPlannerView();

  window.requestAnimationFrame(() => {
    const result = handlePlannerNewLesson();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error('Planner quick action failed to start new lesson flow', error);
      });
    }
  });
}

function initPlannerQuickActions() {
  if (typeof document === 'undefined') {
    return;
  }

  const plannerQuickActions = document.querySelectorAll('[data-quick-action="planner"]');
  if (!plannerQuickActions.length) {
    return;
  }

  plannerQuickActions.forEach((action) => {
    action.addEventListener('click', handlePlannerQuickAction);
  });
}

initPlannerQuickActions();

function showResourcePlannerStatus(message, { tone = 'success' } = {}) {
  if (resourcePlannerStatusElement) {
    resourcePlannerStatusElement.textContent = message;
    resourcePlannerStatusElement.classList.remove('hidden');
    resourcePlannerStatusElement.classList.remove('text-success', 'text-error');
    resourcePlannerStatusElement.classList.add(tone === 'error' ? 'text-error' : 'text-success');
    if (typeof window !== 'undefined') {
      if (resourcePlannerStatusTimeoutId) {
        window.clearTimeout(resourcePlannerStatusTimeoutId);
      }
      resourcePlannerStatusTimeoutId = window.setTimeout(() => {
        resourcePlannerStatusElement.classList.add('hidden');
        resourcePlannerStatusElement.textContent = '';
      }, 4000);
    }
  }
  if (liveStatusRegion) {
    liveStatusRegion.textContent = message;
  }
}

function generateClientId(prefix = 'resource') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleResourcePlannerButtonClick(event) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  event.preventDefault();
  const trigger =
    event.currentTarget instanceof Element
      ? event.currentTarget
      : event.target instanceof Element
        ? event.target.closest('[data-resource-planner]')
        : null;
  if (!trigger) {
    return;
  }
  const resourceCard = trigger.closest('[data-resource-title][data-resource-link]');
  if (!resourceCard) {
    return;
  }
  const resourceTitle = resourceCard.getAttribute('data-resource-title')?.trim();
  const resourceLink = resourceCard.getAttribute('data-resource-link')?.trim();
  if (!resourceTitle || !resourceLink) {
    return;
  }
  const targetHash = '#planner';
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  if (typeof window.renderRoute === 'function') {
    window.renderRoute();
  }
  scheduleRouteFocus('planner');
  initPlannerView();
  await ensurePlannerPlanAvailable();
  const detailText = `${resourceTitle} — ${resourceLink}`;
  const selectedLessonId = getSelectedPlannerLessonId();
  let plan = null;
  try {
    if (selectedLessonId) {
      plan = await addLessonDetail(activePlannerWeekId, selectedLessonId, { badge: 'Resource', text: detailText });
    } else {
      const generatedLessonId = generateClientId('lesson');
      const defaultDayLabel = currentPlannerPlan?.lessons?.[0]?.dayLabel || 'Monday';
      plan = await addLessonToWeek(activePlannerWeekId, {
        id: generatedLessonId,
        dayName: defaultDayLabel,
        title: resourceTitle,
        summary: `Resource link: ${resourceLink}`,
        details: [{ badge: 'Resource', text: detailText }]
      });
      if (plan) {
        selectedPlannerLessonId = generatedLessonId;
      }
    }
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
      const successMessage = selectedLessonId
        ? `Added "${resourceTitle}" to your selected lesson.`
        : `Created a lesson for "${resourceTitle}" in this week's planner.`;
      showResourcePlannerStatus(successMessage);
      return;
    }
    showResourcePlannerStatus('Unable to save that resource to the planner right now.', { tone: 'error' });
  } catch (error) {
    console.error('Failed to save resource to planner', error);
    showResourcePlannerStatus('Unable to save that resource to the planner right now.', { tone: 'error' });
  }
}

function initResourcePlannerButtons() {
  if (typeof document === 'undefined') {
    return;
  }
  const plannerButtons = document.querySelectorAll('[data-resource-planner]');
  if (!plannerButtons.length) {
    return;
  }
  plannerButtons.forEach((button) => {
    button.addEventListener('click', handleResourcePlannerButtonClick);
  });
}

initResourcePlannerButtons();

const titleInput = document.getElementById('reminder-title');
const mobileTitleInput = document.getElementById('reminderText');

const modalController = (() => {
  const modalElement = document.getElementById('cue-modal') ?? document.getElementById('cue_modal');
  if (!(modalElement instanceof HTMLElement)) {
    return null;
  }

  const openButton = document.getElementById('openCueModal');
  const closeButton = document.getElementById('closeCueModal');
  const backdropButton = modalElement.querySelector('.modal-backdrop button');
  const modalTitle = document.getElementById('modal-title');

  return createModalController({
    modalElement,
    openButton: openButton instanceof HTMLElement ? openButton : null,
    closeButton: closeButton instanceof HTMLElement ? closeButton : null,
    backdropButton: backdropButton instanceof HTMLElement ? backdropButton : null,
    titleInput,
    modalTitle: modalTitle instanceof HTMLElement ? modalTitle : null,
    defaultTitle: DEFAULT_CUE_MODAL_TITLE,
    editTitle: EDIT_CUE_MODAL_TITLE
  });
})();

modalController?.setEditMode(false);

const initialiseReminders = () => {
  const hasDesktopForm = Boolean(titleInput);
  const hasMobileForm = Boolean(mobileTitleInput);

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

  const desktopConfig = {
    titleSel: '#reminder-title',
    dateSel: '#reminder-date',
    timeSel: null,
    detailsSel: '#reminder-notes',
    prioritySel: '#reminder-priority',
    categorySel: null,
    saveBtnSel: '#saveReminder',
    cancelEditBtnSel: null,
    listSel: '#reminders-list',
    statusSel: '#auth-feedback-header',
    syncStatusSel: '#sync-status',
    voiceBtnSel: null,
    categoryOptionsSel: null,
    countTotalSel: '#remindersCount',
    emptyStateSel: null,
    listWrapperSel: null,
    dateFeedbackSel: null,
    googleSignInBtnSel: '#googleSignInBtn',
    googleSignOutBtnSel: '#googleSignOutBtn',
    googleUserNameSel: '#googleUserName',
    variant: 'desktop',
    autoWireAuthButtons: true,
    plannerContextSel: '#planner-reminder-context',
    plannerLessonInputSel: '#planner-reminder-lesson-id',
    detailPanelSel: '#reminder-detail-panel',
    detailEmptySel: '#reminder-detail-empty',
    detailContentSel: '#reminder-detail-content',
    detailTitleSel: '#reminder-detail-title',
    detailDueSel: '#reminder-detail-due',
    detailPrioritySel: '#reminder-detail-priority',
    detailCategorySel: '#reminder-detail-category',
    detailNotesSel: '#reminder-detail-notes',
    detailClearSel: '#reminder-detail-clear'
  };

  if (!hasDesktopForm) {
    return initReminders({
      ...desktopConfig,
      // Ensure auth feedback continues to surface in the header even when
      // the desktop reminder form is not rendered on the page.
      listSel: null,
      listWrapperSel: null,
      emptyStateSel: null,
      countTotalSel: null,
      voiceBtnSel: null,
      categoryOptionsSel: null,
      dateSel: null,
      timeSel: null,
      prioritySel: null,
      categorySel: null,
      saveBtnSel: null,
      cancelEditBtnSel: null,
      detailsSel: null,
      titleSel: null,
      dateFeedbackSel: null,
    });
  }

  return initReminders(desktopConfig);
};

initialiseReminders().catch((error) => {
    console.error('Failed to initialise reminders', error);
  });

const notesSyncController = initNotesSync();

const supabaseAuthController = initSupabaseAuth({
  selectors: {
    signInButtons: ['#googleSignInBtn'],
    signOutButtons: ['#googleSignOutBtn'],
    userBadge: '#user-badge',
    userBadgeEmail: '#user-badge-email',
    userBadgeInitial: '#user-badge-initial',
    userName: '#googleUserName',
    syncStatus: ['#sync-status'],
    feedback: ['#auth-feedback-header', '#auth-feedback-rail'],
  },
  disableButtonBinding: true,
  onSessionChange: (user) => {
    notesSyncController?.handleSessionChange(user);
  },
});

if (supabaseAuthController?.supabase) {
  notesSyncController?.setSupabaseClient(supabaseAuthController.supabase);
  try {
    supabaseAuthController.supabase.auth
      .getSession()
      .then(({ data }) => {
        notesSyncController?.handleSessionChange(data?.session?.user ?? null);
      })
      .catch(() => {
        /* noop */
      });
  } catch {
    /* noop */
  }
}

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
const plannerCardsContainer = document.getElementById('plannerCards') || document.getElementById('planner-grid');
const plannerWeekRangeElement = document.getElementById('plannerWeekRange');
const plannerPrevButton = document.getElementById('planner-prev');
const plannerNextButton = document.getElementById('planner-next');
const plannerTodayButton = document.getElementById('planner-today');
const plannerCopyWeekButton = document.getElementById('planner-copy-week');
const plannerClearWeekButton = document.getElementById('planner-clear-week');
const plannerDuplicateButton = document.getElementById('planner-duplicate-btn');
const plannerNewLessonButton = document.getElementById('planner-new-lesson-btn');
const plannerListViewToggle = document.getElementById('planner-list-view-toggle');
const plannerWeekViewToggle = document.getElementById('planner-week-view-toggle');
const plannerWeekViewContainer = document.getElementById('plannerWeekView');
const plannerTextSizeSelect = document.querySelector('[data-planner-text-size]');
const plannerPanelElement = document.querySelector('[data-planner-card-panel]');
const plannerSummaryCountElement = document.getElementById('plannerSummaryCount');
const plannerSummaryRangeElement = document.getElementById('plannerSummaryRange');
const plannerInsightsLessonsElement = document.getElementById('plannerInsightsLessons');
const plannerInsightsSubjectsElement = document.getElementById('plannerInsightsSubjects');
const plannerInsightsNotesElement = document.getElementById('plannerInsightsNotes');
const plannerTeacherNotesField = document.getElementById('plannerTeacherNotes');
const plannerTeacherNotesStatus = document.getElementById('plannerTeacherNotesStatus');
const mobileNotesTextSizeSelect = document.querySelector('[data-mobile-notes-text-size]');
const mobileNotesPanelElement = document.querySelector('.mobile-panel--notes');

const PLANNER_TEXT_SIZE_STORAGE_KEY = 'plannerTextSizePreference';
const PLANNER_TEXT_SIZE_DEFAULT = 'default';
const PLANNER_TEXT_SIZE_OPTIONS = new Set(['small', 'default', 'large']);
const PLANNER_TEXT_SIZE_CLASSES = ['planner-text-small', 'planner-text-default', 'planner-text-large'];

const MOBILE_NOTES_TEXT_SIZE_STORAGE_KEY = 'mobileNotesTextSizePreference';
const MOBILE_NOTES_TEXT_SIZE_DEFAULT = 'default';
const MOBILE_NOTES_TEXT_SIZE_OPTIONS = new Set(['small', 'default', 'large']);
const MOBILE_NOTES_TEXT_SIZE_CLASSES = [
  'mobile-panel--notes-size-small',
  'mobile-panel--notes-size-default',
  'mobile-panel--notes-size-large',
];

function isPlannerTextSizeSelect(element) {
  return typeof HTMLSelectElement !== 'undefined' && element instanceof HTMLSelectElement;
}

function readPlannerTextSizePreference() {
  if (typeof localStorage === 'undefined') {
    return PLANNER_TEXT_SIZE_DEFAULT;
  }
  const stored = localStorage.getItem(PLANNER_TEXT_SIZE_STORAGE_KEY);
  return stored && PLANNER_TEXT_SIZE_OPTIONS.has(stored) ? stored : PLANNER_TEXT_SIZE_DEFAULT;
}

function persistPlannerTextSizePreference(size) {
  if (typeof localStorage === 'undefined' || !PLANNER_TEXT_SIZE_OPTIONS.has(size)) {
    return;
  }
  localStorage.setItem(PLANNER_TEXT_SIZE_STORAGE_KEY, size);
}

function applyPlannerTextSize(size) {
  if (!plannerPanelElement) {
    return;
  }
  const normalizedSize = PLANNER_TEXT_SIZE_OPTIONS.has(size) ? size : PLANNER_TEXT_SIZE_DEFAULT;
  PLANNER_TEXT_SIZE_CLASSES.forEach((className) => plannerPanelElement.classList.remove(className));
  plannerPanelElement.classList.add(`planner-text-${normalizedSize}`);
}

const initialPlannerTextSize = readPlannerTextSizePreference();
applyPlannerTextSize(initialPlannerTextSize);
if (isPlannerTextSizeSelect(plannerTextSizeSelect)) {
  plannerTextSizeSelect.value = initialPlannerTextSize;
}

function readMobileNotesTextSizePreference() {
  if (typeof localStorage === 'undefined') {
    return MOBILE_NOTES_TEXT_SIZE_DEFAULT;
  }
  const stored = localStorage.getItem(MOBILE_NOTES_TEXT_SIZE_STORAGE_KEY);
  return stored && MOBILE_NOTES_TEXT_SIZE_OPTIONS.has(stored) ? stored : MOBILE_NOTES_TEXT_SIZE_DEFAULT;
}

function persistMobileNotesTextSizePreference(size) {
  if (typeof localStorage === 'undefined' || !MOBILE_NOTES_TEXT_SIZE_OPTIONS.has(size)) {
    return;
  }
  localStorage.setItem(MOBILE_NOTES_TEXT_SIZE_STORAGE_KEY, size);
}

function applyMobileNotesTextSize(size) {
  if (!mobileNotesPanelElement) {
    return;
  }
  const normalizedSize = MOBILE_NOTES_TEXT_SIZE_OPTIONS.has(size) ? size : MOBILE_NOTES_TEXT_SIZE_DEFAULT;
  MOBILE_NOTES_TEXT_SIZE_CLASSES.forEach((className) => mobileNotesPanelElement.classList.remove(className));
  mobileNotesPanelElement.classList.add(`mobile-panel--notes-size-${normalizedSize}`);
}

const initialMobileNotesTextSize = readMobileNotesTextSizePreference();
applyMobileNotesTextSize(initialMobileNotesTextSize);
if (mobileNotesTextSizeSelect instanceof HTMLSelectElement) {
  mobileNotesTextSizeSelect.value = initialMobileNotesTextSize;
  mobileNotesTextSizeSelect.addEventListener('change', (event) => {
    const selectedSize = typeof event.target?.value === 'string' ? event.target.value : MOBILE_NOTES_TEXT_SIZE_DEFAULT;
    if (!MOBILE_NOTES_TEXT_SIZE_OPTIONS.has(selectedSize)) {
      mobileNotesTextSizeSelect.value = readMobileNotesTextSizePreference();
      return;
    }
    persistMobileNotesTextSizePreference(selectedSize);
    applyMobileNotesTextSize(selectedSize);
  });
}
const PLANNER_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function resolvePlannerLessonDayIndex(lesson) {
  if (lesson && Number.isFinite(lesson.dayIndex)) {
    return lesson.dayIndex;
  }
  const label =
    typeof lesson?.dayLabel === 'string' && lesson.dayLabel.trim()
      ? lesson.dayLabel.trim()
      : typeof lesson?.dayName === 'string' && lesson.dayName.trim()
        ? lesson.dayName.trim()
        : '';
  if (!label) {
    return 0;
  }
  const matchIndex = PLANNER_DAY_NAMES.findIndex((day) => day.toLowerCase() === label.toLowerCase());
  return matchIndex >= 0 ? matchIndex : 0;
}

function formatDateForInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createPlannerLessonModal() {
  if (typeof document === 'undefined') {
    return null;
  }

  const modal = document.getElementById('planner-lesson-modal');
  const form = document.getElementById('planner-lesson-form');
  const modalTitle = document.getElementById('planner-modal-title');
  const modalDescription = document.getElementById('planner-modal-description');
  const errorElement = document.getElementById('planner-modal-error');
  const submitButton = document.getElementById('planner-modal-submit');
  const saveAndAddAnotherButton = document.getElementById('planner-modal-submit-add-another');
  const dayField = document.getElementById('planner-lesson-day');
  const periodField = document.getElementById('planner-lesson-period');
  const titleField = document.getElementById('planner-lesson-title');
  const summaryField = document.getElementById('planner-lesson-summary');
  const subjectField = document.getElementById('planner-lesson-subject');
  const statusField = document.getElementById('planner-lesson-status');
  const detailBadgeField = document.getElementById('planner-detail-badge');
  const detailTextField = document.getElementById('planner-detail-text');
  const duplicateWeekInput = document.getElementById('planner-duplicate-week');
  const summaryTemplateButtons = form?.querySelectorAll('[data-summary-template]') || [];

  if (
    !(modal instanceof HTMLElement) ||
    !(form instanceof HTMLFormElement) ||
    !(submitButton instanceof HTMLElement) ||
    !(dayField instanceof HTMLSelectElement) ||
    !(periodField instanceof HTMLInputElement) ||
    !(titleField instanceof HTMLInputElement) ||
    !(summaryField instanceof HTMLTextAreaElement) ||
    !(statusField instanceof HTMLSelectElement)
  ) {
    return null;
  }

  const lessonSection = form.querySelector('[data-planner-lesson-section]');
  const summarySection = form.querySelector('[data-planner-summary-section]');
  const detailSection = form.querySelector('[data-planner-detail-section]');
  const duplicateSection = form.querySelector('[data-planner-duplicate-section]');
  const dialog = modal.querySelector('[data-planner-modal-dialog]');
  const backdrop = modal.querySelector('[data-planner-modal-backdrop]');
  const closeButtons = modal.querySelectorAll('[data-planner-modal-close]');
  const mainContent = document.getElementById('mainContent');
  const primaryNav = document.querySelector('nav[aria-label="Primary"]');
  const backgroundTargets = (() => {
    const targets = [];
    const modalParent = modal.parentElement;
    if (primaryNav instanceof HTMLElement) {
      targets.push(primaryNav);
    }
    if (modalParent instanceof HTMLElement) {
      targets.push(
        ...Array.from(modalParent.children).filter(
          (child) => child instanceof HTMLElement && child !== modal
        )
      );
    } else if (mainContent instanceof HTMLElement) {
      if (mainContent.contains(modal)) {
        targets.push(
          ...Array.from(mainContent.children).filter(
            (child) => child instanceof HTMLElement && !child.contains(modal)
          )
        );
      } else {
        targets.push(mainContent);
      }
    }
    return targets;
  })();

  const focusableSelectors = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ];

  const state = { mode: 'add', lessonId: null, trigger: null };
  let preferredFocusElement = null;
  let lastActiveElement = null;
  let lastUsedDayName = '';
  let lastUsedSubject = '';
  let currentTemplateType = 'simple';
  let submitIntent = 'save';

  const setPreferredFocus = (element) => {
    preferredFocusElement = element instanceof HTMLElement ? element : null;
  };

  const setSubmitIntent = (intent) => {
    submitIntent = intent;
  };

  const setStatusValue = (value) => {
    if (!(statusField instanceof HTMLSelectElement)) {
      return;
    }
    const normalized = LESSON_STATUS_CONFIG[value] ? value : 'not_started';
    statusField.value = normalized;
  };

  const setDayValue = (value) => {
    const dayValue = typeof value === 'string' && value.trim() ? value.trim() : 'Monday';
    dayField.value = dayValue;
    if (dayField.value !== dayValue) {
      dayField.value = 'Monday';
    }
  };

  const applySummaryTemplate = (templateType) => {
    const templateContent = getTemplateContent(templateType || 'simple');
    if (!templateContent) {
      return;
    }
    const existing = typeof summaryField.value === 'string' ? summaryField.value.trim() : '';
    if (existing) {
      const shouldReplace = window.confirm('Replace existing summary with this template?');
      if (!shouldReplace) {
        return;
      }
    }
    summaryField.value = templateContent;
    currentTemplateType = templateType || 'simple';
    summaryField.focus();
  };

  const setBackgroundInert = (shouldInert) => {
    backgroundTargets.forEach((target) => {
      if (!target) {
        return;
      }
      if (shouldInert) {
        target.setAttribute('inert', '');
      } else {
        target.removeAttribute('inert');
      }
    });
  };

  const getFocusableElements = () => {
    if (!(dialog instanceof HTMLElement)) {
      return [];
    }
    const nodes = dialog.querySelectorAll(focusableSelectors.join(','));
    return Array.from(nodes).filter((element) => {
      if (element.closest('[aria-hidden="true"]')) {
        return false;
      }
      if ('disabled' in element && element.disabled) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };

  const focusFirstElement = () => {
    const focusableElements = getFocusableElements();
    const target =
      (preferredFocusElement && focusableElements.includes(preferredFocusElement)
        ? preferredFocusElement
        : null) ||
      focusableElements[0] ||
      dialog;
    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  };

  const enforceFocusWithinModal = (event) => {
    if (!(dialog instanceof HTMLElement)) {
      return;
    }
    if (!dialog.contains(event.target)) {
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
      return;
    }
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    handleTabKey(event);
  };

  const clearError = () => {
    if (!errorElement) {
      return;
    }
    errorElement.textContent = '';
    errorElement.classList.add('hidden');
    errorElement.setAttribute('aria-hidden', 'true');
  };

  const showError = (message) => {
    if (!errorElement) {
      return;
    }
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
    errorElement.removeAttribute('aria-hidden');
  };

  const setSubmitting = (isSubmitting) => {
    submitButton.disabled = Boolean(isSubmitting);
    submitButton.classList.toggle('loading', Boolean(isSubmitting));
    if (saveAndAddAnotherButton instanceof HTMLButtonElement) {
      saveAndAddAnotherButton.disabled = Boolean(isSubmitting);
      saveAndAddAnotherButton.classList.toggle('loading', Boolean(isSubmitting));
    }
  };

  const toggleSection = (section, shouldShow) => {
    if (!(section instanceof HTMLElement)) {
      return;
    }
    section.classList.toggle('hidden', !shouldShow);
    if (shouldShow) {
      section.removeAttribute('aria-hidden');
    } else {
      section.setAttribute('aria-hidden', 'true');
    }
  };

  const setLessonFieldsDisabled = (isDisabled) => {
    [dayField, periodField, titleField, summaryField, subjectField, statusField].forEach((field) => {
      if (field instanceof HTMLElement) {
        field.disabled = Boolean(isDisabled);
        field.classList.toggle('opacity-60', Boolean(isDisabled));
        field.classList.toggle('cursor-not-allowed', Boolean(isDisabled));
      }
    });
    summaryTemplateButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = Boolean(isDisabled);
        button.classList.toggle('opacity-60', Boolean(isDisabled));
        button.classList.toggle('cursor-not-allowed', Boolean(isDisabled));
      }
    });
  };

  const resetForm = () => {
    form.reset();
    clearError();
    setPreferredFocus(null);
    setLessonFieldsDisabled(false);
    if (subjectField instanceof HTMLInputElement) {
      subjectField.value = '';
    }
    if (periodField instanceof HTMLInputElement) {
      periodField.value = '';
    }
    if (detailBadgeField instanceof HTMLInputElement) {
      detailBadgeField.value = '';
    }
    if (detailTextField instanceof HTMLTextAreaElement) {
      detailTextField.value = '';
    } else if (detailTextField instanceof HTMLInputElement) {
      detailTextField.value = '';
    }
    if (duplicateWeekInput instanceof HTMLInputElement) {
      duplicateWeekInput.value = '';
    }
    setStatusValue('not_started');
    currentTemplateType = 'simple';
    submitIntent = 'save';
  };

  const updateModalCopy = ({ title, description, action }) => {
    if (modalTitle) {
      modalTitle.textContent = title || 'Plan lesson';
    }
    if (modalDescription) {
      modalDescription.textContent = description || '';
    }
    submitButton.textContent = action || 'Save lesson';
  };

  const openModal = ({ trigger } = {}) => {
    state.trigger = trigger instanceof HTMLElement ? trigger : null;
    lastActiveElement = state.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    modal.classList.remove('hidden');
    modal.removeAttribute('aria-hidden');
    modal.removeAttribute('inert');
    setBackgroundInert(true);
    document.addEventListener('keydown', handleKeydown, true);
    modal.addEventListener('focusin', enforceFocusWithinModal, true);
    window.requestAnimationFrame(() => {
      focusFirstElement();
    });
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('inert', '');
    setBackgroundInert(false);
    document.removeEventListener('keydown', handleKeydown, true);
    modal.removeEventListener('focusin', enforceFocusWithinModal, true);
    const target = state.trigger || lastActiveElement;
    state.mode = 'add';
    state.lessonId = null;
    state.trigger = null;
    setPreferredFocus(null);
    resetForm();
    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  };

  const openAddLesson = ({ defaultDay = 'Monday', trigger } = {}) => {
    state.mode = 'add';
    state.lessonId = null;
    resetForm();
    toggleSection(lessonSection, true);
    toggleSection(summarySection, true);
    toggleSection(detailSection, false);
    toggleSection(duplicateSection, false);
    setLessonFieldsDisabled(false);
    const resolvedDay = typeof defaultDay === 'string' && defaultDay.trim() ? defaultDay.trim() : 'Monday';
    setDayValue(resolvedDay);
    titleField.value = resolvedDay ? `${resolvedDay} lesson` : '';
    summaryField.value = '';
    if (periodField instanceof HTMLInputElement) {
      periodField.value = '';
    }
    if (subjectField instanceof HTMLInputElement) {
      subjectField.value = '';
    }
    setStatusValue('not_started');
    currentTemplateType = 'simple';
    updateModalCopy({
      title: 'Add lesson',
      description: 'Pick a day and capture the lesson focus for this week.',
      action: 'Save lesson'
    });
    setPreferredFocus(titleField);
    openModal({ trigger });
  };

  const openEditLesson = ({ lesson, trigger } = {}) => {
    if (!lesson) {
      return;
    }
    state.mode = 'edit';
    state.lessonId = lesson.id;
    resetForm();
    toggleSection(lessonSection, true);
    toggleSection(summarySection, true);
    toggleSection(detailSection, false);
    toggleSection(duplicateSection, false);
    setLessonFieldsDisabled(false);
    const dayValue = lesson.dayLabel || lesson.dayName || 'Monday';
    setDayValue(dayValue);
    titleField.value = lesson.title || '';
    summaryField.value = lesson.summary || '';
    if (periodField instanceof HTMLInputElement) {
      periodField.value = lesson.period || '';
    }
    if (subjectField instanceof HTMLInputElement) {
      subjectField.value = lesson.subject || '';
    }
    setStatusValue(lesson.status || 'not_started');
    currentTemplateType = lesson.templateType || 'simple';
    updateModalCopy({
      title: 'Edit lesson',
      description: 'Update the lesson information for this week.',
      action: 'Update lesson'
    });
    setPreferredFocus(titleField);
    openModal({ trigger });
  };

  const openAddDetail = ({ lesson, trigger } = {}) => {
    if (!lesson) {
      return;
    }
    state.mode = 'detail';
    state.lessonId = lesson.id;
    resetForm();
    toggleSection(lessonSection, true);
    toggleSection(summarySection, true);
    toggleSection(detailSection, true);
    toggleSection(duplicateSection, false);
    setLessonFieldsDisabled(true);
    const dayValue = lesson.dayLabel || lesson.dayName || 'Monday';
    setDayValue(dayValue);
    titleField.value = lesson.title || '';
    summaryField.value = lesson.summary || '';
    if (periodField instanceof HTMLInputElement) {
      periodField.value = lesson.period || '';
    }
    if (subjectField instanceof HTMLInputElement) {
      subjectField.value = lesson.subject || '';
    }
    setStatusValue(lesson.status || 'not_started');
    currentTemplateType = lesson.templateType || 'simple';
    if (detailBadgeField instanceof HTMLInputElement) {
      detailBadgeField.value = '';
    }
    if (detailTextField instanceof HTMLTextAreaElement) {
      detailTextField.value = '';
    } else if (detailTextField instanceof HTMLInputElement) {
      detailTextField.value = '';
    }
    updateModalCopy({
      title: 'Add lesson detail',
      description: 'Add a quick badge and note to this lesson.',
      action: 'Save detail'
    });
    setPreferredFocus(detailTextField instanceof HTMLElement ? detailTextField : null);
    openModal({ trigger });
  };

  const openDuplicatePlan = ({ suggestedWeekId = '', trigger } = {}) => {
    state.mode = 'duplicate';
    state.lessonId = null;
    resetForm();
    toggleSection(lessonSection, false);
    toggleSection(summarySection, false);
    toggleSection(detailSection, false);
    toggleSection(duplicateSection, true);
    if (duplicateWeekInput instanceof HTMLInputElement) {
      duplicateWeekInput.value = suggestedWeekId;
    }
    updateModalCopy({
      title: 'Duplicate plan',
      description: 'Copy everything from this week into another week.',
      action: 'Duplicate week'
    });
    setPreferredFocus(duplicateWeekInput instanceof HTMLElement ? duplicateWeekInput : null);
    openModal({ trigger });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearError();
    setSubmitting(true);
    const shouldAddAnother = submitIntent === 'add_another';
    try {
      if (state.mode === 'duplicate') {
        const targetWeekId = duplicateWeekInput?.value?.trim();
        if (!targetWeekId) {
          showError('Enter the Monday date for the destination week.');
          return;
        }
        if (targetWeekId === activePlannerWeekId) {
          showError('Choose a different week to duplicate into.');
          return;
        }
        const plan = await duplicateWeekPlan(activePlannerWeekId, targetWeekId);
        if (plan) {
          activePlannerWeekId = targetWeekId;
          updatePlannerWeekRange(targetWeekId);
          currentPlannerPlan = plan;
          renderPlannerLessons(plan);
          updatePlannerDashboardSummary(plan, targetWeekId);
          closeModal();
        }
        return;
      }

      if (state.mode === 'detail') {
        if (!state.lessonId) {
          showError('Select a lesson before adding details.');
          return;
        }
        const detailText = detailTextField?.value?.trim();
        if (!detailText) {
          showError('Add text for this detail.');
          return;
        }
        const badge = detailBadgeField?.value?.trim() || '';
        const plan = await addLessonDetail(activePlannerWeekId, state.lessonId, { badge, text: detailText });
        if (plan) {
          currentPlannerPlan = plan;
          renderPlannerLessons(plan);
          updatePlannerDashboardSummary(plan, activePlannerWeekId);
          closeModal();
        }
        return;
      }

      const dayName = dayField.value.trim();
      const period = periodField?.value?.trim() || '';
      const title = titleField.value.trim();
      const summary = summaryField.value.trim();
      const subject = subjectField?.value?.trim() || '';
      const status = LESSON_STATUS_CONFIG[statusField?.value] ? statusField.value : 'not_started';

      if (!dayName) {
        showError('Choose a day for this lesson.');
        return;
      }
      if (!title) {
        showError('Enter a lesson title.');
        return;
      }

      if (state.mode === 'edit') {
        if (!state.lessonId) {
          showError('Select a lesson to edit.');
          return;
        }
        const plan = await updateLessonInWeek(activePlannerWeekId, state.lessonId, {
          dayName,
          title,
          summary,
          subject,
          period,
          status,
          templateType: currentTemplateType || 'simple'
        });
        if (plan) {
          currentPlannerPlan = plan;
          renderPlannerLessons(plan);
          updatePlannerDashboardSummary(plan, activePlannerWeekId);
          closeModal();
        }
        return;
      }

      const plan = await addLessonToWeek(activePlannerWeekId, {
        dayName,
        title,
        summary,
        subject,
        period,
        status,
        templateType: currentTemplateType || 'simple'
      });
      if (plan) {
        currentPlannerPlan = plan;
        renderPlannerLessons(plan);
        updatePlannerDashboardSummary(plan, activePlannerWeekId);
        if (shouldAddAnother) {
          lastUsedDayName = dayName;
          lastUsedSubject = subject;
          resetForm();
          setDayValue(lastUsedDayName || 'Monday');
          titleField.value = dayField.value ? `${dayField.value} lesson` : '';
          if (subjectField instanceof HTMLInputElement) {
            subjectField.value = lastUsedSubject || '';
          }
          setStatusValue('not_started');
          currentTemplateType = 'simple';
          setPreferredFocus(titleField);
        } else {
          closeModal();
        }
      }
    } catch (error) {
      console.error('Failed to save planner change', error);
      showError('Unable to save changes right now. Please try again.');
    } finally {
      setSubmitting(false);
      submitIntent = 'save';
    }
  };

  if (saveAndAddAnotherButton instanceof HTMLButtonElement) {
    saveAndAddAnotherButton.addEventListener('click', () => setSubmitIntent('add_another'));
  }

  submitButton.addEventListener('click', () => setSubmitIntent('save'));

  summaryTemplateButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const templateType = button.dataset.summaryTemplate || 'simple';
      applySummaryTemplate(templateType);
    });
  });

  form.addEventListener('submit', handleSubmit);

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

  return {
    openAddLesson,
    openEditLesson,
    openAddDetail,
    openDuplicatePlan,
    close: closeModal
  };
}

const remindersCountElement = document.getElementById('remindersCount');
const plannerLessonModalController =
  typeof document !== 'undefined' ? createPlannerLessonModal() : null;
const plannerCountElement = document.getElementById('plannerCount');
const plannerSubtitleElement = document.getElementById('plannerSubtitle');
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
const defaultPlannerWeekId = getPlannerWeekIdFromDate();
let plannerViewInitialised = false;
let activePlannerWeekId = defaultPlannerWeekId;
let currentPlannerPlan = null;
let plannerRenderPromise = null;
let selectedPlannerLessonId = null;
const plannerNotesSaveTimers = new Map();
const PLANNER_NOTES_SAVE_DELAY = 800;
const PLANNER_NOTES_STATUS_CLEAR_DELAY = 1500;
const PLANNER_NOTES_STATUS_TEXT = {
  idle: 'Notes save automatically.',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Unable to save',
};
const PLANNER_NOTES_STATUS_VALUES = new Set(['saving', 'saved', 'error']);
const PLANNER_NOTES_OPEN_STATE_STORAGE_KEY = 'plannerNotesOpenState';
let plannerNotesOpenState = loadPlannerNotesOpenState();
let plannerTeacherNotesTimer = null;
let plannerViewMode = 'list';
const PLANNER_TEACHER_NOTES_DELAY = 800;

function loadPlannerNotesOpenState() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const stored = localStorage.getItem(PLANNER_NOTES_OPEN_STATE_STORAGE_KEY);
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to load planner notes state', error);
    return {};
  }
}

function persistPlannerNotesOpenState() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(PLANNER_NOTES_OPEN_STATE_STORAGE_KEY, JSON.stringify(plannerNotesOpenState));
  } catch (error) {
    console.warn('Unable to persist planner notes state', error);
  }
}

function isPlannerLessonNotesOpen(lessonId) {
  if (!lessonId) {
    return false;
  }
  return Boolean(plannerNotesOpenState?.[lessonId]);
}

function setPlannerLessonNotesOpenState(lessonId, isOpen) {
  if (!lessonId) {
    return;
  }
  if (isOpen) {
    plannerNotesOpenState = { ...plannerNotesOpenState, [lessonId]: true };
  } else if (plannerNotesOpenState?.[lessonId]) {
    const nextState = { ...plannerNotesOpenState };
    delete nextState[lessonId];
    plannerNotesOpenState = nextState;
  }
  persistPlannerNotesOpenState();
}

function resolvePlannerLessons(sourceLessons, fallbackWeekId = defaultPlannerWeekId) {
  if (Array.isArray(sourceLessons)) {
    return sourceLessons;
  }
  if (sourceLessons && typeof sourceLessons === 'object' && Array.isArray(sourceLessons.lessons)) {
    return sourceLessons.lessons;
  }
  if (typeof fallbackWeekId === 'string' && fallbackWeekId) {
    return getPlannerLessonsForWeek(fallbackWeekId);
  }
  return [];
}

const updatePlannerCountDisplay = (lessons = []) => {
  if (!plannerCountElement) {
    return;
  }
  const total = Array.isArray(lessons) ? lessons.length : 0;
  plannerCountElement.textContent = String(total);
};

function updatePlannerInsights(lessons = []) {
  const lessonList = Array.isArray(lessons) ? lessons : [];
  if (plannerInsightsLessonsElement) {
    plannerInsightsLessonsElement.textContent = String(lessonList.length);
  }
  if (plannerInsightsSubjectsElement) {
    const subjectSet = new Set();
    lessonList.forEach((lesson) => {
      const label = getLessonSubjectLabel(lesson);
      if (label) {
        subjectSet.add(label.toLowerCase());
      }
    });
    plannerInsightsSubjectsElement.textContent = String(subjectSet.size);
  }
  if (plannerInsightsNotesElement) {
    const notesCount = lessonList.filter((lesson) => typeof lesson.notes === 'string' && lesson.notes.trim().length > 0).length;
    plannerInsightsNotesElement.textContent = String(notesCount);
  }
}

function updatePlannerDashboardSummary(plan, fallbackWeekId) {
  const lessons = resolvePlannerLessons(plan, fallbackWeekId);
  updatePlannerCountDisplay(lessons);
  const targetWeekId = plan?.weekId || fallbackWeekId || defaultPlannerWeekId;
  const label = getWeekLabel(targetWeekId, { short: true });
  if (plannerSubtitleElement) {
    plannerSubtitleElement.textContent = label || '';
  }
  if (plannerSummaryCountElement) {
    plannerSummaryCountElement.textContent = String(lessons.length);
  }
  if (plannerSummaryRangeElement) {
    plannerSummaryRangeElement.textContent = label || '';
  }
  updatePlannerInsights(lessons);
}

function renderPlannerMessage(message, { tone = 'muted' } = {}) {
  if (!plannerCardsContainer) {
    return;
  }
  selectedPlannerLessonId = null;
  const classes = [
    'rounded-xl',
    'border',
    'border-dashed',
    'border-base-300/70',
    'bg-base-100/60',
    'p-4',
    'text-sm'
  ];
  classes.push(tone === 'error' ? 'text-error' : 'text-base-content/70');
  plannerCardsContainer.innerHTML = `<p class="${classes.join(' ')}">${escapeCueText(message)}</p>`;
}

function updatePlannerWeekRange(weekId) {
  if (!plannerWeekRangeElement) {
    return;
  }
  const label = getWeekLabel(weekId);
  plannerWeekRangeElement.textContent = label || '';
  if (plannerSummaryRangeElement) {
    plannerSummaryRangeElement.textContent = label || '';
  }
}

function getLessonSubjectLabel(lesson) {
  if (!lesson || typeof lesson !== 'object') {
    return '';
  }
  return typeof lesson.subject === 'string' ? lesson.subject.trim() : '';
}

function getLessonSubjectBadgeClass(subject) {
  if (!subject) {
    return 'badge-ghost';
  }
  const lower = subject.toLowerCase();
  if (lower.includes('hpe') || lower.includes('pe')) {
    return 'badge-info';
  }
  if (lower.includes('english')) {
    return 'badge-success';
  }
  if (lower.includes('civics') || lower.includes('cac')) {
    return 'badge-secondary';
  }
  if (lower.includes('geo')) {
    return 'badge-warning';
  }
  return 'badge-ghost';
}

const LESSON_STATUS_CONFIG = {
  not_started: { label: 'Not started', badge: 'badge-ghost' },
  in_progress: { label: 'In progress', badge: 'badge-warning' },
  ready: { label: 'Ready', badge: 'badge-success' },
  taught: { label: 'Taught', badge: 'badge-neutral' },
};

function renderStatusSelect(lessonId, status) {
  const normalized = LESSON_STATUS_CONFIG[status] ? status : 'not_started';
  const options = Object.entries(LESSON_STATUS_CONFIG)
    .map(([value, config]) => {
      const selected = value === normalized ? 'selected' : '';
      return `<option value="${value}" ${selected}>${escapeCueText(config.label)}</option>`;
    })
    .join('');
  return `
    <label class="flex items-center gap-2 text-xs font-semibold text-base-content/80">
      <span>Status</span>
      <select class="select select-bordered select-xs" data-lesson-status="true" data-lesson-id="${lessonId}">
        ${options}
      </select>
    </label>
  `;
}

function renderResourcesList(resources = [], lessonId = '') {
  if (!resources.length) {
    return '<p class="text-xs text-base-content/60">No resources added yet.</p>';
  }
  return `
    <ul class="space-y-2">
      ${resources
        .map((resource) => {
          const label = typeof resource?.label === 'string' && resource.label.trim() ? resource.label.trim() : 'Resource';
          const url = typeof resource?.url === 'string' ? resource.url.trim() : '';
          const id = typeof resource?.id === 'string' ? resource.id : '';
          const link = url
            ? `<a class="link link-primary break-words" href="${url}" target="_blank" rel="noreferrer">${escapeCueText(label)}</a>`
            : `<span class="text-base-content">${escapeCueText(label)}</span>`;
          const removeButton = id
            ? `<button class="btn btn-ghost btn-xs text-error" type="button" data-planner-action="remove-resource" data-lesson-id="${lessonId}" data-resource-id="${id}">Remove</button>`
            : '';
          return `<li class="flex items-start justify-between gap-2 rounded-lg bg-base-200/70 px-2 py-1">${link}${removeButton}</li>`;
        })
        .join('')}
    </ul>
  `;
}


function renderPlannerLessons(plan) {
  if (!plannerCardsContainer) {
    return;
  }
  updatePlannerTeacherNotesPanel(plan);
  const lessons = Array.isArray(plan?.lessons) ? plan.lessons : [];
  if (!lessons.length) {
    renderPlannerMessage('No lessons saved for this week yet.');
    renderPlannerWeekView([]);
    return;
  }
  const lessonsToRender = lessons;
  const lessonIds = lessonsToRender
    .map((lesson) => (typeof lesson.id === 'string' && lesson.id ? lesson.id : ''))
    .filter((id) => Boolean(id));
  if (selectedPlannerLessonId && !lessonIds.includes(selectedPlannerLessonId)) {
    selectedPlannerLessonId = null;
  }
  const markup = lessonsToRender
    .map((lesson) => {
      const detailItems = Array.isArray(lesson.details)
        ? lesson.details
            .map((detail) => {
              const badge = detail.badge
                ? `<span class="badge badge-outline badge-sm text-secondary">${escapeCueText(detail.badge)}</span>`
                : '';
              return `
                <li class="flex items-center gap-2">
                  ${badge}
                  <span class="text-sm text-base-content/80">${escapeCueText(detail.text)}</span>
                </li>
              `;
            })
            .join('')
        : '';
      const detailsSection = detailItems
        ? `<ul class="space-y-2 text-sm text-base-content/80">${detailItems}</ul>`
        : '<p class="text-sm text-base-content/60">No details yet.</p>';
      const lessonId = typeof lesson.id === 'string' ? lesson.id : '';
      const isSelected = Boolean(selectedPlannerLessonId && lessonId && selectedPlannerLessonId === lessonId);
      const selectionAttributes = ['data-planner-lesson', lessonId ? `data-lesson-id="${lessonId}"` : '', isSelected ? 'data-planner-selected="true"' : '']
        .filter(Boolean)
        .join(' ');
      const summaryMarkup = lesson.summary
        ? `<p class="text-sm text-base-content/80">${escapeCueText(lesson.summary)}</p>`
        : '';
      const subjectLabel = getLessonSubjectLabel(lesson);
      const subjectBadgeClass = getLessonSubjectBadgeClass(subjectLabel);
      const subjectBadge = subjectLabel
        ? `<span class="badge ${subjectBadgeClass} badge-sm">${escapeCueText(subjectLabel)}</span>`
        : '';
      const notesValue = typeof lesson.notes === 'string' ? lesson.notes : '';
      const notesOpen = isPlannerLessonNotesOpen(lessonId);
      const notesSection = lessonId
        ? `
            <details
              class="planner-notes-collapse"
              data-planner-notes-collapse="true"
              data-lesson-id="${lessonId}"
              ${notesOpen ? 'open' : ''}
            >
              <summary class="planner-notes-summary">
                <span class="label-text text-xs font-semibold uppercase tracking-[0.3em] text-base-content/60">Lesson notes</span>
                <span class="planner-notes-summary-indicator" aria-hidden="true"></span>
              </summary>
              <div class="planner-notes-panel">
                <label class="form-control w-full gap-1">
                  <textarea
                    class="textarea textarea-bordered w-full min-h-[6rem] text-base-content"
                    data-planner-notes="true"
                    data-lesson-id="${lessonId}"
                    placeholder="Write lesson notes"
                    spellcheck="true"
                    aria-label="Lesson notes"
                  >${escapeCueText(notesValue)}</textarea>
                  <div class="label py-1">
                    <span class="label-text-alt text-xs text-base-content/60">
                      Status:
                      <span
                        data-notes-status-text
                        data-status="idle"
                        role="status"
                        aria-live="polite"
                      >${escapeCueText(PLANNER_NOTES_STATUS_TEXT.idle)}</span>
                    </span>
                  </div>
                </label>
              </div>
            </details>
          `
        : '';
      const moveControls = lessonId
        ? `
            <div class="flex flex-wrap items-center gap-1 justify-end sm:flex-nowrap" role="group" aria-label="Reorder lesson">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-planner-action="move-up"
                data-lesson-id="${lessonId}"
              >
                Move up
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-planner-action="move-down"
                data-lesson-id="${lessonId}"
              >
                Move down
              </button>
            </div>
          `
        : '';
      const statusSelect = lessonId ? renderStatusSelect(lessonId, lesson.status) : '';
      const resourcesList = renderResourcesList(Array.isArray(lesson.resources) ? lesson.resources : [], lessonId);
      const statusBadge = LESSON_STATUS_CONFIG[lesson.status]?.badge || LESSON_STATUS_CONFIG.not_started.badge;
      const statusLabel = LESSON_STATUS_CONFIG[lesson.status]?.label || LESSON_STATUS_CONFIG.not_started.label;
      const scheduleLabelParts = [lesson.weekDay || lesson.dayLabel || 'Lesson'];
      if (lesson.period) {
        scheduleLabelParts.push(lesson.period);
      }
      const scheduleLabel = scheduleLabelParts.filter(Boolean).join(' · ');
      return `
        <article class="card border border-base-300 bg-base-100 shadow-lg transition hover:-translate-y-1 hover:shadow-xl" ${selectionAttributes}>
          <div class="card-body gap-4">
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-base-content/60">
                  <span>${escapeCueText(scheduleLabel)}</span>
                  <span class="badge ${statusBadge} badge-xs">${escapeCueText(statusLabel)}</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-lg font-semibold text-base-content">${escapeCueText(lesson.title || lesson.dayLabel || 'Lesson')}</h2>
                  ${subjectBadge}
                </div>
                ${summaryMarkup}
                <div class="flex flex-wrap items-center gap-3">
                  ${statusSelect}
                </div>
              </div>
              <div class="flex flex-col items-end gap-2">
                ${moveControls}
                <div class="flex flex-wrap justify-end gap-1">
                  <button type="button" class="btn btn-ghost btn-xs" data-planner-action="duplicate" data-lesson-id="${lessonId}">Duplicate</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-planner-action="edit" data-lesson-id="${lessonId}">
                    Edit
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    data-planner-action="delete"
                    data-lesson-id="${lessonId}"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
            ${detailsSection}
            <div class="rounded-xl border border-base-200 bg-base-200/60 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.2em] text-base-content/60">Resources</p>
                  <p class="text-xs text-base-content/70">Link slides, videos, and activity sheets.</p>
                </div>
                <span class="badge badge-outline badge-sm">${Array.isArray(lesson.resources) ? lesson.resources.length : 0} linked</span>
              </div>
              <div class="mt-2 space-y-2">
                ${resourcesList}
                <div class="grid gap-2 md:grid-cols-[1fr_1.5fr_auto]">
                  <input
                    type="text"
                    class="input input-bordered input-sm w-full"
                    placeholder="Label (e.g. Slides)"
                    data-resource-label="true"
                    data-lesson-id="${lessonId}"
                  />
                  <input
                    type="url"
                    class="input input-bordered input-sm w-full"
                    placeholder="URL"
                    data-resource-url="true"
                    data-lesson-id="${lessonId}"
                  />
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    data-planner-action="add-resource"
                    data-lesson-id="${lessonId}"
                  >
                    Add resource
                  </button>
                </div>
              </div>
            </div>
            ${notesSection}
            <div class="flex flex-wrap items-center gap-2">
              <div class="dropdown dropdown-end">
                <label tabindex="0" class="btn btn-ghost btn-xs">Add template</label>
                <ul tabindex="0" class="dropdown-content menu rounded-box z-[1] mt-2 w-64 bg-base-100 p-2 shadow">
                  <li><button type="button" data-planner-action="apply-template" data-template-type="simple" data-lesson-id="${lessonId}">Simple lesson template</button></li>
                  <li><button type="button" data-planner-action="apply-template" data-template-type="hpe" data-lesson-id="${lessonId}">HPE lesson template</button></li>
                  <li><button type="button" data-planner-action="apply-template" data-template-type="english" data-lesson-id="${lessonId}">English lesson template</button></li>
                  <li><button type="button" data-planner-action="apply-template" data-template-type="cac" data-lesson-id="${lessonId}">CAC lesson template</button></li>
                </ul>
              </div>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                data-planner-action="create-reminder"
                data-open-reminder-modal="true"
                data-lesson-id="${lessonId}"
              >
                Create reminder
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline"
                data-planner-action="add-detail"
                data-lesson-id="${lessonId}"
              >
                Add detail
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
  plannerCardsContainer.innerHTML = markup;
  setSelectedPlannerLesson(selectedPlannerLessonId);
  renderPlannerWeekView(lessonsToRender);
}

function renderPlannerWeekView(lessons = []) {
  if (!plannerWeekViewContainer) {
    return;
  }
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const grouped = days.map((day, index) => ({ day, index, lessons: [] }));
  lessons.forEach((lesson) => {
    const dayIndex = Number.isFinite(lesson?.dayIndex) ? lesson.dayIndex : 0;
    const target = grouped.find((entry) => entry.index === dayIndex);
    if (target) {
      target.lessons.push(lesson);
    }
  });
  const markup = grouped
    .map(({ day, lessons: dayLessons }) => {
      const items = dayLessons
        .map((lesson) => {
          const subjectLabel = getLessonSubjectLabel(lesson);
          const subjectBadgeClass = getLessonSubjectBadgeClass(subjectLabel);
          const statusLabel = LESSON_STATUS_CONFIG[lesson.status]?.label || LESSON_STATUS_CONFIG.not_started.label;
          const statusBadge = LESSON_STATUS_CONFIG[lesson.status]?.badge || LESSON_STATUS_CONFIG.not_started.badge;
          return `
            <button
              type="button"
              class="w-full text-left rounded-xl border border-base-200 bg-base-100 px-3 py-2 shadow-sm transition hover:-translate-y-[1px] hover:shadow"
              data-week-view-lesson="${lesson.id || ''}"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-xs font-semibold text-base-content/70">${escapeCueText(lesson.title || lesson.dayLabel || 'Lesson')}</p>
                  <p class="text-xs text-base-content/60">${escapeCueText(lesson.summary || '')}</p>
                </div>
                <div class="flex flex-col items-end gap-1">
                  ${subjectLabel ? `<span class="badge ${subjectBadgeClass} badge-xs">${escapeCueText(subjectLabel)}</span>` : ''}
                  <span class="badge ${statusBadge} badge-xs">${escapeCueText(statusLabel)}</span>
                </div>
              </div>
            </button>
          `;
        })
        .join('');
      const fallback = '<p class="text-xs text-base-content/60">No lessons yet.</p>';
      return `
        <div class="space-y-2 rounded-2xl border border-base-200 bg-base-200/50 p-3">
          <p class="text-xs font-semibold uppercase tracking-[0.25em] text-base-content/70">${day}</p>
          <div class="space-y-2">${items || fallback}</div>
        </div>
      `;
    })
    .join('');
  plannerWeekViewContainer.innerHTML = markup;
}

function setPlannerViewMode(mode = 'list') {
  const normalized = mode === 'week' ? 'week' : 'list';
  plannerViewMode = normalized;
  if (plannerCardsContainer) {
    plannerCardsContainer.classList.toggle('hidden', normalized === 'week');
  }
  if (plannerWeekViewContainer) {
    plannerWeekViewContainer.classList.toggle('hidden', normalized !== 'week');
  }
  if (plannerListViewToggle instanceof HTMLElement) {
    plannerListViewToggle.setAttribute('aria-pressed', normalized === 'list' ? 'true' : 'false');
  }
  if (plannerWeekViewToggle instanceof HTMLElement) {
    plannerWeekViewToggle.setAttribute('aria-pressed', normalized === 'week' ? 'true' : 'false');
  }
  if (normalized === 'week') {
    renderPlannerWeekView(currentPlannerPlan?.lessons || []);
  }
}
function setSelectedPlannerLesson(lessonId) {
  selectedPlannerLessonId = lessonId || null;
  if (plannerCardsContainer) {
    const cards = plannerCardsContainer.querySelectorAll('[data-planner-lesson]');
    cards.forEach((card) => {
      const matches = Boolean(lessonId) && card.getAttribute('data-lesson-id') === lessonId;
      if (matches) {
        card.setAttribute('data-planner-selected', 'true');
      } else {
        card.removeAttribute('data-planner-selected');
      }
    });
  }
}

function handlePlannerWeekViewClick(event) {
  const trigger = event.target instanceof Element ? event.target.closest('[data-week-view-lesson]') : null;
  if (!trigger) {
    return;
  }
  const lessonId = trigger.getAttribute('data-week-view-lesson');
  if (!lessonId) {
    return;
  }
  setPlannerViewMode('list');
  setSelectedPlannerLesson(lessonId);
  const card = plannerCardsContainer?.querySelector(`[data-lesson-id="${lessonId}"]`);
  if (card instanceof HTMLElement && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function getSelectedPlannerLessonId() {
  if (!selectedPlannerLessonId) {
    return null;
  }
  const lessons = Array.isArray(currentPlannerPlan?.lessons) ? currentPlannerPlan.lessons : [];
  return lessons.some((lesson) => lesson.id === selectedPlannerLessonId) ? selectedPlannerLessonId : null;
}

function handlePlannerSelection(event) {
  const lessonCard = event.target instanceof Element ? event.target.closest('[data-planner-lesson][data-lesson-id]') : null;
  if (!lessonCard) {
    return;
  }
  const lessonId = lessonCard.getAttribute('data-lesson-id');
  if (!lessonId || lessonId === selectedPlannerLessonId) {
    return;
  }
  setSelectedPlannerLesson(lessonId);
}

function handlePlannerTextSizeChange(event) {
  const select = isPlannerTextSizeSelect(event?.currentTarget) ? event.currentTarget : plannerTextSizeSelect;
  if (!isPlannerTextSizeSelect(select)) {
    return;
  }
  const selectedSize = select.value;
  const normalizedSize = PLANNER_TEXT_SIZE_OPTIONS.has(selectedSize) ? selectedSize : PLANNER_TEXT_SIZE_DEFAULT;
  applyPlannerTextSize(normalizedSize);
  persistPlannerTextSizePreference(normalizedSize);
  if (select.value !== normalizedSize) {
    select.value = normalizedSize;
  }
}

function getPlannerTimeoutScheduler() {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    return window.setTimeout.bind(window);
  }
  if (typeof setTimeout === 'function') {
    return setTimeout;
  }
  return null;
}

function getPlannerTimeoutClearer() {
  if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
    return window.clearTimeout.bind(window);
  }
  if (typeof clearTimeout === 'function') {
    return clearTimeout;
  }
  return null;
}

function clearPlannerNotesTimer(lessonId) {
  if (!lessonId) {
    return;
  }
  const timer = plannerNotesSaveTimers.get(lessonId);
  if (!timer) {
    return;
  }
  const clearFn = getPlannerTimeoutClearer();
  if (clearFn) {
    clearFn(timer);
  }
  plannerNotesSaveTimers.delete(lessonId);
}

function setPlannerNotesFieldStatus(field, status) {
  if (!(field instanceof HTMLTextAreaElement)) {
    return;
  }
  const normalizedStatus = typeof status === 'string' && PLANNER_NOTES_STATUS_VALUES.has(status) ? status : null;
  if (normalizedStatus) {
    field.setAttribute('data-notes-status', normalizedStatus);
  } else {
    field.removeAttribute('data-notes-status');
  }
}

function setPlannerNotesStatusText(field, status) {
  if (!(field instanceof HTMLTextAreaElement)) {
    return;
  }
  const normalizedStatus = typeof status === 'string' && PLANNER_NOTES_STATUS_VALUES.has(status) ? status : null;
  const statusTextElement =
    field.parentElement instanceof HTMLElement
      ? field.parentElement.querySelector('[data-notes-status-text]')
      : null;
  if (statusTextElement instanceof HTMLElement) {
    const textKey = normalizedStatus || 'idle';
    const textValue = PLANNER_NOTES_STATUS_TEXT[textKey] || PLANNER_NOTES_STATUS_TEXT.idle;
    statusTextElement.textContent = textValue;
    statusTextElement.setAttribute('data-status', textKey);
  }
}

function updatePlannerTeacherNotesPanel(plan) {
  if (!(plannerTeacherNotesField instanceof HTMLTextAreaElement)) {
    return;
  }
  setTeacherNotesStatus('idle');
  const value = typeof plan?.teacherNotes === 'string' ? plan.teacherNotes : '';
  if (plannerTeacherNotesField.value !== value) {
    plannerTeacherNotesField.value = value;
  }
}

function setTeacherNotesStatus(statusKey = 'idle') {
  if (!(plannerTeacherNotesStatus instanceof HTMLElement)) {
    return;
  }
  const textMap = {
    idle: 'Notes save automatically.',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Unable to save',
  };
  const text = textMap[statusKey] || textMap.idle;
  plannerTeacherNotesStatus.textContent = text;
  plannerTeacherNotesStatus.setAttribute('data-status', statusKey);
}

async function persistPlannerTeacherNotes(value) {
  if (!activePlannerWeekId) {
    return;
  }
  setTeacherNotesStatus('saving');
  try {
    const plan = await updatePlannerTeacherNotes(activePlannerWeekId, value);
    if (plan) {
      currentPlannerPlan = plan;
    }
    setTeacherNotesStatus('saved');
    const scheduleClear = getPlannerTimeoutScheduler();
    if (scheduleClear) {
      scheduleClear(() => setTeacherNotesStatus('idle'), PLANNER_NOTES_STATUS_CLEAR_DELAY);
    } else {
      setTeacherNotesStatus('idle');
    }
  } catch (error) {
    console.error('Failed to save teacher notes', error);
    setTeacherNotesStatus('error');
  }
}

function handlePlannerTeacherNotesInput(event) {
  if (!(plannerTeacherNotesField instanceof HTMLTextAreaElement) || event?.target !== plannerTeacherNotesField) {
    return;
  }
  if (plannerTeacherNotesTimer) {
    const clearFn = getPlannerTimeoutClearer();
    if (clearFn) {
      clearFn(plannerTeacherNotesTimer);
    }
  }
  const schedule = getPlannerTimeoutScheduler();
  if (!schedule) {
    return;
  }
  plannerTeacherNotesTimer = schedule(() => {
    plannerTeacherNotesTimer = null;
    persistPlannerTeacherNotes(plannerTeacherNotesField.value);
  }, PLANNER_TEACHER_NOTES_DELAY);
}

function getTemplateContent(templateType = 'simple') {
  switch (templateType) {
    case 'hpe':
      return `Focus skill:\nWarm-up:\nSkill drill:\nModified game:\nReflection questions:`;
    case 'english':
      return `Text focus:\nDiscussion questions:\nMentor sentence:\nWriting task:\nReflection / exit ticket:`;
    case 'cac':
      return `Civics topic:\nKey terms:\nSource / video:\nDiscussion questions:\nActivity:\nReflection question:`;
    case 'simple':
    default:
      return `Learning intention:\nSuccess criteria:\nWarm-up:\nMain activity:\nExit task:`;
  }
}

async function applyLessonTemplate(lessonId, templateType) {
  if (!lessonId) {
    return;
  }
  await ensurePlannerPlanAvailable();
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  if (!lesson) {
    return;
  }
  const templateNotes = getTemplateContent(templateType);
  const notesValue = typeof lesson.notes === 'string' ? lesson.notes : '';
  const combinedNotes = notesValue ? `${notesValue.trim()}\n\n${templateNotes}` : templateNotes;
  try {
    const plan = await updateLessonInWeek(activePlannerWeekId, lessonId, {
      notes: combinedNotes,
      templateType: templateType || 'simple',
    });
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
    }
  } catch (error) {
    console.error('Failed to apply lesson template', error);
  }
}

async function handlePlannerStatusChange(event) {
  const select = event.target instanceof HTMLSelectElement && event.target.hasAttribute('data-lesson-status')
    ? event.target
    : null;
  if (!select) {
    return;
  }
  const lessonId = select.getAttribute('data-lesson-id');
  const statusValue = select.value;
  if (!lessonId) {
    return;
  }
  try {
    const plan = await updateLessonInWeek(activePlannerWeekId, lessonId, { status: statusValue });
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
    }
  } catch (error) {
    console.error('Failed to update lesson status', error);
  }
}

async function handlePlannerAddResource(lessonId, labelInput, urlInput) {
  if (!lessonId || !(labelInput instanceof HTMLInputElement) || !(urlInput instanceof HTMLInputElement)) {
    return;
  }
  const label = labelInput.value.trim();
  const url = urlInput.value.trim();
  if (!label && !url) {
    return;
  }
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  if (!lesson) {
    return;
  }
  const nextResources = Array.isArray(lesson.resources) ? [...lesson.resources] : [];
  nextResources.push({ id: generateClientId('resource'), label, url });
  try {
    const plan = await updateLessonInWeek(activePlannerWeekId, lessonId, { resources: nextResources });
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
    }
    labelInput.value = '';
    urlInput.value = '';
  } catch (error) {
    console.error('Failed to add resource', error);
  }
}

async function handlePlannerRemoveResource(lessonId, resourceId) {
  if (!lessonId || !resourceId) {
    return;
  }
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  if (!lesson) {
    return;
  }
  const nextResources = (lesson.resources || []).filter((resource) => resource?.id !== resourceId);
  try {
    const plan = await updateLessonInWeek(activePlannerWeekId, lessonId, { resources: nextResources });
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
    }
  } catch (error) {
    console.error('Failed to remove resource', error);
  }
}

async function persistPlannerLessonNotes(lessonId, notesValue, textarea) {
  if (!lessonId || !activePlannerWeekId) {
    return;
  }
  const field = textarea instanceof HTMLTextAreaElement ? textarea : null;
  if (field) {
    setPlannerNotesFieldStatus(field, 'saving');
    setPlannerNotesStatusText(field, 'saving');
  }
  try {
    const plan = await updateLessonInWeek(activePlannerWeekId, lessonId, { notes: notesValue });
    if (plan) {
      currentPlannerPlan = plan;
    }
    if (field) {
      setPlannerNotesFieldStatus(field, 'saved');
      setPlannerNotesStatusText(field, 'saved');
      const scheduleClear = getPlannerTimeoutScheduler();
      if (scheduleClear) {
        scheduleClear(() => {
          if (field.getAttribute('data-notes-status') === 'saved') {
            setPlannerNotesFieldStatus(field, null);
            setPlannerNotesStatusText(field, null);
          }
        }, PLANNER_NOTES_STATUS_CLEAR_DELAY);
      } else {
        setPlannerNotesFieldStatus(field, null);
        setPlannerNotesStatusText(field, null);
      }
    }
  } catch (error) {
    console.error('Failed to save planner notes', error);
    if (field) {
      setPlannerNotesFieldStatus(field, 'error');
      setPlannerNotesStatusText(field, 'error');
    }
  }
}

function handlePlannerNotesInput(event) {
  const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
  if (!textarea || !textarea.hasAttribute('data-planner-notes')) {
    return;
  }
  const lessonId = textarea.getAttribute('data-lesson-id');
  if (!lessonId) {
    return;
  }
  clearPlannerNotesTimer(lessonId);
  const scheduler = getPlannerTimeoutScheduler();
  if (!scheduler) {
    persistPlannerLessonNotes(lessonId, textarea.value, textarea);
    return;
  }
  const timerId = scheduler(() => {
    plannerNotesSaveTimers.delete(lessonId);
    persistPlannerLessonNotes(lessonId, textarea.value, textarea);
  }, PLANNER_NOTES_SAVE_DELAY);
  plannerNotesSaveTimers.set(lessonId, timerId);
}

function handlePlannerNotesFocusOut(event) {
  const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
  if (!textarea || !textarea.hasAttribute('data-planner-notes')) {
    return;
  }
  const lessonId = textarea.getAttribute('data-lesson-id');
  if (!lessonId) {
    return;
  }
  clearPlannerNotesTimer(lessonId);
  persistPlannerLessonNotes(lessonId, textarea.value, textarea);
}

function handlePlannerNotesToggle(event) {
  const details = event.target instanceof HTMLDetailsElement ? event.target : null;
  if (!details || !details.hasAttribute('data-planner-notes-collapse')) {
    return;
  }
  const lessonId = details.getAttribute('data-lesson-id');
  if (!lessonId) {
    return;
  }
  const isOpen = details.hasAttribute('open');
  setPlannerLessonNotesOpenState(lessonId, isOpen);
}

function renderPlannerForWeek(weekId) {
  if (!plannerCardsContainer) {
    plannerRenderPromise = null;
    return Promise.resolve();
  }
  const targetWeekId = weekId || getPlannerWeekIdFromDate();
  activePlannerWeekId = targetWeekId;
  updatePlannerWeekRange(targetWeekId);
  renderPlannerMessage('Loading plan…');
  const loadOperation = (async () => {
    try {
      const plan = await loadWeekPlan(targetWeekId);
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, targetWeekId);
    } catch (error) {
      console.error('Failed to load planner week', error);
      renderPlannerMessage('Unable to load this week\'s planner.', { tone: 'error' });
    }
  })();
  plannerRenderPromise = loadOperation;
  return loadOperation.finally(() => {
    if (plannerRenderPromise === loadOperation) {
      plannerRenderPromise = null;
    }
  });
}

async function ensurePlannerPlanAvailable() {
  if (!plannerCardsContainer) {
    return;
  }
  if (!plannerViewInitialised) {
    initPlannerView();
  }
  let pendingRender = plannerRenderPromise;
  if (!pendingRender && (!currentPlannerPlan || currentPlannerPlan.weekId !== activePlannerWeekId)) {
    pendingRender = renderPlannerForWeek(activePlannerWeekId);
  }
  if (pendingRender && typeof pendingRender.then === 'function') {
    try {
      await pendingRender;
    } catch (error) {
      console.error('Planner failed to load', error);
    }
  }
}

async function handlePlannerCreateReminder(lessonId, triggerElement) {
  if (!lessonId) {
    return;
  }
  await ensurePlannerPlanAvailable();
  const lessons = Array.isArray(currentPlannerPlan?.lessons) ? currentPlannerPlan.lessons : [];
  if (!lessons.length) {
    return;
  }
  const lesson = lessons.find((entry) => entry?.id === lessonId);
  if (!lesson) {
    return;
  }
  const dayLabel =
    typeof lesson.dayLabel === 'string' && lesson.dayLabel.trim()
      ? lesson.dayLabel.trim()
      : typeof lesson.dayName === 'string' && lesson.dayName.trim()
        ? lesson.dayName.trim()
        : '';
  const lessonTitle =
    typeof lesson.title === 'string' && lesson.title.trim()
      ? lesson.title.trim()
      : dayLabel || 'Lesson';
  const summary = typeof lesson.summary === 'string' && lesson.summary.trim() ? lesson.summary.trim() : '';
  const baseTitle = summary || lessonTitle;
  const reminderTitle = dayLabel ? `${dayLabel} · ${baseTitle}` : baseTitle;
  const reminderNotes = summary || '';
  const dayIndex = resolvePlannerLessonDayIndex(lesson);
  const dueDateValue = formatDateForInputValue(getWeekDateForDayIndex(activePlannerWeekId, dayIndex));
  const detail = {
    reminderTitle,
    reminderNotes,
    dueDate: dueDateValue,
    dayLabel,
    lessonTitle,
    summary,
    plannerLessonId: lessonId,
  };
  safeDispatchDocumentEvent('cue:prepare', { trigger: triggerElement, source: 'planner' });
  safeDispatchDocumentEvent('planner:prefillReminder', detail);
  safeDispatchDocumentEvent('cue:open', { trigger: triggerElement, source: 'planner' });
}

async function handlePlannerDuplicateLesson(lessonId, triggerElement) {
  if (!lessonId) {
    return;
  }
  await ensurePlannerPlanAvailable();
  const lessons = Array.isArray(currentPlannerPlan?.lessons) ? currentPlannerPlan.lessons : [];
  const lesson = lessons.find((entry) => entry?.id === lessonId);
  if (!lesson) {
    return;
  }
  const trigger = triggerElement instanceof HTMLElement ? triggerElement : null;
  if (trigger) {
    trigger.setAttribute('disabled', 'true');
  }
  const duplicateId = generateClientId('lesson');
  const lessonCopy = {
    id: duplicateId,
    dayIndex: lesson.dayIndex,
    dayLabel: lesson.dayLabel,
    dayName: lesson.dayName,
    title: lesson.title,
    summary: lesson.summary,
    subject: lesson.subject,
    notes: lesson.notes,
    period: lesson.period,
    templateType: lesson.templateType || 'simple',
    status: 'not_started',
    resources: Array.isArray(lesson.resources)
      ? lesson.resources.map((resource) => ({
          label: resource?.label || '',
          url: resource?.url || '',
        }))
      : [],
    details: Array.isArray(lesson.details)
      ? lesson.details.map((detail) => ({ badge: detail?.badge || '', text: detail?.text || '' }))
      : [],
  };
  try {
    const plan = await addLessonToWeek(activePlannerWeekId, lessonCopy);
    let nextPlan = plan;
    if (plan && Number.isFinite(lesson.position)) {
      nextPlan = await updateLessonInWeek(activePlannerWeekId, duplicateId, { position: lesson.position + 0.1 });
    }
    if (nextPlan) {
      currentPlannerPlan = nextPlan;
      selectedPlannerLessonId = duplicateId;
      renderPlannerLessons(nextPlan);
      updatePlannerDashboardSummary(nextPlan, activePlannerWeekId);
      if (liveStatusRegion) {
        liveStatusRegion.textContent = `Duplicated ${lesson.title || 'lesson'} into this week.`;
      }
    }
  } catch (error) {
    console.error('Failed to duplicate planner lesson', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Unable to duplicate that lesson right now.');
    }
  } finally {
    if (trigger) {
      trigger.removeAttribute('disabled');
    }
  }
}

function handlePlannerOpenResources() {
  if (typeof window === 'undefined') {
    return;
  }
  const targetHash = '#resources';
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  if (typeof window.renderRoute === 'function') {
    window.renderRoute();
  }
  scheduleRouteFocus('resources');
  if (liveStatusRegion) {
    liveStatusRegion.textContent = 'Opening resources to add new materials.';
  }
}

async function handlePlannerCardAction(event) {
  const trigger = event.target instanceof Element ? event.target.closest('[data-planner-action]') : null;
  if (!trigger) {
    return;
  }
  event.preventDefault();
  const action = trigger.getAttribute('data-planner-action');
  const lessonId = trigger.getAttribute('data-lesson-id');
  if (!action) {
    return;
  }
  switch (action) {
    case 'add-detail':
      handlePlannerAddDetail(lessonId, trigger);
      break;
    case 'edit':
      handlePlannerEditLesson(lessonId, trigger);
      break;
    case 'delete':
      handlePlannerDeleteLesson(lessonId);
      break;
    case 'duplicate':
      await handlePlannerDuplicateLesson(lessonId, trigger);
      break;
    case 'apply-template': {
      const templateType = trigger.getAttribute('data-template-type') || 'simple';
      applyLessonTemplate(lessonId, templateType);
      break;
    }
    case 'add-resource': {
      const card = trigger.closest('[data-planner-lesson]');
      const labelInput = card?.querySelector('input[data-resource-label][data-lesson-id]');
      const urlInput = card?.querySelector('input[data-resource-url][data-lesson-id]');
      await handlePlannerAddResource(lessonId, labelInput, urlInput);
      break;
    }
    case 'remove-resource': {
      const resourceId = trigger.getAttribute('data-resource-id');
      await handlePlannerRemoveResource(lessonId, resourceId);
      break;
    }
    case 'move-up':
      handlePlannerMoveLesson(lessonId, 'up', trigger);
      break;
    case 'move-down':
      handlePlannerMoveLesson(lessonId, 'down', trigger);
      break;
    case 'create-reminder':
      await handlePlannerCreateReminder(lessonId, trigger);
      break;
    default:
      break;
  }
}

async function handlePlannerNewLesson(event) {
  if (typeof document === 'undefined' || !plannerLessonModalController) {
    return;
  }
  event?.preventDefault?.();
  const triggerElement = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const defaultDay = currentPlannerPlan?.lessons?.[0]?.dayLabel || 'Monday';
  plannerLessonModalController.openAddLesson({ defaultDay, trigger: triggerElement });
}

async function handlePlannerDuplicatePlan(event) {
  if (!plannerLessonModalController) {
    return;
  }
  event?.preventDefault?.();
  const triggerElement = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const suggestedWeekId = getWeekIdFromOffset(activePlannerWeekId, 1);
  plannerLessonModalController.openDuplicatePlan({ suggestedWeekId, trigger: triggerElement });
}

async function handlePlannerCopyPreviousWeek(event) {
  if (!activePlannerWeekId) {
    return;
  }
  event?.preventDefault?.();
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const sourceWeekId = getWeekIdFromOffset(activePlannerWeekId, -1);
  if (!sourceWeekId) {
    return;
  }
  if (trigger) {
    trigger.setAttribute('disabled', 'true');
  }
  try {
    const plan = await duplicateWeekPlan(sourceWeekId, activePlannerWeekId);
    if (plan) {
      currentPlannerPlan = plan;
      selectedPlannerLessonId = null;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
      if (liveStatusRegion) {
        liveStatusRegion.textContent = 'Copied last week into this plan.';
      }
    }
  } catch (error) {
    console.error('Failed to copy previous planner week', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Unable to copy last week right now.');
    }
  } finally {
    if (trigger) {
      trigger.removeAttribute('disabled');
    }
  }
}

async function handlePlannerClearWeek(event) {
  if (!activePlannerWeekId) {
    return;
  }
  event?.preventDefault?.();
  let shouldClear = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    shouldClear = window.confirm('Clear all lessons for this week?');
  }
  if (!shouldClear) {
    return;
  }
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (trigger) {
    trigger.setAttribute('disabled', 'true');
  }
  try {
    const plan = await clearWeekPlan(activePlannerWeekId);
    if (plan) {
      currentPlannerPlan = plan;
      selectedPlannerLessonId = null;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
      if (liveStatusRegion) {
        liveStatusRegion.textContent = 'Cleared this week\'s plan.';
      }
    }
  } catch (error) {
    console.error('Failed to clear planner week', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Unable to clear this week right now.');
    }
  } finally {
    if (trigger) {
      trigger.removeAttribute('disabled');
    }
  }
}

async function handlePlannerAddDetail(lessonId, triggerElement) {
  if (!lessonId || !plannerLessonModalController) {
    return;
  }
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  if (!lesson) {
    return;
  }
  const trigger = triggerElement instanceof HTMLElement ? triggerElement : null;
  plannerLessonModalController.openAddDetail({ lesson, trigger });
}

async function handlePlannerEditLesson(lessonId, triggerElement) {
  if (!lessonId || !plannerLessonModalController) {
    return;
  }
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  if (!lesson) {
    return;
  }
  const trigger = triggerElement instanceof HTMLElement ? triggerElement : null;
  plannerLessonModalController.openEditLesson({ lesson, trigger });
}

async function handlePlannerMoveLesson(lessonId, direction, triggerElement) {
  if (!lessonId || !direction) {
    return;
  }
  const weekId = activePlannerWeekId || getPlannerWeekIdFromDate();
  if (!weekId) {
    return;
  }
  const trigger = triggerElement instanceof HTMLElement ? triggerElement : null;
  if (trigger) {
    trigger.setAttribute('disabled', 'true');
  }
  try {
    const plan = await movePlannerLesson(weekId, lessonId, direction);
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, weekId);
    }
  } catch (error) {
    console.error('Failed to move planner lesson', error);
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Unable to move that lesson right now.');
    }
  } finally {
    if (trigger) {
      trigger.removeAttribute('disabled');
    }
  }
}

async function handlePlannerDeleteLesson(lessonId) {
  if (!lessonId || typeof window === 'undefined') {
    return;
  }
  const lesson = currentPlannerPlan?.lessons?.find((entry) => entry.id === lessonId);
  const shouldDelete = window.confirm(
    lesson?.title ? `Delete "${lesson.title}" from this week?` : 'Delete this lesson?'
  );
  if (!shouldDelete) {
    return;
  }
  try {
    const plan = await deleteLessonFromWeek(activePlannerWeekId, lessonId);
    if (plan) {
      currentPlannerPlan = plan;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
    }
  } catch (error) {
    console.error('Failed to delete planner lesson', error);
    window.alert('Unable to delete that lesson right now.');
  }
}

function initPlannerView() {
  if (plannerViewInitialised || !plannerCardsContainer) {
    if (plannerViewInitialised) {
      renderPlannerForWeek(activePlannerWeekId);
    }
    return;
  }
  plannerViewInitialised = true;
  initPlannerStore({ ensureFirestore: ensureCueFirestore });
  plannerCardsContainer.addEventListener('click', handlePlannerSelection);
  plannerCardsContainer.addEventListener('click', handlePlannerCardAction);
  plannerCardsContainer.addEventListener('change', handlePlannerStatusChange);
  plannerCardsContainer.addEventListener('input', handlePlannerNotesInput);
  plannerCardsContainer.addEventListener('focusout', handlePlannerNotesFocusOut);
  plannerCardsContainer.addEventListener('toggle', handlePlannerNotesToggle);
  plannerWeekViewContainer?.addEventListener('click', handlePlannerWeekViewClick);
  if (plannerTeacherNotesField instanceof HTMLTextAreaElement) {
    plannerTeacherNotesField.addEventListener('input', handlePlannerTeacherNotesInput);
  }
  plannerNewLessonButton?.addEventListener('click', handlePlannerNewLesson);
  plannerDuplicateButton?.addEventListener('click', handlePlannerDuplicatePlan);
  plannerCopyWeekButton?.addEventListener('click', handlePlannerCopyPreviousWeek);
  plannerClearWeekButton?.addEventListener('click', handlePlannerClearWeek);
  plannerTextSizeSelect?.addEventListener('change', handlePlannerTextSizeChange);
  plannerListViewToggle?.addEventListener('click', () => setPlannerViewMode('list'));
  plannerWeekViewToggle?.addEventListener('click', () => setPlannerViewMode('week'));
  plannerPrevButton?.addEventListener('click', () => {
    const previousWeek = getWeekIdFromOffset(activePlannerWeekId, -1);
    renderPlannerForWeek(previousWeek);
  });
  plannerNextButton?.addEventListener('click', () => {
    const nextWeek = getWeekIdFromOffset(activePlannerWeekId, 1);
    renderPlannerForWeek(nextWeek);
  });
  plannerTodayButton?.addEventListener('click', () => {
    renderPlannerForWeek(getPlannerWeekIdFromDate());
  });
  setPlannerViewMode(plannerViewMode);
  renderPlannerForWeek(activePlannerWeekId);
}

function handlePlannerRouteVisibility() {
  if (typeof window === 'undefined') {
    return;
  }
  if (getActiveRouteFromHash() === 'planner') {
    initPlannerView();
  }
}

function handlePlannerUpdated(event) {
  const plan = event?.detail?.plan;
  if (!plan) {
    return;
  }
  if (plannerViewInitialised && plan.weekId === activePlannerWeekId) {
    currentPlannerPlan = plan;
    renderPlannerLessons(plan);
    updatePlannerWeekRange(plan.weekId);
    updatePlannerDashboardSummary(plan, plan.weekId);
  } else if (plan.weekId === defaultPlannerWeekId) {
    updatePlannerDashboardSummary(plan, defaultPlannerWeekId);
  }
}

updatePlannerDashboardSummary(null, defaultPlannerWeekId);

if (typeof document !== 'undefined') {
  document.addEventListener(PLANNER_UPDATED_EVENT, handlePlannerUpdated);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', handlePlannerRouteVisibility);
  window.addEventListener('DOMContentLoaded', handlePlannerRouteVisibility);
}

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
      const checkboxId = `daily-task-${index}`;
      const textClasses = ['ml-3', 'flex-1', 'text-sm', 'sm:text-base', 'text-base-content'];
      if (completed) {
        textClasses.push('line-through', 'text-opacity-50');
      }
      return `
        <label class="flex items-center p-3 border-b border-base-200" data-task-index="${index}" for="${checkboxId}">
          <input id="${checkboxId}" type="checkbox" class="checkbox checkbox-sm" data-task-index="${index}" ${completed ? 'checked' : ''} />
          <span class="${textClasses.join(' ')}">${safeText}</span>
        </label>
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
  let renderedLocalFallback = false;
  if (shouldUseLocalDailyList) {
    showDailyListPermissionNotice();
    const localTasks = getLocalDailyTasks(todayId);
    currentDailyTasks = localTasks;
    renderDailyTasks(localTasks);
    renderedLocalFallback = true;
  }
  if (!dailyListLoadPromise) {
    if (!renderedLocalFallback) {
      dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">Loading tasks…</p>';
      updateClearCompletedButtonState([]);
    }
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
        return currentDailyTasks;
      } catch (error) {
        const permissionError = isPermissionDeniedError(error);
        if (permissionError) {
          console.warn('Falling back to local daily tasks due to permission issue', error);
          shouldUseLocalDailyList = true;
          showDailyListPermissionNotice();
        } else {
          console.error('Failed to load daily list', error);
        }
        const localTasks = getLocalDailyTasks(todayId);
        currentDailyTasks = localTasks;
        if (localTasks.length || renderedLocalFallback) {
          renderDailyTasks(localTasks);
        } else {
          dailyTasksContainer.innerHTML = '<p class="text-sm text-error">Unable to load daily tasks right now.</p>';
          currentDailyTasks = [];
          updateClearCompletedButtonState(currentDailyTasks);
        }
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
    shouldUseLocalDailyList = false;
    hideDailyListPermissionNotice();
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
  try {
    const firestore = await ensureDailyListFirestore();
    const ref = getDailyListDocRef(firestore, todayId);
    if (typeof firestore.setDoc === 'function') {
      await firestore.setDoc(ref, { tasks: payload }, { merge: true });
    } else {
      await firestore.updateDoc(ref, { tasks: payload });
    }
    setLocalDailyTasks(todayId, payload);
    shouldUseLocalDailyList = false;
    hideDailyListPermissionNotice();
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
  loadDailyList();
}

function initDashboardTabGroups() {
  const tabGroups = document.querySelectorAll('[data-dashboard-tab-group]');
  tabGroups.forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('[data-dashboard-tab]'));
    const panels = Array.from(group.querySelectorAll('[data-dashboard-panel]'));
    if (!tabs.length || !panels.length) {
      return;
    }

    const setActive = (value) => {
      tabs.forEach((tab) => {
        if (!tab) {
          return;
        }
        const isActive = tab.getAttribute('data-dashboard-tab') === value;
        tab.classList.toggle('tab-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      panels.forEach((panel) => {
        if (!panel) {
          return;
        }
        const matches = panel.getAttribute('data-dashboard-panel') === value;
        panel.classList.toggle('hidden', !matches);
        panel.setAttribute('aria-hidden', matches ? 'false' : 'true');
      });
    };

    const defaultTab = tabs.find((tab) => tab.classList.contains('tab-active')) || tabs[0];
    const defaultValue = defaultTab?.getAttribute('data-dashboard-tab');
    if (defaultValue) {
      setActive(defaultValue);
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const value = tab.getAttribute('data-dashboard-tab');
        if (value) {
          setActive(value);
        }
      });
    });
  });
}

window.addEventListener('DOMContentLoaded', initDashboardTabGroups);

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
    await loadDailyList();
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
  const wasTargetFocused = document.activeElement === target;
  const refocusCheckbox = () => {
    if (!wasTargetFocused) {
      return;
    }
    const nextCheckbox = dailyTasksContainer?.querySelector(`input[data-task-index="${index}"]`);
    if (nextCheckbox instanceof HTMLInputElement) {
      try {
        nextCheckbox.focus({ preventScroll: true });
      } catch {
        nextCheckbox.focus();
      }
    }
  };
  const previousState = currentDailyTasks.map((task) => ({ ...task }));
  const updatedTasks = previousState.map((task, taskIndex) =>
    taskIndex === index ? { ...task, completed: target.checked } : task
  );
  currentDailyTasks = updatedTasks;
  renderDailyTasks(updatedTasks);
  refocusCheckbox();
  try {
    await saveDailyTasks(updatedTasks);
  } catch (error) {
    console.error('Failed to update task completion state', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
    refocusCheckbox();
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
  try {
    await saveDailyTasks(remainingTasks);
  } catch (error) {
    console.error('Failed to clear completed tasks', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
  }
});

updateClearCompletedButtonState(currentDailyTasks);
loadDailyList();

function initDesktopNotes() {
  if (typeof document === 'undefined') {
    return;
  }

  const titleInput = document.getElementById('noteTitle');
  const bodyInput = document.getElementById('noteBody');
  const saveButton = document.getElementById('noteSaveBtn');
  const newButton = document.getElementById('noteNewBtn');
  const notesListElement = document.getElementById('notesList');
  const notesLayout = document.querySelector('[data-notes-layout]');
  const notesShelfToggleButtons = document.querySelectorAll('[data-notes-shelf-toggle]');

  if (!titleInput || !bodyInput || !saveButton || !newButton) {
    return;
  }

  let currentNoteId = null;

  const focusEditorField = () => {
    if (typeof titleInput.focus !== 'function') {
      return;
    }
    try {
      titleInput.focus({ preventScroll: true });
    } catch {
      titleInput.focus();
    }
  };

  const getNotesShelfState = () => {
    if (!notesLayout) {
      return 'expanded';
    }
    return notesLayout.dataset.notesShelfState === 'collapsed' ? 'collapsed' : 'expanded';
  };

  const syncNotesShelfControls = (state) => {
    const isCollapsed = state === 'collapsed';
    notesShelfToggleButtons.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      const variant = button.dataset.notesShelfToggleVariant;
      if (variant === 'primary') {
        button.textContent = isCollapsed ? 'Show saved notes' : 'Hide saved notes';
      } else if (variant === 'close') {
        button.textContent = isCollapsed ? 'Show' : 'Close';
      }
    });
  };

  const setNotesShelfState = (state) => {
    if (notesLayout) {
      notesLayout.dataset.notesShelfState = state === 'collapsed' ? 'collapsed' : 'expanded';
    }
    syncNotesShelfControls(getNotesShelfState());
  };

  const toggleNotesShelfState = () => {
    const nextState = getNotesShelfState() === 'collapsed' ? 'expanded' : 'collapsed';
    setNotesShelfState(nextState);
    if (nextState === 'collapsed') {
      focusEditorField();
    }
  };

  if (notesShelfToggleButtons.length) {
    notesShelfToggleButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        toggleNotesShelfState();
      });
    });
    setNotesShelfState(getNotesShelfState());
  }

  const setEditorValues = (note) => {
    if (!note) {
      currentNoteId = null;
      titleInput.value = '';
      bodyInput.value = '';
      return;
    }
    currentNoteId = note.id;
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
  };

  const updateListSelection = () => {
    if (!notesListElement) {
      return;
    }
    const buttons = notesListElement.querySelectorAll('button[data-note-id]');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const isActive = button.getAttribute('data-note-id') === currentNoteId;
      button.classList.toggle('bg-base-200/80', isActive);
      button.classList.toggle('border-base-300', !isActive);
      button.classList.toggle('border-primary', isActive);
      button.classList.toggle('font-medium', isActive);
      button.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  };

  const getSortedNotes = () => {
    const notes = loadAllNotes();
    if (!Array.isArray(notes)) {
      return [];
    }
    return [...notes].sort((a, b) => {
      const aTime = Date.parse(a?.updatedAt || '');
      const bTime = Date.parse(b?.updatedAt || '');
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
  };

  const handleDeleteNote = (noteId) => {
    if (!noteId) {
      return;
    }

    const existingNotes = loadAllNotes();
    if (!Array.isArray(existingNotes)) {
      return;
    }

    const filteredNotes = existingNotes.filter((note) => note.id !== noteId);
    if (filteredNotes.length === existingNotes.length) {
      return;
    }

    saveAllNotes(filteredNotes);

    if (currentNoteId === noteId) {
      currentNoteId = null;
    }

    const notes = renderNotesList();
    if (currentNoteId) {
      const activeNote = notes.find((note) => note.id === currentNoteId) || null;
      setEditorValues(activeNote);
    } else if (notes.length) {
      setEditorValues(notes[0]);
    } else {
      setEditorValues(null);
    }
    updateListSelection();
  };

  const renderNotesList = (notes = getSortedNotes()) => {
    if (!notesListElement) {
      return notes;
    }

    notesListElement.innerHTML = '';

    if (!notes.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'text-sm italic text-base-content/60';
      emptyItem.textContent = 'No saved notes yet.';
      notesListElement.appendChild(emptyItem);
      return notes;
    }

    notes.forEach((note) => {
      const listItem = document.createElement('li');
      listItem.className = 'flex items-center gap-2';
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.noteId = note.id;
      button.className =
        'w-full flex-1 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-left transition hover:bg-base-200 focus:outline-none focus-visible:ring focus-visible:ring-primary/60';
      button.textContent = note.title || 'Untitled note';
      button.addEventListener('click', () => {
        setEditorValues(note);
        updateListSelection();
        focusEditorField();
      });
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className =
        'btn btn-ghost btn-xs text-error focus-visible:ring focus-visible:ring-error/60';
      deleteButton.setAttribute('aria-label', `Delete note "${note.title || 'Untitled note'}"`);
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleDeleteNote(note.id);
      });
      listItem.appendChild(button);
      listItem.appendChild(deleteButton);
      notesListElement.appendChild(listItem);
    });

    updateListSelection();
    return notes;
  };

  const applyInitialSelection = () => {
    const notes = renderNotesList();
    if (!notes.length) {
      setEditorValues(null);
      updateListSelection();
      return;
    }
    const existing = currentNoteId ? notes.find((note) => note.id === currentNoteId) : null;
    setEditorValues(existing || notes[0]);
    updateListSelection();
  };

  saveButton.addEventListener('click', () => {
    const existingNotes = loadAllNotes();
    const notesArray = Array.isArray(existingNotes) ? [...existingNotes] : [];
    const title = typeof titleInput.value === 'string' ? titleInput.value.trim() : '';
    const body = typeof bodyInput.value === 'string' ? bodyInput.value : '';
    const sanitizedTitle = title || 'Untitled note';
    const timestamp = new Date().toISOString();

    if (currentNoteId) {
      const noteIndex = notesArray.findIndex((note) => note.id === currentNoteId);
      if (noteIndex >= 0) {
        notesArray[noteIndex] = {
          ...notesArray[noteIndex],
          title: sanitizedTitle,
          body,
          updatedAt: timestamp,
        };
      } else {
        const newNote = createNote(sanitizedTitle, body, { updatedAt: timestamp });
        currentNoteId = newNote.id;
        notesArray.unshift(newNote);
      }
    } else {
      const newNote = createNote(sanitizedTitle, body);
      currentNoteId = newNote.id;
      notesArray.unshift(newNote);
    }

    saveAllNotes(notesArray);

    const notes = renderNotesList();
    const activeNote = currentNoteId ? notes.find((note) => note.id === currentNoteId) : null;
    setEditorValues(activeNote || null);
    updateListSelection();
  });

  newButton.addEventListener('click', () => {
    currentNoteId = null;
    titleInput.value = '';
    bodyInput.value = '';
    updateListSelection();
    focusEditorField();
  });

  applyInitialSelection();
}

initDesktopNotes();

// Theme system: we persist DaisyUI theme names (light, dark, dracula, synthwave, cupcake, caramellatte, night, professional)
// in localStorage under `theme` and apply them via <html data-theme="…"> so CSS tokens update globally.
const THEME_STORAGE_KEY = 'theme';
const DEFAULT_THEME = 'professional';
const THEME_CHANGE_EVENT = 'memoryCue:theme-change';
const DESKTOP_THEME = 'professional';
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
  const isDesktopShell = typeof document !== 'undefined'
    && document.body instanceof HTMLElement
    && document.body.classList.contains('desktop-shell');

  if (isDesktopShell) {
    setTheme(DESKTOP_THEME, { persist: true, notify: true });
    return;
  }

  let storedTheme = '';
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Unable to load theme preference', error);
  }

  const fallbackTheme = storedTheme || document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
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
