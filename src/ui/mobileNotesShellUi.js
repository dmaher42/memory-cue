import {
  createLessonCueFromNote,
  getActiveLessonNote,
  getLessonCueFields,
  getTeacherLessonContext,
  getTeacherLessonStep,
  getTeacherLessonSteps,
  isActiveLessonNoteId,
  setTeacherLessonStep,
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
  #openSavedNotesGlobal,
  #view-notebook .note-actions-top {
    display: none !important;
  }

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

  #view-notebook .notes-overview-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  #view-notebook .notes-overview-heading h2 {
    margin: 0;
  }

  #view-notebook .notes-overview-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: 3.7rem;
    min-height: 28px;
    padding: 0.26rem 0.72rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #efe8fb 3%);
    font-size: 0.74rem;
    line-height: 1;
    font-weight: 600;
    color: var(--text-main, #231B2E);
    white-space: nowrap;
  }

  #view-notebook #notesOverviewList {
    gap: 0.5rem;
  }

  #view-notebook #notesOverviewList[hidden] {
    display: none !important;
  }

  #view-notebook #notesOverviewList .note-item-mobile {
    margin: 0;
  }

  #view-notebook #notesOverviewList .note-list-item {
    gap: 0.22rem;
    padding: 0.82rem 0.95rem;
    margin: 0;
    border-radius: 0.95rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #f6f2fc 3%);
    box-shadow: none;
  }

  #view-notebook #notesOverviewList .note-list-item:hover,
  #view-notebook #notesOverviewList .note-list-item:focus-within {
    background: color-mix(in srgb, #ffffff 91%, #efe8fb 9%);
    border-color: color-mix(in srgb, var(--accent-color, #512663) 18%, transparent);
    box-shadow: none;
    transform: none;
  }

  #view-notebook #notesOverviewList .note-card-main {
    gap: 0.18rem;
  }

  #view-notebook #notesOverviewList .note-card-header {
    gap: 0.45rem;
  }

  #view-notebook #notesOverviewList .note-card-title {
    font-size: 0.92rem;
    line-height: 1.28;
    font-weight: 650;
  }

  #view-notebook #notesOverviewList .note-card-meta {
    gap: 0.32rem;
    margin-top: 0;
    font-size: 0.78rem;
    color: color-mix(in srgb, var(--text-main, #231B2E) 72%, #7c8798 28%);
  }

  #view-notebook #notesOverviewList .note-card-folder {
    padding: 0;
    border: 0;
    background: transparent;
    border-radius: 0;
    font-size: 0.78rem;
    color: inherit;
  }

  #view-notebook #notesOverviewList .note-card-folder::before {
    display: none;
  }

  #view-notebook #notesOverviewList .note-card-action {
    width: 28px;
    height: 28px;
    padding: 0.18rem;
    margin-left: 0.15rem;
    border-radius: 999px;
    box-shadow: none;
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

  .mobile-panel--notes .note-sections-bar {
    display: grid;
    gap: 0.34rem;
  }

  .mobile-panel--notes .note-sections-row {
    display: flex;
    gap: 0.34rem;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 0.08rem;
  }

  .mobile-panel--notes .note-sections-row::-webkit-scrollbar {
    display: none;
  }

  .mobile-panel--notes .note-section-chip {
    flex: 0 0 auto;
    min-height: 28px;
    padding: 0.28rem 0.68rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #efe8fb 3%);
    font-size: 0.73rem;
    font-weight: 600;
    color: var(--text-main, #231B2E);
    white-space: nowrap;
  }

  .mobile-panel--notes .note-section-chip[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #512663) 14%, #ffffff 86%);
    border-color: color-mix(in srgb, var(--accent-color, #512663) 30%, transparent);
    font-weight: 700;
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

  .mobile-panel--notes .teacher-toolbar-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-height: 2rem;
    padding: 0.38rem 0.74rem;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #efe8fb 3%);
    color: var(--text-main, #231B2E);
  }

  .mobile-panel--notes .teacher-toolbar-toggle::after {
    content: '▾';
    font-size: 0.72rem;
    opacity: 0.7;
  }

  .mobile-panel--notes .teacher-toolbar-toggle[data-expanded="true"]::after {
    transform: rotate(180deg);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-panel {
    padding: 0.4rem 0 0;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-shell {
    padding: 0.58rem 0.62rem;
    border-radius: 0.95rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 70%, transparent);
    background: color-mix(in srgb, #ffffff 97%, #efe8fb 3%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-copy {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-section {
    display: grid;
    gap: 0.24rem;
    margin-top: 0.34rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-section--steps {
    position: sticky;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 4.8rem);
    z-index: 8;
    margin: 0.55rem -0.08rem 0;
    padding: 0;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-dock {
    display: grid;
    gap: 0.3rem;
    padding: 0.42rem 0.48rem;
    border-radius: 0.88rem;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 72%, transparent);
    background: color-mix(in srgb, #ffffff 90%, #f3eefc 10%);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.1);
    backdrop-filter: blur(12px);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-label {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-toolbar-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action {
    min-height: 27px;
    padding: 0.28rem 0.58rem;
    font-size: 0.72rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .note-inline-action[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #512663) 14%, #ffffff 86%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #512663) 30%, transparent);
    color: var(--text-main, #231B2E);
    font-weight: 600;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-row,
  #view-notebook [data-active-lesson-card] .teacher-step-row {
    display: flex;
    gap: 0.32rem;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 0.06rem;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-row::-webkit-scrollbar,
  #view-notebook [data-active-lesson-card] .teacher-step-row::-webkit-scrollbar {
    display: none;
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-chip,
  #view-notebook [data-active-lesson-card] .teacher-step-chip {
    flex: 0 0 auto;
    min-height: 27px;
    padding: 0.26rem 0.54rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--card-border, rgba(81, 38, 99, 0.14)) 68%, transparent);
    background: color-mix(in srgb, #ffffff 96%, #f3eefc 4%);
    font-size: 0.72rem;
    line-height: 1;
    color: var(--text-main, #231B2E);
  }

  .mobile-panel--notes [data-teacher-mode-editor-bar] .teacher-step-chip[data-selected="true"],
  #view-notebook [data-active-lesson-card] .teacher-step-chip[data-selected="true"] {
    background: color-mix(in srgb, var(--accent-color, #512663) 14%, #ffffff 86%);
    border-color: color-mix(in srgb, var(--accent-color, #512663) 34%, transparent);
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
    padding-bottom: 108px !important;
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
    getCurrentTeacherView = () => 'plan',
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
    onOpenTeacherNoteView = null,
  } = options;

  let notesMode = 'notebooks';
  let savedNotesSheetHideTimeout = null;
  let savedNotesSheetFocusRestoreEl = null;
  let currentNoteOptionsNoteId = null;
  let currentNoteOptionsFocusRestoreEl = null;
  let notesOverviewCollapsed = true;
  let teacherEditorToolsExpanded = false;
  let activeNoteSectionLabel = '';
  let noteActionCreateLessonCueBtn = initialNoteActionCreateLessonBtn;
  let noteActionSetActiveLessonBtn = initialNoteActionSetActiveLessonBtn;
  const NOTE_SECTION_MAX_VISIBLE = 6;
  const NOTE_SECTION_PRIORITY = [
    'goal',
    'say',
    'teach',
    'model',
    'ask',
    'next',
    'guided practice',
    'independent practice',
    'materials',
    'reflection',
    'reminder',
    'follow up',
    'key points',
    'questions',
  ];

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

    const actionsRow = headerBlock.querySelector('.note-editor-actions-row');
    if (!(actionsRow instanceof HTMLElement)) {
      return null;
    }

    const existingBar = headerBlock.querySelector('[data-teacher-mode-editor-bar]');
    if (existingBar instanceof HTMLElement) {
      return existingBar;
    }

    const bar = document.createElement('div');
    bar.dataset.teacherModeEditorBar = 'true';
    bar.className = 'teacher-toolbar-host';
    actionsRow.insertAdjacentElement('afterend', bar);
    return bar;
  };

  const ensureTeacherModeToggleButton = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }
    const actionsRow = headerBlock.querySelector('.note-editor-actions-row');
    if (!(actionsRow instanceof HTMLElement)) {
      return null;
    }
    const existingButton = actionsRow.querySelector('[data-teacher-mode-toggle]');
    if (existingButton instanceof HTMLButtonElement) {
      return existingButton;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'note-inline-action teacher-toolbar-toggle';
    button.dataset.teacherModeToggle = 'true';
    button.textContent = 'Lesson';
    actionsRow.appendChild(button);
    return button;
  };

  const ensureNoteSectionsBar = () => {
    const headerBlock = noteEditorSheet?.querySelector('.scratch-notes-header-block');
    if (!(headerBlock instanceof HTMLElement)) {
      return null;
    }

    const existingBar = headerBlock.querySelector('[data-note-sections-bar]');
    if (existingBar instanceof HTMLElement) {
      return existingBar;
    }

    const bar = document.createElement('div');
    bar.dataset.noteSectionsBar = 'true';
    bar.className = 'note-sections-bar';
    const noteEditorCard = noteEditorSheet?.querySelector('.note-editor-card');
    if (noteEditorCard instanceof HTMLElement) {
      noteEditorCard.insertBefore(bar, headerBlock.nextSibling);
    } else {
      headerBlock.insertAdjacentElement('afterend', bar);
    }
    return bar;
  };

  const normalizeSectionLabel = (value = '') => String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-–—]+$/, '')
    .trim()
    .toLowerCase();

  const getVisibleNoteSections = (sections = []) => {
    if (!Array.isArray(sections) || sections.length < 2) {
      return [];
    }

    const normalizedSeen = new Set();
    const sectionEntries = sections
      .map((section, index) => {
        const label = String(section?.label || '').trim();
        const normalized = normalizeSectionLabel(label);
        if (!label || !normalized || normalizedSeen.has(normalized)) {
          return null;
        }
        normalizedSeen.add(normalized);
        const wordCount = normalized.split(/\s+/).filter(Boolean).length;
        const priority = NOTE_SECTION_PRIORITY.indexOf(normalized);
        return {
          index,
          label,
          normalized,
          priority,
          isPriority: priority >= 0,
          isCompact: label.length <= 24 && wordCount <= 3,
        };
      })
      .filter(Boolean);

    const prioritizedSections = sectionEntries.filter((entry) => entry.isPriority);
    const compactSections = sectionEntries.filter((entry) => entry.isPriority || entry.isCompact);
    const candidateSections = prioritizedSections.length >= 2 ? prioritizedSections : compactSections;
    if (candidateSections.length < 2) {
      return [];
    }

    const visibleSections = candidateSections
      .slice()
      .sort((left, right) => left.index - right.index)
      .slice(0, NOTE_SECTION_MAX_VISIBLE);

    return visibleSections.map(({ label, normalized }) => ({ label, normalized }));
  };

  const findSectionTargetElement = (label = '') => {
    const editorBody = document.getElementById('notebook-editor-body');
    if (!(editorBody instanceof HTMLElement)) {
      return null;
    }

    const normalizedLabel = normalizeSectionLabel(label);
    if (!normalizedLabel) {
      return null;
    }

    const blocks = editorBody.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, li');
    for (const block of blocks) {
      if (!(block instanceof HTMLElement)) {
        continue;
      }
      const rawText = String(block.textContent || '').trim();
      if (!rawText) {
        continue;
      }
      const normalizedText = normalizeSectionLabel(rawText);
      if (normalizedText === normalizedLabel || normalizedText.startsWith(`${normalizedLabel} `)) {
        return block;
      }
    }

    return null;
  };

  const renderNoteSectionsBar = () => {
    const bar = ensureNoteSectionsBar();
    if (!(bar instanceof HTMLElement)) {
      return;
    }

    const sections = typeof window !== 'undefined' && typeof window.getCurrentNoteSections === 'function'
      ? window.getCurrentNoteSections()
      : [];
    const visibleSections = getVisibleNoteSections(sections);
    if (visibleSections.length < 2) {
      activeNoteSectionLabel = '';
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    const normalizedSectionLabels = visibleSections
      .map((section) => section.normalized || normalizeSectionLabel(section.label || ''))
      .filter(Boolean);
    if (!normalizedSectionLabels.includes(activeNoteSectionLabel)) {
      activeNoteSectionLabel = normalizedSectionLabels[0] || '';
    }

    bar.hidden = false;
    bar.innerHTML = `
      <div class="note-sections-row">
        ${visibleSections.map((section) => `
          <button
            type="button"
            class="note-section-chip"
            data-note-section-jump="${escapeHtml(section.label || '')}"
            data-selected="${(section.normalized || normalizeSectionLabel(section.label || '')) === activeNoteSectionLabel ? 'true' : 'false'}"
          >${escapeHtml(section.label || '')}</button>
        `).join('')}
      </div>
    `;
  };

  const findScrollContainer = (startEl) => {
    let current = startEl?.parentElement || null;
    while (current) {
      const styles = window.getComputedStyle(current);
      const overflowY = styles?.overflowY || '';
      if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  };

  const getOffsetWithinContainer = (target, container) => {
    let offset = 0;
    let current = target;
    while (current && current !== container) {
      offset += current.offsetTop || 0;
      current = current.offsetParent;
    }
    return offset;
  };

  const getNoteSectionScrollOffset = () => {
    const toolbar = noteEditorSheet?.querySelector('.note-editor-toolbar');
    const toolbarHeight = toolbar instanceof HTMLElement ? toolbar.getBoundingClientRect().height : 0;
    return toolbarHeight + 12;
  };

  const handleNoteSectionJump = (event) => {
    const jumpButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-note-section-jump]')
      : null;
    if (!(jumpButton instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    const targetLabel = jumpButton.dataset.noteSectionJump || '';
    const targetElement = findSectionTargetElement(targetLabel);
    if (!(targetElement instanceof HTMLElement)) {
      return;
    }

    activeNoteSectionLabel = normalizeSectionLabel(targetLabel);
    renderNoteSectionsBar();

    const offset = getNoteSectionScrollOffset();
    const scrollContainer = findScrollContainer(targetElement);
    if (scrollContainer instanceof HTMLElement) {
      const targetTop = Math.max(0, getOffsetWithinContainer(targetElement, scrollContainer) - offset);
      scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' });
      return;
    }

    const viewportTop = targetElement.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, viewportTop), behavior: 'smooth' });
  };

  const renderTeacherModeEditorBar = () => {
    const bar = ensureTeacherModeEditorBar();
    const toggleButton = ensureTeacherModeToggleButton();
    if (!(bar instanceof HTMLElement) || !(toggleButton instanceof HTMLButtonElement)) {
      return;
    }

    const currentNoteId = getCurrentNoteId();
    const currentNote = currentNoteId
      ? getAllNotes().find((note) => note?.id === currentNoteId) || null
      : null;
    const lessonContext = currentNote ? getTeacherLessonContext(currentNote, getAllNotes()) : null;
    const hasCurrentNote = Boolean(currentNote);
    const shouldShowTeacherTools = Boolean(
      hasCurrentNote
      && (
        lessonContext?.isTeachingNote
        || lessonContext?.isCueNote
        || lessonContext?.hasLessonPair
        || lessonContext?.cueNoteId
        || lessonContext?.sourceNoteId
      )
    );
    if (!shouldShowTeacherTools) {
      toggleButton.hidden = true;
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    toggleButton.hidden = false;
    toggleButton.dataset.expanded = teacherEditorToolsExpanded ? 'true' : 'false';
    bar.hidden = false;
    const sourceNoteId = lessonContext?.sourceNoteId || null;
    const cueNoteId = lessonContext?.cueNoteId || null;
    const currentTeacherView = getCurrentTeacherView() === 'cue' ? 'cue' : 'plan';
    const canShowPlanToggle = Boolean(sourceNoteId && (lessonContext?.isCueNote || lessonContext?.hasLessonPair));
    const canShowCueToggle = Boolean(cueNoteId || sourceNoteId);
    const lessonStepId = lessonContext ? getTeacherLessonStep(lessonContext.currentNote, getAllNotes()) : null;
    const stepTargetId = sourceNoteId || cueNoteId || currentNoteId || '';
    const cueLabel = cueNoteId ? 'Refresh Cue' : 'Create Cue';
    const activeLessonTargetId = sourceNoteId || currentNoteId || '';
    const activeLessonLabel = 'Active';
    const lessonStepMarkup = stepTargetId
      ? `
        <div class="teacher-toolbar-section teacher-toolbar-section--steps">
          <div class="teacher-step-dock">
            <div class="teacher-step-row">
            ${getTeacherLessonSteps().map((step) => `
              <button
                type="button"
                class="teacher-step-chip"
                data-teacher-mode-action="step"
                data-note-id="${escapeHtml(stepTargetId)}"
                data-step-id="${escapeHtml(step.id)}"
                data-selected="${lessonStepId === step.id ? 'true' : 'false'}"
              >${escapeHtml(step.label)}</button>
            `).join('')}
            </div>
          </div>
        </div>
      `
      : '';

    bar.innerHTML = `
      <div class="teacher-toolbar-panel"${teacherEditorToolsExpanded ? '' : ' hidden'}>
        <div class="teacher-toolbar-shell w-full rounded-xl border border-base-300 bg-base-100/80">
          <div class="teacher-toolbar-section">
            <div class="teacher-toolbar-row">
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
                ${activeLessonTargetId && isActiveLessonNoteId(activeLessonTargetId) ? 'data-selected="true"' : 'data-selected="false"'}
              >${escapeHtml(activeLessonLabel)}</button>
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="lesson-plan"
                ${canShowPlanToggle ? `data-note-id="${escapeHtml(sourceNoteId || '')}"` : 'disabled'}
                ${currentTeacherView === 'plan' ? 'data-selected="true"' : 'data-selected="false"'}
              >Lesson Plan</button>
              <button
                type="button"
                class="note-inline-action"
                data-teacher-mode-action="lesson-cue"
                ${canShowCueToggle ? `data-note-id="${escapeHtml(cueNoteId || sourceNoteId || '')}"` : 'disabled'}
                ${cueNoteId ? '' : 'data-generate-cue="true"'}
                ${currentTeacherView === 'cue' && canShowCueToggle ? 'data-selected="true"' : 'data-selected="false"'}
              >Lesson Cue</button>
            </div>
          </div>
          ${lessonStepMarkup}
        </div>
      </div>
    `;
  };

  const handleTeacherModeEditorAction = async (event) => {
    const toggleButton = event.target instanceof HTMLElement
      ? event.target.closest('[data-teacher-mode-toggle]')
      : null;
    if (toggleButton instanceof HTMLButtonElement) {
      event.preventDefault();
      teacherEditorToolsExpanded = !teacherEditorToolsExpanded;
      renderTeacherModeEditorBar();
      return;
    }

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
      if (cueNote?.id && typeof onOpenTeacherNoteView === 'function') {
        onOpenTeacherNoteView(noteId, 'cue');
      }
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'active') {
      setActiveLessonNoteId(noteId);
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'step') {
      setTeacherLessonStep(noteId, actionButton.dataset.stepId || '', getAllNotes());
      refreshFromStorage({ preserveDraft: true });
      return;
    }

    if (actionButton.dataset.teacherModeAction === 'lesson-cue'
      && actionButton.dataset.generateCue === 'true') {
      const cueNote = await createLessonCueFromNote(noteId);
      refreshFromStorage({ preserveDraft: true });
      if (cueNote?.id && typeof onOpenTeacherNoteView === 'function') {
        onOpenTeacherNoteView(noteId, 'cue');
      }
      return;
    }

    if ((actionButton.dataset.teacherModeAction === 'lesson-plan' || actionButton.dataset.teacherModeAction === 'lesson-cue')
      && noteId
      && typeof onOpenTeacherNoteView === 'function') {
      onOpenTeacherNoteView(noteId, actionButton.dataset.teacherModeAction === 'lesson-cue' ? 'cue' : 'plan');
    }
  };

  ensureTeacherModeEditorBar()?.addEventListener('click', (event) => {
    void handleTeacherModeEditorAction(event);
  });
  ensureTeacherModeToggleButton()?.addEventListener('click', (event) => {
    void handleTeacherModeEditorAction(event);
  });
  ensureNoteSectionsBar()?.addEventListener('click', handleNoteSectionJump);

  const ensureNotesOverviewHeader = () => {
    if (!(notesOverviewPanel instanceof HTMLElement)) {
      return { headingEl: null, toggleEl: null, titleEl: null };
    }

    let headingEl = notesOverviewPanel.querySelector(':scope > .notes-overview-heading');
    let titleEl = headingEl instanceof HTMLElement
      ? headingEl.querySelector('h2')
      : notesOverviewPanel.querySelector(':scope > h2');
    if (!(titleEl instanceof HTMLElement)) {
      return { headingEl: null, toggleEl: null, titleEl: null };
    }

    if (!(headingEl instanceof HTMLElement)) {
      headingEl = document.createElement('div');
      headingEl.className = 'notes-overview-heading';
      notesOverviewPanel.insertBefore(headingEl, titleEl);
      headingEl.appendChild(titleEl);
    }

    let toggleEl = headingEl.querySelector('.notes-overview-toggle');
    if (!(toggleEl instanceof HTMLButtonElement)) {
      toggleEl = document.createElement('button');
      toggleEl.type = 'button';
      toggleEl.className = 'notes-overview-toggle';
      toggleEl.dataset.notesOverviewToggle = 'true';
      headingEl.appendChild(toggleEl);
    }

    return { headingEl, toggleEl, titleEl };
  };

  const renderNotesOverviewToggle = () => {
    const { toggleEl } = ensureNotesOverviewHeader();
    const listEl = notesOverviewPanel?.querySelector('#notesOverviewList');
    if (!(toggleEl instanceof HTMLButtonElement) || !(listEl instanceof HTMLElement)) {
      return;
    }
    listEl.hidden = notesOverviewCollapsed;
    toggleEl.textContent = notesOverviewCollapsed ? 'Open' : 'Close';
    toggleEl.setAttribute('aria-expanded', notesOverviewCollapsed ? 'false' : 'true');
    toggleEl.setAttribute('aria-controls', 'notesOverviewList');
  };

  ensureNotesOverviewHeader();
  renderNotesOverviewToggle();
  notesOverviewPanel?.addEventListener('click', (event) => {
    const toggle = event.target instanceof HTMLElement
      ? event.target.closest('[data-notes-overview-toggle]')
      : null;
    if (!(toggle instanceof HTMLButtonElement)) {
      return;
    }
    event.preventDefault();
    notesOverviewCollapsed = !notesOverviewCollapsed;
    renderNotesOverviewToggle();
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
    card.classList.add('hidden');
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '';
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

    if (actionButton.dataset.activeLessonAction === 'step') {
      const noteId = actionButton.dataset.noteId || '';
      const stepId = actionButton.dataset.stepId || '';
      if (noteId && stepId) {
        setTeacherLessonStep(noteId, stepId, getAllNotes());
        refreshFromStorage({ preserveDraft: true });
      }
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
    renderNoteSectionsBar();
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
    if (noteFolderButton) {
      noteFolderButton.setAttribute('aria-expanded', 'false');
    }
  };

  const handleNoteFolderSelection = (folderId) => {
    const targetNoteId = getCurrentMoveFolderSheetNoteId() || getCurrentNoteId();
    if (targetNoteId) {
      handleMoveNoteToFolder(targetNoteId, folderId || 'unsorted');
    }
    closeNoteFolderSheet();
  };

  const openNoteFolderSheetForNote = (noteId, options = {}) => {
    if (!noteFolderSheet || !noteFolderSheetList) {
      return false;
    }

    const { initialFolderId = null, triggerEl = null } = options;
    const activeNote = noteId ? getAllNotes().find((note) => note && note.id === noteId) || null : null;
    const activeFolderId =
      initialFolderId
      || (activeNote && typeof activeNote.folderId === 'string' && activeNote.folderId
        ? activeNote.folderId
        : getCurrentEditingNoteFolderId() || 'unsorted');
    const sortedFolders = (Array.isArray(getFolderOptions()) ? getFolderOptions() : [])
      .filter((folder) => folder && folder.id)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    noteFolderSheetList.innerHTML = '';
    sortedFolders.forEach((folder) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'note-folder-row';
      row.dataset.folderId = folder.id || 'unsorted';
      row.tabIndex = 0;
      if (String(row.dataset.folderId) === String(activeFolderId)) {
        row.classList.add('is-current');
      }

      const label = document.createElement('span');
      label.className = 'note-folder-row-label';

      const name = document.createElement('span');
      name.className = 'note-folder-row-name';
      name.textContent = folder.name || String(folder.id || 'Unsorted');

      label.appendChild(name);
      row.appendChild(label);
      noteFolderSheetList.appendChild(row);
    });

    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className = 'note-folder-row note-folder-row-new';
    newRow.tabIndex = 0;

    const prefix = document.createElement('span');
    prefix.className = 'note-folder-row-prefix';
    prefix.textContent = '+';

    const newName = document.createElement('span');
    newName.className = 'note-folder-row-name';
    newName.textContent = 'New folder';

    newRow.appendChild(prefix);
    newRow.appendChild(newName);
    noteFolderSheetList.appendChild(newRow);

    setCurrentMoveFolderSheetNoteId(noteId || null);
    setActiveFolderSheetOpener(triggerEl || document.activeElement);
    noteFolderSheet.classList.add('open');
    noteFolderSheet.setAttribute('aria-hidden', 'false');
    if (noteFolderSheetBackdrop) {
      noteFolderSheetBackdrop.classList.add('open');
      noteFolderSheetBackdrop.setAttribute('aria-hidden', 'false');
    }
    document.addEventListener('keydown', handleNoteFolderSheetKeydown);
    return true;
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
    if (options?.triggerEl === noteFolderButton && openNoteFolderSheetForNote(noteId, options)) {
      if (noteFolderButton) {
        noteFolderButton.setAttribute('aria-expanded', 'true');
      }
      return;
    }

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
    renderNoteSectionsBar();
  });

  document.addEventListener('memoryCue:activeLessonStepUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
  });

  document.addEventListener('memoryCue:notesUpdated', () => {
    renderActiveLessonCard();
    renderTeacherModeEditorBar();
    renderNoteSectionsBar();
  });

  noteEditorSheet?.addEventListener('input', () => {
    window.setTimeout(() => {
      renderNoteSectionsBar();
    }, 0);
  });

  noteEditorSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
      renderNoteSectionsBar();
    }, 0);
  });

  savedNotesSheet?.addEventListener('click', () => {
    window.setTimeout(() => {
      renderTeacherModeEditorBar();
      renderActiveLessonCard();
      renderNoteSectionsBar();
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
  renderNoteSectionsBar();

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
