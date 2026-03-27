import {
  createLessonCueFromNote,
  getActiveLessonNote,
  getLessonCueFields,
  getTeacherLessonContext,
  isActiveLessonNoteId,
  setActiveLessonNoteId,
} from '../services/teacherModeService.js';

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const NOTEBOOK_POLISH_STYLE_ID = 'memory-cue-notebook-polish';
const NOTEBOOK_POLISH_CSS = `
  #view-notebook #notesOverviewPanel {
    padding: 0.8rem;
    margin: 0.6rem 0.75rem 0.75rem;
    border-radius: 1.1rem;
    background: color-mix(in srgb, #ffffff 95%, #f3eefc 5%);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
  }

  #view-notebook #notesOverviewPanel > h2 {
    margin: 0;
    font-size: 0.98rem;
    letter-spacing: 0.01em;
  }

  #view-notebook #notesOverviewList {
    gap: 0.5rem;
  }

  #view-notebook [data-active-lesson-card] {
    margin-top: 0.55rem;
    margin-bottom: 0.4rem;
    border-radius: 1rem;
    background: color-mix(in srgb, #ffffff 96%, #efe8fb 4%);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
  }

  .mobile-panel--notes .scratch-notes-header-block {
    gap: 0.5rem;
    padding: 0.7rem 0.8rem 0.75rem;
    background: color-mix(in srgb, #ffffff 95%, #f2ecff 5%);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
  }

  .mobile-panel--notes .note-editor-actions-row {
    gap: 0.45rem;
  }

  #view-notebook .note-inline-action {
    min-height: 32px;
    padding: 0.42rem 0.78rem;
    font-size: 0.78rem;
    background: color-mix(in srgb, #ffffff 96%, #efe8fb 4%);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] > div {
    border-color: color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #efe8fb 3%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action {
    min-height: 30px;
    padding: 0.35rem 0.72rem;
    font-size: 0.76rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #512663) 14%, #ffffff 86%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #512663) 30%, transparent);
    color: var(--text-main, #231B2E);
    font-weight: 600;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] p {
    margin: 0;
  }

  .mobile-panel--notes .lesson-cue-note {
    display: grid;
    gap: 0.72rem;
    padding: 0.15rem 0;
  }

  .mobile-panel--notes .lesson-cue-block {
    padding: 0.78rem 0.9rem;
    border-radius: 0.95rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 68%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f3eefc 3%);
    box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
  }

  .mobile-panel--notes .lesson-cue-label {
    margin: 0 0 0.28rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text-main, #231B2E) 62%, #7c8798 38%);
  }

  .mobile-panel--notes .lesson-cue-value {
    margin: 0;
    font-size: 1rem;
    line-height: 1.45;
    color: var(--text-main, #231B2E);
  }

  .mobile-panel--notes #scratch-notes-card .note-actions.fixed-bottom {
    gap: 0.6rem;
    padding: 0.52rem 0.6rem;
    background: color-mix(in srgb, #ffffff 94%, #f3eefc 6%);
    box-shadow: 0 10px 24px rgba(17, 17, 26, 0.1);
  }

  #view-notebook #relatedNotesPanel {
    margin: 0.35rem 0 0.1rem;
    padding-top: 0.85rem;
    border-top: 1px solid color-mix(in srgb, var(--card-border, #d8dce6) 72%, transparent);
  }

  #view-notebook #relatedNotesPanel h3 {
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--text-main, #231B2E) 82%, #7c8798 18%);
  }

  #view-notebook #relatedNotesList {
    display: grid;
    gap: 0.38rem;
  }

  #savedNotesSheet .saved-notes-panel {
    background: color-mix(in srgb, #ffffff 97%, #f4f0fb 3%);
    box-shadow: -10px 0 28px rgba(15, 23, 42, 0.18);
  }

  #savedNotesSheet .saved-notes-header {
    gap: 0.55rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid color-mix(in srgb, var(--card-border, #d8dce6) 70%, transparent);
  }

  #savedNotesSheet .saved-notes-list-shell {
    padding-top: 0.15rem;
  }

  #savedNotesSheet .saved-notes-list {
    gap: 0.2rem;
  }

  #savedNotesSheet .note-item-mobile {
    border-bottom-color: color-mix(in srgb, var(--text-secondary, #cbd5e1) 18%, transparent);
  }

  #savedNotesSheet .note-list-item {
    border-radius: 0.95rem;
    margin: 0.12rem 0;
    padding: 0.15rem 0.1rem;
    transition: background-color 0.18s ease, box-shadow 0.18s ease;
  }

  #savedNotesSheet .note-list-item:hover,
  #savedNotesSheet .note-list-item:focus-within {
    background: color-mix(in srgb, #ffffff 88%, #efe8fb 12%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--card-border, #d8dce6) 54%, transparent);
  }

  #savedNotesSheet .note-card-title {
    font-size: 0.92rem;
    line-height: 1.35;
    font-weight: 600;
  }

  #savedNotesSheet .note-card-meta {
    gap: 0.38rem;
    margin-top: 0.2rem;
  }

  #savedNotesSheet .note-card-action {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    color: color-mix(in srgb, var(--text-main, #231B2E) 62%, #7c8798 38%);
  }

  #savedNotesSheet .note-card-action:hover,
  #savedNotesSheet .note-card-action:focus-visible {
    background: color-mix(in srgb, var(--accent-color, #512663) 10%, #ffffff 90%);
    color: var(--text-main, #231B2E);
  }

  body[data-active-view="notebooks"] .note-editor-card {
    padding-bottom: 12px !important;
  }
`;

