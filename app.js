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
import { createDailyTasksManager } from './js/modules/daily-tasks.js';

// Planner structure:
// - app.js: planner UI rendering, lesson cards, templates, resources, week view toggle, and teacher notes panel.
// - js/modules/planner.js: planner data store, lesson normalisation, and persistence helpers.
// - index.html / docs/index.html: planner layout, modal markup, and toolbar controls.
// Planner updates:
// - Added lesson status, subject tags, templates, resources, teacher notes panel, week view, duplicate functionality, and timetable slotting.
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
const plannerLessonTimetableField = document.getElementById('planner-lesson-timetable');
const timetableForm = document.getElementById('timetable-form');
const timetableList = document.getElementById('timetable-list');
const timetableDayField = document.getElementById('timetable-day');
const timetablePeriodField = document.getElementById('timetable-period');
const timetableClassField = document.getElementById('timetable-class');
const timetableSubjectField = document.getElementById('timetable-subject');
const timetableSubmitButton = document.getElementById('timetable-submit');
const timetableResetButton = document.getElementById('timetable-reset');
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

function getTimetableEntryLabel(entry) {
  if (!entry) {
    return '';
  }
  const parts = [];
  const dayLabel = typeof entry.day === 'string' ? entry.day.trim() : '';
  const period = typeof entry.period === 'string' ? entry.period.trim() : '';
  const className = typeof entry.className === 'string' ? entry.className.trim() : '';
  if (dayLabel) {
    parts.push(dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1));
  }
  if (period) {
    parts.push(period);
  }
  if (className) {
    parts.push(className);
  }
  return parts.join(' – ');
}

function clampDayIndexValue(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 6) {
    return 6;
  }
  return value;
}

function getDayNameFromIndex(index) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const target = clampDayIndexValue(index);
  return names[target] || 'Monday';
}