export const initMobileNotesShellUi = (options = {}) => {
  if (typeof document === 'undefined') {
    return {
      applyNotesMode: () => {},
      isSavedNotesSheetOpen: () => false,
      showSavedNotesSheet: () => {},
      hideSavedNotesSheet: () => {},
      openNoteOptionsMenu: () => {},
      closeNoteOptionsMenu: () => {},
      openFolderSelectorForNote: () => {},
      closeMoveFolderSheet: () => {},
      closeNoteFolderSheet: () => {},
    };
  }

  const {
    noteEditorSheet = null,
    notesOverviewPanel = null,
    savedNotesSheet = null,
    openSavedNotesButton = null,
    closeSavedNotesButton = null,
    folderSelectorEl = null,
    folderSelectorListEl = null,
    folderSelectorBackdrop = null,
    noteFolderSheet = null,
    noteFolderSheetBackdrop = null,
    noteFolderSheetList = null,
    noteFolderSheetClose = null,
    noteFolderButton = null,
    noteOptionsOverlay = null,
    noteOptionsSheet = null,
    noteActionCreateLessonCueBtn: initialNoteActionCreateLessonBtn = null,
    noteActionSetActiveLessonBtn: initialNoteActionSetActiveLessonBtn = null,
    noteActionMoveBtn = null,
    noteActionTogglePinBtn = null,
    noteActionDeleteBtn = null,
    getAllNotes = () => [],
    renderFilteredNotes = () => {},
    getCurrentEditingNoteFolderId = () => 'unsorted',
    setCurrentEditingNoteFolderId = () => {},
    getCurrentNoteId = () => null,
    getCurrentFolderMoveNoteId = () => null,
    setCurrentFolderMoveNoteId = () => {},
    getCurrentMoveFolderSheetNoteId = () => null,
    setCurrentMoveFolderSheetNoteId = () => {},
    getFolderSelectorOnSelect = () => null,
    setFolderSelectorOnSelect = () => {},
    getActiveFolderSheetOpener = () => null,
    setActiveFolderSheetOpener = () => {},
    setAfterFolderCreated = () => {},
    getFolderOptions = () => [],
    getFolderNameById = () => 'Unsorted',
    handleMoveNoteToFolder = () => {},
    openNewFolderDialog = () => {},
    closeOverflowMenu = () => {},
    handleDeleteNote = () => {},
    refreshFromStorage = () => {},
    saveAllNotes = () => {},
    onOpenNoteOptionsMove = null,
    onOpenNoteFromDashboard = null,
  } = options;

  let notesMode = 'notebooks';
  let savedNotesSheetHideTimeout = null;
  let savedNotesSheetFocusRestoreEl = null;
  let currentNoteOptionsNoteId = null;
  let currentNoteOptionsFocusRestoreEl = null;
  let noteActionCreateLessonCueBtn = initialNoteActionCreateLessonBtn;
  let noteActionSetActiveLessonBtn = initialNoteActionSetActiveLessonBtn;

  const ensureNotebookPolishStyles = () => {
    if (!(document.head instanceof HTMLElement)) {
      return;
    }
    const existingStyle = document.getElementById(NOTEBOOK_POLISH_STYLE_ID);
    if (existingStyle instanceof HTMLStyleElement) {
      return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = NOTEBOOK_POLISH_STYLE_ID;
    styleEl.textContent = NOTEBOOK_POLISH_CSS;
    document.head.appendChild(styleEl);
  };

  ensureNotebookPolishStyles();

  const ensureSheetActionButton = (button, className, label, insertAfterSelector = null) => {
    if (button instanceof HTMLButtonElement) {
      return button;
    }
    const actionsEl = noteOptionsSheet?.querySelector('.note-options-actions');
    if (!(actionsEl instanceof HTMLElement)) {
      return null;
    }
    const existingButton = actionsEl.querySelector(`.${className}`);
    if (existingButton instanceof HTMLButtonElement) {
      return existingButton;
    }
    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = `note-action-btn ${className}`;
    nextButton.textContent = label;
    const insertAfterEl = insertAfterSelector ? actionsEl.querySelector(insertAfterSelector) : null;
    if (insertAfterEl?.nextSibling) {
      actionsEl.insertBefore(nextButton, insertAfterEl.nextSibling);
    } else {
      actionsEl.appendChild(nextButton);
    }
    return nextButton;
  };

  noteActionCreateLessonCueBtn = ensureSheetActionButton(
    noteActionCreateLessonCueBtn,
    'note-action-create-lesson-cue',
    'Create Lesson Cue',
    '.note-action-toggle-pin',
  );
  noteActionSetActiveLessonBtn = ensureSheetActionButton(
    noteActionSetActiveLessonBtn,
    'note-action-set-active-lesson',
    'Use as Active Lesson',
    '.note-action-create-lesson-cue',
  );

  const ensureTeacherModeEditorBar = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }

    const existingBar = headerBlock.querySelector('[data-teacher-mode-editor-bar]');
    if (existingBar instanceof HTMLElement) {
      return existingBar;
    }

    const bar = document.createElement('div');
    bar.dataset.teacherModeEditorBar = 'true';
    bar.className = 'note-editor-actions-row';
    headerBlock.appendChild(bar);
    return bar;
  };

  const renderTeacherModeEditorBar = () => {
    const bar = ensureTeacherModeEditorBar();
    if (!(bar instanceof HTMLElement)) {
      return;
    }

    const currentNoteId = getCurrentNoteId();
    const currentNote = currentNoteId
      ? getAllNotes().find((note) => note?.id === currentNoteId) || null
      : null;
    const lessonContext = currentNote ? getTeacherLessonContext(currentNote, getAllNotes()) : null;
    const hasCurrentNote = Boolean(currentNote);
    const sourceNoteId = lessonContext?.sourceNoteId || null;
    const cueNoteId = lessonContext?.cueNoteId || null;
    const canShowPlanToggle = Boolean(sourceNoteId && (lessonContext?.isCueNote || lessonContext?.hasLessonPair));
    const canShowCueToggle = Boolean(cueNoteId || sourceNoteId);
    const cueLabel = cueNoteId ? 'Refresh Cue' : 'Create Cue';
    const activeLessonTargetId = cueNoteId || sourceNoteId || currentNoteId || '';
    const activeLessonLabel = activeLessonTargetId && isActiveLessonNoteId(activeLessonTargetId)
      ? 'Active Lesson'
      : 'Set Active Lesson';
    const helperText = !hasCurrentNote
      ? 'Save this note first, then use teacher tools here.'
      : cueNoteId
        ? 'Switch between the full lesson plan and the cue without leaving this editor.'
        : 'Create a cue once, then switch between your lesson plan and cue here.';

    bar.innerHTML = `
      <div class="w-full rounded-xl border border-base-300 bg-base-100/80 px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-[0.65rem] font-semibold uppercase tracking-[0.18em] opacity-60">Teaching tools</p>
            <p class="text-xs mt-1 opacity-75">${escapeHtml(helperText)}</p>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              class="note-inline-action"
              data-teacher-mode-action="cue"
              ${hasCurrentNote ? `data-note-id="${escapeHtml(currentNote.id || '')}"` : 'disabled'}
            >${escapeHtml(cueLabel)}</button>
            <button
              type="button"
              class="note-inline-action"
              data-teacher-mode-action="active"
              ${activeLessonTargetId ? `data-note-id="${escapeHtml(activeLessonTargetId)}"` : 'disabled'}
            >${escapeHtml(activeLessonLabel)}</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            class="note-inline-action"
            data-teacher-mode-action="lesson-plan"
            ${canShowPlanToggle ? `data-note-id="${escapeHtml(sourceNoteId || '')}"` : 'disabled'}
            ${currentNoteId && currentNoteId === sourceNoteId ? 'data-selected="true"' : 'data-selected="false"'}
          >Lesson Plan</button>
          <button
            type="button"
            class="note-inline-action"
            data-teacher-mode-action="lesson-cue"
            ${canShowCueToggle ? `data-note-id="${escapeHtml(cueNoteId || sourceNoteId || '')}"` : 'disabled'}
            ${cueNoteId ? '' : 'data-generate-cue="true"'}
            ${currentNoteId && cueNoteId && currentNoteId === cueNoteId ? 'data-selected="true"' : 'data-selected="false"'}
          >Lesson Cue</button>
        </div>
      </div>
    `;
  };

  const handleTeacherModeEditorAction = async (event) => {
    const actionButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-teacher-mode-action]')
      : null;
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();

    const noteId = actionButton.dataset.noteId || '';
    if (!noteId) {
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'cue') {
      const cueNote = await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
      if (cueNote?.id && typeof onOpenNoteFromDashboard === 'function') {
        onOpenNoteFromDashboard(cueNote.id, { isSavedNotesSheetOpen, hideSavedNotesSheet });
      }
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'active') {
      setActiveLessonNoteId(noteId);
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'lesson-cue'
      && actionButton.dataset.generateCue === 'true') {
      const cueNote = await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
      if (cueNote?.id && typeof onOpenNoteFromDashboard === 'function') {
        onOpenNoteFromDashboard(cueNote.id, { isSavedNotesSheetOpen, hideSavedNotesSheet });
      }
      return;
    }

    if ((actionButton.dataset.teacherModeAction === 'lesson-plan' || actionButton.dataset.teacherModeAction === 'lesson-cue')
      && noteId
      && typeof onOpenNoteFromDashboard === 'function') {
      onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
    }
  };

  ensureTeacherModeEditorBar()?.addEventListener('click', (event) => {
    void handleTeacherModeEditorAction(event);
  });

  const ensureActiveLessonCard = () => {
    if (!(notesOverviewPanel instanceof HTMLElement)) {
      return null;
    }

    const existingCard = notesOverviewPanel.querySelector('[data-active-lesson-card]');
    if (existingCard instanceof HTMLElement) {
      return existingCard;
    }

    const card = document.createElement('section');
    card.dataset.activeLessonCard = 'true';
    card.className = 'memory-glass-card-soft p-3 mt-2 mb-2 hidden';
    card.setAttribute('aria-hidden', 'true');
    const notesOverviewListEl = notesOverviewPanel.querySelector('#notesOverviewList');
    if (notesOverviewListEl instanceof HTMLElement) {
      notesOverviewPanel.insertBefore(card, notesOverviewListEl);
    } else {
      notesOverviewPanel.appendChild(card);
    }
    return card;
  };

  const renderActiveLessonCard = () => {
    const card = ensureActiveLessonCard();
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const activeLessonNote = getActiveLessonNote(getAllNotes());
    if (!activeLessonNote) {
      card.classList.add('hidden');
      card.setAttribute('aria-hidden', 'true');
      card.innerHTML = '';
      return;
    }

    const cueFields = getLessonCueFields(activeLessonNote);
    const previewRows = [
      ['Goal', cueFields.Goal],
      ['Say', cueFields.Say],
      ['Next', cueFields.Next],
    ].filter(([, value]) => typeof value === 'string' && value.trim());
    const noteType = activeLessonNote?.metadata?.noteType === 'lesson-cue' ? 'Lesson Cue' : 'Lesson Note';
    const safeTitle = escapeHtml(activeLessonNote?.title || 'Active lesson');
    const safeType = escapeHtml(noteType);
    const rowsMarkup = previewRows.length
      ? previewRows.map(([label, value]) => (
        `<div class="space-y-1">
          <p class="text-[0.65rem] font-semibold uppercase tracking-[0.18em] opacity-60">${escapeHtml(label)}</p>
          <p class="text-sm leading-5">${escapeHtml(value)}</p>
        </div>`
      )).join('')
      : `<p class="text-sm leading-5">${escapeHtml(activeLessonNote?.bodyText || activeLessonNote?.body || '')}</p>`;

    card.classList.remove('hidden');
    card.setAttribute('aria-hidden', 'false');
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[0.65rem] font-semibold uppercase tracking-[0.2em] opacity-60">Active Lesson</p>
          <h3 class="text-sm font-semibold leading-5 mt-1">${safeTitle}</h3>
          <p class="text-xs opacity-70 mt-1">${safeType}</p>
        </div>
        <button type="button" class="btn btn-xs btn-ghost" data-active-lesson-action="clear">Clear</button>
      </div>
      <div class="space-y-3 mt-3">
        ${rowsMarkup}
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-active-lesson-action="open"
          data-note-id="${escapeHtml(activeLessonNote.id || '')}"
        >Open Lesson</button>
      </div>
    `;
  };

  const handleActiveLessonCardClick = (event) => {
    const actionButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-active-lesson-action]')
      : null;
    if (!(actionButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();

    if (actionButton.dataset.activeLessonAction === 'clear') {
      setActiveLessonNoteId(null);
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.activeLessonAction === 'open' && typeof onOpenNoteFromDashboard === 'function') {
      const noteId = actionButton.dataset.noteId || '';
      if (noteId) {
        onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
      }
    }
  };

  ensureActiveLessonCard()?.addEventListener('click', handleActiveLessonCardClick);

  const isVisibleFocusableElement = (element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('disabled')) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };

  const focusVisibleElement = (element) => {
    if (!isVisibleFocusableElement(element) || typeof element.focus !== 'function') {
      return false;
    }
    try {
      element.focus({ preventScroll: true });
      return true;
    } catch {
      try {
        element.focus();
        return true;
      } catch {
        return false;
      }
    }
  };

  const applyNotesMode = (mode = 'notebooks') => {
    notesMode = mode === 'overview' ? 'overview' : 'notebooks';
    if (notesOverviewPanel instanceof HTMLElement) {
      notesOverviewPanel.classList.toggle('hidden', notesMode !== 'overview');
    }
    if (noteEditorSheet instanceof HTMLElement) {
      noteEditorSheet.classList.toggle('hidden', notesMode === 'overview');
    }
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
  };

  const isSavedNotesSheetOpen = () => savedNotesSheet?.dataset.open === 'true';

  const showSavedNotesSheet = () => {
    if (!savedNotesSheet) {
      return;
    }
    savedNotesSheetFocusRestoreEl =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : openSavedNotesButton;
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
      savedNotesSheetHideTimeout = null;
    }
    savedNotesSheet.classList.remove('hidden');
    savedNotesSheet.dataset.open = 'true';
    savedNotesSheet.removeAttribute('inert');
    savedNotesSheet.setAttribute('aria-hidden', 'false');
    document.body.dataset.savedNotesOpen = 'true';
    document.documentElement.dataset.savedNotesOpen = 'true';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    try {
      renderFilteredNotes();
    } catch {
      /* ignore */
    }
  };

  const hideSavedNotesSheet = ({ focusTarget = null } = {}) => {
    if (!savedNotesSheet) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && savedNotesSheet.contains(activeElement)) {
      const safeFocusTarget = [
        focusTarget,
        savedNotesSheetFocusRestoreEl,
        openSavedNotesButton,
      ].find((candidate) => isVisibleFocusableElement(candidate));

      if (safeFocusTarget) {
        focusVisibleElement(safeFocusTarget);
      }

      if (document.activeElement instanceof HTMLElement && savedNotesSheet.contains(document.activeElement)) {
        if (typeof activeElement.blur === 'function') {
          try {
            activeElement.blur();
          } catch {
            /* ignore */
          }
        }
        if (safeFocusTarget) {
          focusVisibleElement(safeFocusTarget);
        }
      }

      if (
        document.activeElement instanceof HTMLElement
        && savedNotesSheet.contains(document.activeElement)
        && document.body instanceof HTMLElement
      ) {
        const hadTabIndex = document.body.hasAttribute('tabindex');
        if (!hadTabIndex) {
          document.body.setAttribute('tabindex', '-1');
        }
        focusVisibleElement(document.body);
        if (!hadTabIndex) {
          document.body.removeAttribute('tabindex');
        }
      }

      if (document.activeElement instanceof HTMLElement && savedNotesSheet.contains(document.activeElement)) {
        activeElement.blur();
      }
    }
    savedNotesSheet.dataset.open = 'false';
    savedNotesSheet.setAttribute('inert', '');
    savedNotesSheet.setAttribute('aria-hidden', 'true');
    delete document.body.dataset.savedNotesOpen;
    delete document.documentElement.dataset.savedNotesOpen;
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
    }
    savedNotesSheetHideTimeout = setTimeout(() => {
      savedNotesSheet?.classList.add('hidden');
    }, 200);
  };

  if (savedNotesSheet) {
    openSavedNotesButton?.addEventListener('click', (event) => {
      event.preventDefault();
      showSavedNotesSheet();
      const notesListMobileEl = document.getElementById('notesListMobile');
      if (notesListMobileEl) {
        notesListMobileEl.scrollTop = 0;
      }
    });
    closeSavedNotesButton?.addEventListener('click', (event) => {
      event.preventDefault();
      hideSavedNotesSheet({ focusTarget: openSavedNotesButton });
    });
    savedNotesSheet.addEventListener('click', (event) => {
      if (event.target === savedNotesSheet) {
        hideSavedNotesSheet();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isSavedNotesSheetOpen()) {
        hideSavedNotesSheet();
      }
    });
  }

  const isNoteOptionsOpen = () => noteOptionsSheet && noteOptionsSheet.classList.contains('open');

  const closeNoteOptionsMenu = ({ focusTarget = null } = {}) => {
    const activeElement = document.activeElement;
    const preferredFocusTarget =
      focusTarget instanceof HTMLElement && noteOptionsSheet?.contains(focusTarget)
        ? null
        : focusTarget;
    const restoreTarget = [
      preferredFocusTarget,
      currentNoteOptionsFocusRestoreEl,
      openSavedNotesButton,
      document.body,
    ].find((candidate) => isVisibleFocusableElement(candidate));

    if (activeElement instanceof HTMLElement && noteOptionsSheet?.contains(activeElement)) {
      if (restoreTarget) {
        focusVisibleElement(restoreTarget);
      }

      if (
        document.activeElement instanceof HTMLElement
        && noteOptionsSheet.contains(document.activeElement)
        && typeof activeElement.blur === 'function'
      ) {
        try {
          activeElement.blur();
        } catch {
          /* ignore */
        }
      }
    }

    currentNoteOptionsNoteId = null;
    currentNoteOptionsFocusRestoreEl = null;
    if (noteOptionsSheet) {
      noteOptionsSheet.classList.remove('open');
      noteOptionsSheet.setAttribute('inert', '');
      noteOptionsSheet.setAttribute('aria-hidden', 'true');
      noteOptionsSheet.removeAttribute('data-note-id');
    }
    if (noteOptionsOverlay) {
      noteOptionsOverlay.classList.remove('open');
      noteOptionsOverlay.setAttribute('inert', '');
      noteOptionsOverlay.setAttribute('aria-hidden', 'true');
    }
  };

  const handleNoteOptionsKeydown = (event) => {
    if (event.key === 'Escape' && isNoteOptionsOpen()) {
      event.preventDefault();
      closeNoteOptionsMenu();
    }
  };

  const openNoteOptionsMenu = (noteId, triggerEl = null) => {
    if (!noteId || !noteOptionsSheet || !noteOptionsOverlay) {
      return;
    }
    closeNoteOptionsMenu();
    closeOverflowMenu();
    currentNoteOptionsNoteId = noteId;
    currentNoteOptionsFocusRestoreEl =
      isVisibleFocusableElement(triggerEl) ? triggerEl : document.activeElement;
    const note = getAllNotes().find((item) => item.id === noteId);
    if (noteActionTogglePinBtn) {
      const isPinned = Boolean(note?.pinned);
      noteActionTogglePinBtn.textContent = isPinned ? 'Unpin' : 'Pin';
    }
    if (noteActionCreateLessonCueBtn) {
      const noteType = typeof note?.metadata?.noteType === 'string' ? note.metadata.noteType : '';
      noteActionCreateLessonCueBtn.textContent = noteType === 'lesson-cue' ? 'Refresh Lesson Cue' : 'Create Lesson Cue';
    }
    if (noteActionSetActiveLessonBtn) {
      noteActionSetActiveLessonBtn.textContent = isActiveLessonNoteId(noteId) ? 'Active Lesson' : 'Use as Active Lesson';
    }
    noteOptionsSheet.removeAttribute('inert');
    noteOptionsSheet.classList.add('open');
    noteOptionsSheet.setAttribute('aria-hidden', 'false');
    noteOptionsSheet.setAttribute('data-note-id', noteId);
    noteOptionsOverlay.removeAttribute('inert');
    noteOptionsOverlay.classList.add('open');
    noteOptionsOverlay.setAttribute('aria-hidden', 'false');
  };

  if (noteOptionsOverlay) {
    noteOptionsOverlay.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteActionMoveBtn) {
    noteActionMoveBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      const note = getAllNotes().find((item) => item.id === noteId);
      closeNoteOptionsMenu();
      if (!noteId) return;
      if (typeof onOpenNoteOptionsMove === 'function') {
        onOpenNoteOptionsMove(noteId, note, noteActionMoveBtn);
      }
    });
  }

  if (noteOptionsSheet && noteActionCreateLessonCueBtn) {
    noteActionCreateLessonCueBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      closeNoteOptionsMenu();
      if (!noteId) {
        return;
      }
      await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
    });
  }

  if (noteOptionsSheet && noteActionSetActiveLessonBtn) {
    noteActionSetActiveLessonBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      const noteId = currentNoteOptionsNoteId;
      closeNoteOptionsMenu();
      if (!noteId) {
        return;
      }
      setActiveLessonNoteId(noteId);
      refreshFromStorage({ preserveDraft: true });
    });
  }

  if (noteOptionsSheet && noteActionTogglePinBtn) {
    noteActionTogglePinBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (!currentNoteOptionsNoteId) {
        return;
      }
      const existingNotes = getAllNotes();
      let changed = false;
      const updatedNotes = (Array.isArray(existingNotes) ? existingNotes : []).map((note) => {
        if (note && note.id === currentNoteOptionsNoteId) {
          changed = true;
          const nextPinned = !Boolean(note.pinned);
          return { ...note, pinned: nextPinned, updatedAt: new Date().toISOString() };
        }
        return note;
      });
      if (changed) {
        saveAllNotes(updatedNotes);
        refreshFromStorage({ preserveDraft: true });
      }
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteActionDeleteBtn) {
    noteActionDeleteBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (currentNoteOptionsNoteId) {
        handleDeleteNote(currentNoteOptionsNoteId);
      }
      closeNoteOptionsMenu();
    });
  }

  if (noteOptionsSheet && noteOptionsOverlay) {
    document.addEventListener('keydown', handleNoteOptionsKeydown);
  }

  const closeNoteFolderSheet = () => {
    if (noteFolderSheet) {
      noteFolderSheet.classList.remove('open');
      noteFolderSheet.setAttribute('aria-hidden', 'true');
    }
    if (noteFolderSheetBackdrop) {
      noteFolderSheetBackdrop.classList.remove('open');
      noteFolderSheetBackdrop.setAttribute('aria-hidden', 'true');
    }
    setCurrentMoveFolderSheetNoteId(null);
    document.removeEventListener('keydown', handleNoteFolderSheetKeydown);
    if (noteFolderSheetList) {
      noteFolderSheetList.innerHTML = '';
    }
  };

  const handleNoteFolderSelection = (folderId) => {
    const targetNoteId = getCurrentMoveFolderSheetNoteId() || getCurrentNoteId();
    if (targetNoteId) {
      handleMoveNoteToFolder(targetNoteId, folderId || 'unsorted');
    }
    closeNoteFolderSheet();
  };

  const handleCreateNewFolderFromSheet = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const targetNoteId = getCurrentMoveFolderSheetNoteId() || getCurrentNoteId();
    setAfterFolderCreated((createdId) => {
      if (targetNoteId) {
        handleMoveNoteToFolder(targetNoteId, createdId || 'unsorted');
      }
      closeNoteFolderSheet();
    });
    openNewFolderDialog();
  };

  const handleNoteFolderSheetKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNoteFolderSheet();
    }
  };

  if (noteFolderSheetList) {
    noteFolderSheetList.addEventListener('click', (event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest('.note-folder-row') : null;
      if (!row || !noteFolderSheetList.contains(row)) return;
      if (row.classList.contains('note-folder-row-new')) {
        handleCreateNewFolderFromSheet(event);
        return;
      }
      event.preventDefault();
      handleNoteFolderSelection(row.dataset.folderId || 'unsorted');
    });

    noteFolderSheetList.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target instanceof HTMLElement ? event.target.closest('.note-folder-row') : null;
      if (!row || !noteFolderSheetList.contains(row)) return;
      if (row.classList.contains('note-folder-row-new')) {
        handleCreateNewFolderFromSheet(event);
        return;
      }
      event.preventDefault();
      handleNoteFolderSelection(row.dataset.folderId || 'unsorted');
    });
  }

  if (noteFolderSheetClose) {
    noteFolderSheetClose.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteFolderSheet();
    });
  }

  if (noteFolderSheetBackdrop) {
    noteFolderSheetBackdrop.addEventListener('click', (event) => {
      event.preventDefault();
      closeNoteFolderSheet();
    });
  }

  const closeMoveFolderSheet = () => {
    if (folderSelectorEl) {
      folderSelectorEl.classList.add('hidden');
      folderSelectorEl.setAttribute('aria-hidden', 'true');
    }
    if (folderSelectorListEl) {
      folderSelectorListEl.innerHTML = '';
    }
    setCurrentFolderMoveNoteId(null);
    setFolderSelectorOnSelect(null);
    setAfterFolderCreated(null);
    if (noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'false');
    }
    const activeFolderSheetOpener = getActiveFolderSheetOpener();
    if (activeFolderSheetOpener instanceof HTMLElement) {
      try {
        activeFolderSheetOpener.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    setActiveFolderSheetOpener(null);
  };

  const handleFolderSelection = (folderId) => {
    const normalized = folderId || 'unsorted';
    const folderSelectorOnSelect = getFolderSelectorOnSelect();
    if (folderSelectorOnSelect) {
      folderSelectorOnSelect(normalized);
      closeMoveFolderSheet();
      return;
    }

    const moveNoteId = getCurrentFolderMoveNoteId();
    const noteExists = Boolean(
      moveNoteId && getAllNotes().some((note) => note && note.id === moveNoteId),
    );
    if (moveNoteId && noteExists) {
      handleMoveNoteToFolder(moveNoteId, normalized);
    } else {
      setCurrentEditingNoteFolderId(normalized);
    }
    closeMoveFolderSheet();
  };

  const openFolderSelectorForNote = (noteId, options = {}) => {
    if (!folderSelectorEl || !folderSelectorListEl) {
      return;
    }

    const { onSelect = null, initialFolderId = null, triggerEl = null } = options;
    setCurrentFolderMoveNoteId(noteId || null);
    setFolderSelectorOnSelect(typeof onSelect === 'function' ? onSelect : null);
    setActiveFolderSheetOpener(triggerEl || document.activeElement);

    const folders = getFolderOptions();
    const unsortedFolder = { id: 'unsorted', name: getFolderNameById('unsorted') || 'Unsorted' };
    const activeNote = noteId ? getAllNotes().find((n) => n.id === noteId) || null : null;
    const activeFolderId =
      initialFolderId ||
      (activeNote && typeof activeNote.folderId === 'string' && activeNote.folderId
        ? activeNote.folderId
        : getCurrentEditingNoteFolderId() || 'unsorted');

    const sortedFolders = (Array.isArray(folders) ? folders : [])
      .filter((folder) => folder && folder.id && folder.id !== 'unsorted')
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const folderOptions = [unsortedFolder, ...sortedFolders];
    folderSelectorListEl.innerHTML = '';
    folderOptions.forEach((folder) => {
      const row = document.createElement('li');
      row.dataset.folderId = folder.id || 'unsorted';
      row.textContent = folder.name || String(folder.id);
      row.setAttribute('role', 'option');
      if (row.dataset.folderId === String(activeFolderId)) {
        row.setAttribute('aria-current', 'true');
      }
      folderSelectorListEl.appendChild(row);
    });

    folderSelectorEl.classList.remove('hidden');
    folderSelectorEl.setAttribute('aria-hidden', 'false');
    if (triggerEl === noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'true');
    }
  };

  if (folderSelectorListEl) {
    folderSelectorListEl.addEventListener('click', (event) => {
      const row = event.target instanceof HTMLElement ? event.target.closest('li') : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });

    folderSelectorListEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target instanceof HTMLElement ? event.target.closest('li') : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });
  }

  if (folderSelectorBackdrop) {
    folderSelectorBackdrop.addEventListener('click', (event) => {
      event.preventDefault();
      closeMoveFolderSheet();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && folderSelectorEl && !folderSelectorEl.classList.contains('hidden')) {
      event.preventDefault();
      closeMoveFolderSheet();
    }
  });

  document.addEventListener('memoryCue:activeLessonUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
  });

  document.addEventListener('memoryCue:notesUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
  });

  noteEditorSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
    }, 0);
  });

  savedNotesSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
      renderActiveLessonCard();
    }, 0);
  });

  document.addEventListener('thinkingBar:openNote', (event) => {
    const noteId = event?.detail?.noteId;
    if (!noteId || typeof onOpenNoteFromDashboard !== 'function') {
      return;
    }
    onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
  });

  renderActiveLessonCard();
  renderTeacherModeEditorBar();

  return {
    applyNotesMode,
    isSavedNotesSheetOpen,
    showSavedNotesSheet,
    hideSavedNotesSheet,
    openNoteOptionsMenu,
    closeNoteOptionsMenu,
    openFolderSelectorForNote,
    closeMoveFolderSheet,
    closeNoteFolderSheet,
  };
};