function formatDayLabel(dayValue) {
  if (typeof dayValue !== 'string') {
    return 'Monday';
  }
  const trimmed = dayValue.trim();
  if (!trimmed) {
    return 'Monday';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function syncPlannerTimetableOptions(selectedId = '') {
  if (!(plannerLessonTimetableField instanceof HTMLSelectElement)) {
    return;
  }
  const options = ['<option value="">No timetable link</option>'];
  timetableEntries.forEach((entry) => {
    const label = getTimetableEntryLabel(entry) || 'Timetable slot';
    const selected = selectedId && entry.id === selectedId ? 'selected' : '';
    options.push(`<option value="${entry.id}" ${selected}>${escapeCueText(label)}</option>`);
  });
  plannerLessonTimetableField.innerHTML = options.join('');
  if (selectedId && plannerLessonTimetableField.value !== selectedId) {
    plannerLessonTimetableField.value = selectedId;
  }
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
    [dayField, periodField, titleField, summaryField, subjectField, statusField, plannerLessonTimetableField].forEach((field) => {
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
    syncPlannerTimetableOptions('');
    if (plannerLessonTimetableField instanceof HTMLSelectElement) {
      plannerLessonTimetableField.value = '';
    }
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

  const openAddLesson = ({ defaultDay = 'Monday', trigger, timetableEntry } = {}) => {
    state.mode = 'add';
    state.lessonId = null;
    resetForm();
    toggleSection(lessonSection, true);
    toggleSection(summarySection, true);
    toggleSection(detailSection, false);
    toggleSection(duplicateSection, false);
    setLessonFieldsDisabled(false);
    const resolvedDay =
      typeof timetableEntry?.day === 'string' && timetableEntry.day.trim()
        ? timetableEntry.day.charAt(0).toUpperCase() + timetableEntry.day.slice(1)
        : typeof defaultDay === 'string' && defaultDay.trim()
          ? defaultDay.trim()
          : 'Monday';
    setDayValue(resolvedDay);
    titleField.value =
      (timetableEntry?.className && timetableEntry.className.trim()) || (resolvedDay ? `${resolvedDay} lesson` : '');
    summaryField.value = '';
    if (periodField instanceof HTMLInputElement) {
      periodField.value = timetableEntry?.period || '';
    }
    if (subjectField instanceof HTMLInputElement) {
      subjectField.value = timetableEntry?.subject || '';
    }
    syncPlannerTimetableOptions(timetableEntry?.id || '');
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
    syncPlannerTimetableOptions(lesson.timetableEntryId || '');
    if (plannerLessonTimetableField instanceof HTMLSelectElement) {
      plannerLessonTimetableField.value = lesson.timetableEntryId || '';
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
      const timetableEntryId =
        plannerLessonTimetableField instanceof HTMLSelectElement ? plannerLessonTimetableField.value : '';
      const weekStartDate = (() => {
        const mondayDate = getWeekDateForDayIndex(activePlannerWeekId, 1);
        return mondayDate instanceof Date && !Number.isNaN(mondayDate.getTime())
          ? mondayDate.toISOString()
          : '';
      })();

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
          timetableEntryId,
          weekStartDate,
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
        timetableEntryId,
        weekStartDate,
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
let timetableEntries = getTimetableEntries();
let editingTimetableId = null;
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

function getWeekStartIsoString(weekId = activePlannerWeekId) {
  const mondayDate = getWeekDateForDayIndex(weekId, 1);
  if (mondayDate instanceof Date && !Number.isNaN(mondayDate.getTime())) {
    return mondayDate.toISOString();
  }
  return '';
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

function renderPlannerSlotCard(entry) {
  if (!entry) {
    return '';
  }
  const dayLabel = formatDayLabel(entry.day || 'Monday');
  const periodLabel = entry.period ? entry.period : 'Lesson';
  const subjectBadge = entry.subject
    ? `<span class="badge badge-ghost badge-xs">${escapeCueText(entry.subject)}</span>`
    : '';
  return `
    <article
      class="flex h-full flex-col justify-between rounded-2xl border border-dashed border-base-300/80 bg-base-100/70 px-4 py-4 text-left text-base-content shadow-sm"
      data-planner-slot="true"
      data-timetable-entry="${entry.id}"
    >
      <div class="space-y-2">
        <p class="label-text">${escapeCueText(dayLabel)} · ${escapeCueText(periodLabel)}</p>
        <p class="text-base font-semibold">${escapeCueText(entry.className || 'Timetable slot')}</p>
        ${entry.subject ? `<p class="text-xs text-base-content/70">${escapeCueText(entry.subject)}</p>` : ''}
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 pt-3">
        <div class="flex flex-wrap gap-2">${subjectBadge}</div>
        <button
          type="button"
          class="btn btn-primary btn-xs"
          data-planner-action="create-slot"
          data-timetable-entry-id="${entry.id}"
        >
          Plan lesson
        </button>
      </div>
    </article>
  `;
}

function buildPlannerSlotsForWeek(lessons = [], weekId = activePlannerWeekId) {
  const lessonList = Array.isArray(lessons) ? lessons : [];
  const usedLessonIds = new Set();
  const weekStartDate = getWeekStartIsoString(weekId);
  const slots = [];
  timetableEntries.forEach((entry) => {
    const linkedLesson = lessonList.find((lesson) => lesson.timetableEntryId === entry.id);
    const dayIndex = clampDayIndexValue(Number(entry.dayIndex));
    if (linkedLesson) {
      usedLessonIds.add(linkedLesson.id);
      slots.push({ type: 'lesson', entry, lesson: linkedLesson, dayIndex });
    } else {
      slots.push({ type: 'slot', entry, lesson: null, dayIndex, weekStartDate });
    }
  });
  lessonList.forEach((lesson) => {
    if (usedLessonIds.has(lesson.id)) {
      return;
    }
    const dayIndex = clampDayIndexValue(Number(lesson.dayIndex));
    slots.push({ type: 'lesson', entry: null, lesson, dayIndex, isLoose: true });
  });
  return slots.sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) {
      return a.dayIndex - b.dayIndex;
    }
    const periodA = a.entry?.period || a.lesson?.period || '';
    const periodB = b.entry?.period || b.lesson?.period || '';
    if (periodA && periodB && periodA !== periodB) {
      return periodA.localeCompare(periodB, undefined, { numeric: true, sensitivity: 'base' });
    }
    const classA = a.entry?.className || a.lesson?.title || '';
    const classB = b.entry?.className || b.lesson?.title || '';
    return classA.localeCompare(classB);
  });
}

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
  const plannerGrid = document.querySelector('.planner-grid');
  if (!plannerGrid) {
    return;
  }

  const lessons = Array.isArray(plan?.lessons) ? plan.lessons : [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];

  const lessonsByDay = days.map(day => ({
    day,
    lessons: lessons.filter(lesson => lesson.dayName === day)
  }));

  lessonsByDay.forEach(dayData => {
    const dayCard = plannerGrid.querySelector(`.day-card:nth-child(${days.indexOf(dayData.day) + 1})`);
    const dayContent = dayCard.querySelector('.day-content');

    if (dayData.lessons.length === 0) {
      dayContent.innerHTML = '<p class="text-sm text-base-content/60">No lessons planned for this day.</p>';
      return;
    }

    dayContent.innerHTML = dayData.lessons.map(lesson => `
      <div class="lesson-card">
        <p class="lesson-title">${lesson.title}</p>
        <div class="lesson-details">
          ${lesson.details.map(detail => `
            <div class="lesson-tag">
              <span class="tag-dot" style="background-color: ${detail.color || '#888'};"></span>
              <span>${detail.text}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-sm btn-outline add-detail-btn">Add detail</button>
      </div>
    `).join('');
  });
}

function renderPlannerWeekView(lessons = [], slots = null) {
  if (!plannerWeekViewContainer) {
    return;
  }
  const slotsToRender = Array.isArray(slots) ? slots : buildPlannerSlotsForWeek(lessons, activePlannerWeekId);
  const days = [
    { day: 'Monday', index: 1 },
    { day: 'Tuesday', index: 2 },
    { day: 'Wednesday', index: 3 },
    { day: 'Thursday', index: 4 },
    { day: 'Friday', index: 5 }
  ];
  const grouped = days.map((entry) => ({ ...entry, items: [] }));
  slotsToRender.forEach((slot) => {
    const dayIndex = clampDayIndexValue(Number(slot?.dayIndex));
    const target = grouped.find((entry) => entry.index === dayIndex);
    if (target) {
      target.items.push(slot);
    }
  });
  const markup = grouped
    .map(({ day, items }) => {
      const dayItems = items
        .map((item) => {
          if (item.type === 'slot' && item.entry) {
            const periodLabel = item.entry.period ? ` · ${escapeCueText(item.entry.period)}` : '';
            const subjectLabel = item.entry.subject
              ? `<span class="badge badge-ghost badge-xs">${escapeCueText(item.entry.subject)}</span>`
              : '';
            return `
              <div class="rounded-xl border border-dashed border-base-200 bg-base-100 px-3 py-2">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="text-xs font-semibold text-base-content/70">${escapeCueText(item.entry.className || 'Timetable slot')}</p>
                    <p class="text-xs text-base-content/60">${escapeCueText(formatDayLabel(item.entry.day || day) + periodLabel)}</p>
                  </div>
                  ${subjectLabel}
                </div>
                <div class="mt-2 flex flex-wrap justify-end">
                  <button class="btn btn-primary btn-ghost btn-xs" type="button" data-planner-action="create-slot" data-timetable-entry-id="${item.entry.id}">Plan lesson</button>
                </div>
              </div>
            `;
          }
          const lesson = item.lesson || item;
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
          <div class="space-y-2">${dayItems || fallback}</div>
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
    const lessons = currentPlannerPlan?.lessons || [];
    renderPlannerWeekView(lessons, buildPlannerSlotsForWeek(lessons, activePlannerWeekId));
  }
}

function resetTimetableFormFields() {
  if (timetableForm instanceof HTMLFormElement) {
    timetableForm.reset();
  }
  editingTimetableId = null;
  if (timetableDayField instanceof HTMLSelectElement) {
    timetableDayField.value = 'monday';
  }
  if (timetableSubmitButton instanceof HTMLElement) {
    timetableSubmitButton.textContent = 'Add to timetable';
  }
}

function renderTimetableEntries() {
  if (!timetableList) {
    return;
  }
  if (!timetableEntries.length) {
    timetableList.innerHTML = '<p class="text-sm text-base-content/70">No timetable entries yet. Add your classes to auto-create lesson slots.</p>';
    syncPlannerTimetableOptions('');
    return;
  }
  const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const grouped = dayOrder.map((day) => ({ day, entries: [] }));
  timetableEntries.forEach((entry) => {
    const target = grouped.find((group) => group.day === (entry.day || '').toLowerCase());
    if (target) {
      target.entries.push(entry);
    }
  });
  const markup = grouped
    .map(({ day, entries }) => {
      const dayLabel = formatDayLabel(day);
      const items = entries
        .map((entry) => {
          const subjectBadge = entry.subject
            ? `<span class="badge badge-ghost badge-xs">${escapeCueText(entry.subject)}</span>`
            : '';
          const periodLabel = entry.period ? `<span class="text-xs text-base-content/60">${escapeCueText(entry.period)}</span>` : '';
          return `
            <li class="flex items-center justify-between gap-2 rounded-xl border border-base-200 bg-base-100 px-3 py-2">
              <div>
                <p class="text-sm font-semibold text-base-content">${escapeCueText(entry.className)}</p>
                <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/70">
                  <span>${escapeCueText(dayLabel)}</span>
                  ${periodLabel}
                  ${subjectBadge}
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="btn btn-ghost btn-xs" data-timetable-action="edit" data-entry-id="${entry.id}">Edit</button>
                <button type="button" class="btn btn-ghost btn-xs text-error" data-timetable-action="delete" data-entry-id="${entry.id}">Delete</button>
              </div>
            </li>
          `;
        })
        .join('');
      const fallback = '<p class="text-xs text-base-content/60">No slots for this day yet.</p>';
      return `
        <div class="space-y-2 rounded-2xl border border-base-200 bg-base-200/60 p-3">
          <p class="text-xs font-semibold uppercase tracking-[0.25em] text-base-content/70">${dayLabel}</p>
          <ul class="space-y-2">${items || fallback}</ul>
        </div>
      `;
    })
    .join('');
  timetableList.innerHTML = markup;
  syncPlannerTimetableOptions(plannerLessonTimetableField instanceof HTMLSelectElement ? plannerLessonTimetableField.value : '');
}

async function handleTimetableSubmit(event) {
  event.preventDefault();
  if (!timetableDayField || !timetableClassField) {
    return;
  }
  const day = timetableDayField.value || 'monday';
  const period = timetablePeriodField?.value?.trim() || '';
  const className = timetableClassField.value?.trim();
  const subject = timetableSubjectField?.value?.trim() || '';
  if (!className) {
    return;
  }
  try {
    if (editingTimetableId) {
      timetableEntries = await updateTimetableEntry(editingTimetableId, { day, period, className, subject });
    } else {
      timetableEntries = await addTimetableEntry({ day, period, className, subject });
    }
    resetTimetableFormFields();
    renderTimetableEntries();
    renderPlannerLessons(currentPlannerPlan || { lessons: [] });
  } catch (error) {
    console.error('Unable to save timetable entry', error);
  }
}

function handleTimetableListClick(event) {
  const trigger = event.target instanceof Element ? event.target.closest('[data-timetable-action]') : null;
  if (!trigger) {
    return;
  }
  const action = trigger.getAttribute('data-timetable-action');
  const entryId = trigger.getAttribute('data-entry-id');
  if (!action || !entryId) {
    return;
  }
  if (action === 'edit') {
    const entry = timetableEntries.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }
    editingTimetableId = entry.id;
    if (timetableDayField instanceof HTMLSelectElement) {
      timetableDayField.value = entry.day || 'monday';
    }
    if (timetablePeriodField instanceof HTMLInputElement) {
      timetablePeriodField.value = entry.period || '';
    }
    if (timetableClassField instanceof HTMLInputElement) {
      timetableClassField.value = entry.className || '';
    }
    if (timetableSubjectField instanceof HTMLInputElement) {
      timetableSubjectField.value = entry.subject || '';
    }
    if (timetableSubmitButton instanceof HTMLElement) {
      timetableSubmitButton.textContent = 'Update slot';
    }
    return;
  }
  if (action === 'delete') {
    const shouldDelete = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Remove this timetable slot?')
      : true;
    if (!shouldDelete) {
      return;
    }
    deleteTimetableEntry(entryId)
      .then((entries) => {
        timetableEntries = entries;
        renderTimetableEntries();
        renderPlannerLessons(currentPlannerPlan || { lessons: [] });
      })
      .catch((error) => {
        console.error('Unable to delete timetable entry', error);
      });
  }
}

function initTimetableView() {
  if (timetableForm instanceof HTMLFormElement) {
    timetableForm.addEventListener('submit', handleTimetableSubmit);
  }
  if (timetableResetButton instanceof HTMLElement) {
    timetableResetButton.addEventListener('click', (event) => {
      event.preventDefault();
      resetTimetableFormFields();
    });
  }
  if (timetableList) {
    timetableList.addEventListener('click', handleTimetableListClick);
  }
  renderTimetableEntries();
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
  if (notesValue && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const proceed = window.confirm('Add this template to the existing notes?');
    if (!proceed) {
      return;
    }
  }
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

async function handlePlannerCreateSlot(entryId, trigger) {
  if (!entryId || !activePlannerWeekId) {
    return;
  }
  const entry = timetableEntries.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }
  const triggerElement = trigger instanceof HTMLElement ? trigger : null;
  if (triggerElement) {
    triggerElement.setAttribute('disabled', 'true');
  }
  try {
    const weekStartDate = getWeekStartIsoString(activePlannerWeekId);
    const plan = await addLessonToWeek(activePlannerWeekId, {
      dayIndex: clampDayIndexValue(Number(entry.dayIndex)),
      dayName: formatDayLabel(entry.day),
      title: entry.className || formatDayLabel(entry.day || 'Monday'),
      summary: '',
      subject: entry.subject || '',
      period: entry.period || '',
      status: 'not_started',
      timetableEntryId: entry.id,
      weekStartDate
    });
    if (plan) {
      currentPlannerPlan = plan;
      const newLesson = plan.lessons?.find(
        (lesson) => lesson.timetableEntryId === entry.id && (!lesson.weekStartDate || lesson.weekStartDate === weekStartDate)
      );
      selectedPlannerLessonId = newLesson?.id || selectedPlannerLessonId;
      renderPlannerLessons(plan);
      updatePlannerDashboardSummary(plan, activePlannerWeekId);
    }
  } catch (error) {
    console.error('Failed to create lesson from timetable slot', error);
  } finally {
    if (triggerElement) {
      triggerElement.removeAttribute('disabled');
    }
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
    case 'create-slot': {
      const entryId = trigger.getAttribute('data-timetable-entry-id');
      await handlePlannerCreateSlot(entryId, trigger);
      break;
    }
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

const dailyTasksManager = createDailyTasksManager({
  dailyTab,
  dailyView: dailyListView,
  dailyListHeader,
  quickAddForm,
  quickAddInput,
  quickAddVoiceButton,
  dailyTasksContainer,
  clearCompletedButton,
  dailyListPermissionNotice,
  cuesTab,
  cuesView,
  ensureCueFirestore: () => ensureCueFirestore()
});

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
