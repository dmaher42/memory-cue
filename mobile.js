import { initViewportHeight } from './js/modules/viewport-height.js';
import { initReminders } from './js/reminders.js';
import { initSupabaseAuth } from './js/supabase-auth.js';
import {
  loadAllNotes,
  saveAllNotes,
  createNote,
  NOTES_STORAGE_KEY,
} from './js/modules/notes-storage.js';
import { getFolders } from './js/modules/notes-storage.js';
import { getFolderNameById, assignNoteToFolder } from './js/modules/notes-storage.js';
import { initNotesSync } from './js/modules/notes-sync.js';
import { ModalController } from './js/modules/modal-controller.js';
import { saveFolders } from './js/modules/notes-storage.js';

initViewportHeight();

/* BEGIN GPT CHANGE: bottom sheet open/close */
(function () {
  const setupSheet = () => {
    const sheet = document.getElementById('create-sheet');
    const closeBtn = document.getElementById('closeCreateSheet');
    if (!(sheet instanceof HTMLElement) || !(closeBtn instanceof HTMLElement)) {
      const attempts = typeof setupSheet._retryCount === 'number'
        ? setupSheet._retryCount
        : 0;
      if (attempts < 10) {
        setupSheet._retryCount = attempts + 1;
        setTimeout(setupSheet, 50);
      }
      return;
    }

    if (setupSheet._initialised) {
      return;
    }
    setupSheet._initialised = true;

    const sheetContent = sheet.querySelector('[data-dialog-content]');
    const backdrop = sheet.querySelector('.sheet-backdrop');
    const form = document.getElementById('createReminderForm');
    const saveBtn = document.getElementById('saveReminder');
    const prioritySelect = document.getElementById('priority');
    const chips = document.getElementById('priorityChips');
    const editorShell = sheet.querySelector('.reminder-editor-shell');
    const notifSwitchRow = sheet.querySelector('.notif-switch-row');
    const notifToggle = sheet.querySelector('#notifBtn');
    const priorityRadios = chips
      ? Array.from(chips.querySelectorAll('input[name="priority"]'))
      : [];

    const openerSet = new Set([
      ...Array.from(document.querySelectorAll('[data-open-add-task]')),
      ...Array.from(document.querySelectorAll('[aria-controls="createReminderModal"]')),
      ...Array.from(document.querySelectorAll('#addReminderFab')),
    ]);

    const openers = Array.from(openerSet).filter((button) =>
      button instanceof HTMLElement
    );
    const defaultOpener = openers[0] || null;

    const ensureHidden = () => {
      sheet.classList.add('hidden');
      sheet.setAttribute('hidden', '');
      sheet.setAttribute('aria-hidden', 'true');
      sheet.removeAttribute('open');
      sheet.classList.remove('open');
    };

    ensureHidden();

    [notifSwitchRow, notifToggle].forEach((el) => {
      el?.addEventListener('click', (event) => event.stopPropagation());
    });

    let lastTrigger = null;

    const dispatchSheetEvent = (type, detail) => {
      try {
        document.dispatchEvent(new CustomEvent(type, { detail }));
      } catch (error) {
        console.warn(`${type} dispatch failed`, error);
      }
    };

    const syncRadiosFromSelect = () => {
      const value = prioritySelect?.value || 'Medium';
      priorityRadios.forEach((radio) => {
        const isChecked = radio.value === value;
        radio.checked = isChecked;
        radio.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      });
    };

    const setPriorityValue = (value) => {
      if (!prioritySelect) return;
      if (prioritySelect.value !== value) {
        prioritySelect.value = value;
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncRadiosFromSelect();
    };

    priorityRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setPriorityValue(radio.value);
        }
      });
    });

    prioritySelect?.addEventListener('change', syncRadiosFromSelect);
    syncRadiosFromSelect();

    const focusFirstField = () => {
      const focusTarget = sheet.querySelector(
        'input, textarea, select, button, [contenteditable="true"]'
      );
      if (focusTarget instanceof HTMLElement) {
        setTimeout(() => {
          try {
            focusTarget.focus();
          } catch {
            /* ignore focus errors */
          }
        }, 0);
      }
    };

    const playEnterAnimation = () => {
      if (!(editorShell instanceof HTMLElement)) return;
      editorShell.classList.remove('reminder-enter', 'reminder-enter-active');
      void editorShell.offsetWidth;
      editorShell.classList.add('reminder-enter');
      requestAnimationFrame(() => {
        editorShell.classList.add('reminder-enter-active');
      });
    };

    const openSheet = (trigger) => {
      lastTrigger = trigger instanceof HTMLElement ? trigger : null;
      sheet.classList.remove('hidden');
      sheet.removeAttribute('hidden');
      sheet.setAttribute('aria-hidden', 'false');
      sheet.setAttribute('open', '');
      sheet.classList.add('open');

      if (lastTrigger) {
        lastTrigger.setAttribute('aria-expanded', 'true');
      }

      syncRadiosFromSelect();
      focusFirstField();
      playEnterAnimation();

      dispatchSheetEvent('reminder:sheet-opened', { trigger: lastTrigger });
    };

    const closeSheet = (reason = 'dismissed') => {
      const wasOpen = !sheet.classList.contains('hidden');
      if (editorShell) {
        editorShell.classList.remove('reminder-enter', 'reminder-enter-active');
      }
      ensureHidden();

      if (lastTrigger) {
        lastTrigger.setAttribute('aria-expanded', 'false');
      }

      const focusTarget =
        (lastTrigger && document.body.contains(lastTrigger) && lastTrigger) ||
        defaultOpener;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        try {
          focusTarget.focus();
        } catch {
          /* ignore focus restoration failures */
        }
      }

      if (wasOpen) {
        dispatchSheetEvent('reminder:sheet-closed', {
          reason,
          trigger: lastTrigger,
        });
      }

      lastTrigger = null;
    };

    openers.forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        const detail = { mode: 'create', trigger };
        dispatchSheetEvent('cue:prepare', detail);
        dispatchSheetEvent('cue:open', detail);
      });
    });

    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      closeSheet('close-button');
    });

    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeSheet('backdrop');
      }
    });

    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSheet('escape');
      }
    });

    sheetContent?.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    sheet.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.hasAttribute('data-close')) {
        closeSheet('backdrop');
      }
    });

    document.addEventListener('cue:open', (event) => {
      syncRadiosFromSelect();
      openSheet(event?.detail?.trigger || null);
    });

    document.addEventListener('cue:close', (event) => {
      closeSheet(event?.detail?.reason || 'cue-close');
    });

    document.addEventListener('cue:prepare', () => {
      syncRadiosFromSelect();
    });

    document.addEventListener('cue:cancelled', () => {
      closeSheet('cue-cancelled');
    });

    if (typeof window !== 'undefined') {
      window.closeAddTask = closeSheet;
    }

    document.addEventListener('reminder:save', (event) => {
      if (!(saveBtn instanceof HTMLElement)) return;
      const trigger = event?.detail?.trigger;
      if (trigger && trigger !== saveBtn) {
        return;
      }
      if (saveBtn.matches(':disabled')) {
        return;
      }
      saveBtn.click();
    });

    if (form instanceof HTMLFormElement && saveBtn instanceof HTMLElement) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (saveBtn.matches(':disabled')) {
          return;
        }
        saveBtn.click();
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSheet, { once: true });
  } else {
    setupSheet();
  }
})();
/* END GPT CHANGE */

const bootstrapReminders = () => {
  if (bootstrapReminders._initialised) {
    return;
  }
  bootstrapReminders._initialised = true;

  initReminders({
    variant: 'mobile',
    qSel: '#searchReminders',
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
    syncStatusSel: '#mcStatusText',
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
    dateFeedbackSel: '#dateFeedback',
    voiceBtnSel: '#voiceBtn',
  }).catch((error) => {
    console.error('Failed to initialise reminders:', error);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapReminders, { once: true });
} else {
  bootstrapReminders();
}

const wireHeaderIconShortcuts = () => {
  const notifShortcutButton = document.getElementById('notifHeaderBtn');
  const notificationCta = document.getElementById('notifBtn');

  if (notifShortcutButton && notificationCta) {
    notifShortcutButton.addEventListener('click', () => {
      notificationCta.click();
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireHeaderIconShortcuts, { once: true });
} else {
  wireHeaderIconShortcuts();
}

const initMobileNotes = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const titleInput = document.getElementById('noteTitleMobile');
  const scratchNotesEditorElement = document.getElementById('notebook-editor-body');
  const saveButton = document.getElementById('noteSaveMobile');
  const newButton = document.getElementById('noteNewMobile');
  const listElement = document.getElementById('notesListMobile');
  const countElement = document.getElementById('notesCountMobile');
  const filterInput = document.getElementById('notebook-search-input');
  const savedNotesSheet = document.getElementById('savedNotesSheet');
  const openSavedNotesButton = document.getElementById('openSavedNotesSheet');
  const closeSavedNotesButton = document.querySelector('[data-action="close-saved-notes"]');
  const folderSelectorEl = document.getElementById('moveFolderSheet');
  const folderSelectorListEl = document.getElementById('move-folder-list');
  const folderSelectorCreateBtn = document.getElementById('move-folder-create');
  const folderSelectorCancelBtn = document.getElementById('move-folder-cancel');
  const folderSelectorSheet = folderSelectorEl?.querySelector('.sheet-panel');
  const ACTIVE_NOTE_SHADOW_CLASS = 'shadow-[0_0_0_3px_var(--accent-color)]';

  const createScratchNotesEditor = () => {
    if (!scratchNotesEditorElement) {
      return null;
    }

    const NotesEditorClass =
      (typeof window !== 'undefined' && typeof window.NotesEditor === 'function'
        ? window.NotesEditor
        : null);

    if (NotesEditorClass) {
        return new NotesEditorClass('#notebook-editor-body', {
          toolbar: true,
          placeholder: 'Start typing your note…',
        });
    }

    scratchNotesEditorElement.setAttribute('contenteditable', 'true');
    scratchNotesEditorElement.setAttribute('role', 'textbox');
    scratchNotesEditorElement.setAttribute('aria-multiline', 'true');
    scratchNotesEditorElement.dataset.placeholder = 'Start typing your note…';

    return {
      element: scratchNotesEditorElement,
      setContent(value = '') {
        // preserve HTML markup (paragraphs, formatting)
        scratchNotesEditorElement.innerHTML = value || '';
      },
      getHTML() {
        return scratchNotesEditorElement.innerHTML || '';
      },
      getText() {
        // plain text fallback if required
        return scratchNotesEditorElement.textContent || '';
      },
      focus() {
        try {
          scratchNotesEditorElement.focus();
        } catch {
          /* ignore focus errors */
        }
      },
    };
  };

  const scratchNotesEditor = createScratchNotesEditor();

  if (!titleInput || !scratchNotesEditor || !scratchNotesEditorElement || !saveButton) {
    return;
  }

  const applyFormatCommand = (command) => {
    if (!command || !scratchNotesEditorElement) return;
    try {
      scratchNotesEditorElement.focus();
    } catch {
      /* ignore focus errors */
    }
    document.execCommand(command, false, null);
  };

  // Wire up formatting toolbar (bold, italic, underline, ul, ol) for the rich text editor
  const toolbarEl = document.getElementById('scratchNotesToolbar');
  if (toolbarEl && scratchNotesEditorElement) {
    toolbarEl.addEventListener('click', (event) => {
      const button = event.target.closest('.notebook-format-button[data-format]');
      if (!button) return;
      const format = button.getAttribute('data-format');
      switch (format) {
        case 'bold':
          applyFormatCommand('bold');
          break;
        case 'italic':
          applyFormatCommand('italic');
          break;
        case 'underline':
          applyFormatCommand('underline');
          break;
        case 'bullet-list':
          applyFormatCommand('insertUnorderedList');
          break;
        case 'numbered-list':
          applyFormatCommand('insertOrderedList');
          break;
        default:
          break;
      }
    });
  }

  const setEditorContent = (value = '') => {
    const normalizedValue = typeof value === 'string' ? value : '';
    if (scratchNotesEditor && typeof scratchNotesEditor.setContent === 'function') {
      scratchNotesEditor.setContent(normalizedValue || '');
      return;
    }

    const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(normalizedValue);
    scratchNotesEditorElement.innerHTML = '';
    if (looksLikeHtml) {
      scratchNotesEditorElement.innerHTML = normalizedValue || '';
    } else {
      scratchNotesEditorElement.textContent = normalizedValue || '';
    }
  };

  const getEditorHTML = () => {
    if (scratchNotesEditor && typeof scratchNotesEditor.getHTML === 'function') {
      return scratchNotesEditor.getHTML() || '';
    }
    return scratchNotesEditorElement.innerHTML || '';
  };

  const getEditorText = () => {
    if (scratchNotesEditor && typeof scratchNotesEditor.getText === 'function') {
      return scratchNotesEditor.getText() || '';
    }
    return scratchNotesEditorElement.textContent || '';
  };

  const getClosestBlock = (node) => {
    let current = node;
    while (current && current !== scratchNotesEditorElement) {
      if (
        current.nodeType === Node.ELEMENT_NODE &&
        ['div', 'p', 'li'].includes(current.tagName?.toLowerCase())
      ) {
        return current;
      }
      current = current.parentNode;
    }
    return scratchNotesEditorElement;
  };

  const detectListShortcut = (prefixText) => {
    if (typeof prefixText !== 'string') {
      return null;
    }
    const normalized = prefixText.replace(/\u00a0/g, ' ');
    if (/^\s*[\*-]\s*$/.test(normalized)) {
      return 'ul';
    }
    if (/^\s*1\.?\s*$/.test(normalized)) {
      return 'ol';
    }
    return null;
  };

  const handleListShortcuts = (event) => {
    if (event.key !== ' ') {
      return;
    }
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!scratchNotesEditorElement.contains(range.startContainer)) {
        return;
      }
      const block = getClosestBlock(range.startContainer);
      const prefixRange = range.cloneRange();
      prefixRange.selectNodeContents(block);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefixText = prefixRange.toString();
      const marker = detectListShortcut(prefixText);
      if (!marker) {
        return;
      }
      event.preventDefault();
      prefixRange.deleteContents();
      applyFormatCommand(marker === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
    }, 0);
  };

  const handleFormattingShortcuts = (event) => {
    if (!event || event.altKey || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = (event.key || '').toLowerCase();
    let command = null;
    if (key === 'b') {
      command = 'bold';
    } else if (key === 'i') {
      command = 'italic';
    } else if (key === 'u') {
      command = 'underline';
    }

    if (!command) {
      return;
    }

    event.preventDefault();
    applyFormatCommand(command);
  };

  const debounce = (fn, delay = 200) => {
    let timeoutId;
    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fn(...args);
      }, delay);
    };
  };

  let currentNoteId = null;
  let allNotes = [];
  let currentFolderId = 'all';
  let currentEditingNoteFolderId = 'unsorted';
  let currentFolderMoveNoteId = null;
  let folderSelectorOnSelect = null;
  let activeFolderSheetOpener = null;
  let filterQuery = '';
  let skipAutoSelectOnce = false;
  let savedNotesSheetHideTimeout = null;

  const clearSearchFilter = () => {
    filterQuery = '';
    if (filterInput) {
      filterInput.value = '';
    }
  };

  const isSavedNotesSheetOpen = () =>
    savedNotesSheet?.dataset.open === 'true';

  const showSavedNotesSheet = () => {
    if (!savedNotesSheet) {
      return;
    }
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
      savedNotesSheetHideTimeout = null;
    }
    savedNotesSheet.classList.remove('hidden');
    savedNotesSheet.dataset.open = 'true';
    savedNotesSheet.setAttribute('aria-hidden', 'false');
    // Ensure folder chips are built and notes are rendered when opening the sheet
    try {
      buildFolderChips();
    } catch (e) {
      /* ignore */
    }
    try {
      renderFilteredNotes();
    } catch (e) {
      /* ignore */
    }
    // ensure floating FAB exists once the sheet is ready
    try {
      ensureFloatingNewFolderFab();
    } catch (e) {
      /* ignore */
    }
  };

  const hideSavedNotesSheet = () => {
    if (!savedNotesSheet) {
      return;
    }
    savedNotesSheet.dataset.open = 'false';
    savedNotesSheet.setAttribute('aria-hidden', 'true');
    if (savedNotesSheetHideTimeout) {
      clearTimeout(savedNotesSheetHideTimeout);
    }
    savedNotesSheetHideTimeout = setTimeout(() => {
      savedNotesSheet?.classList.add('hidden');
    }, 200);
  };

  const bindSavedNotesSheetEvents = () => {
    if (!savedNotesSheet) {
      return;
    }
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
      hideSavedNotesSheet();
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
  };

  bindSavedNotesSheetEvents();

  const getNormalizedFilterQuery = () =>
    typeof filterQuery === 'string' ? filterQuery.trim().toLowerCase() : '';

  const getFilteredNotes = (source = allNotes) => {
    if (!Array.isArray(source)) {
      return [];
    }
    const normalizedQuery = getNormalizedFilterQuery();
    if (!normalizedQuery) {
      return [...source];
    }
    return source.filter((note) => {
      const title = typeof note?.title === 'string' ? note.title.toLowerCase() : '';
      const body = getNoteBodyText(note).toLowerCase();
      return title.includes(normalizedQuery) || body.includes(normalizedQuery);
    });
  };

  const getVisibleNotes = (source = allNotes) => {
    if (!Array.isArray(source)) return [];
    // Apply folder filtering first
    let filteredByFolder;
    if (currentFolderId === null || currentFolderId === 'all') {
      filteredByFolder = [...source];
    } else if (currentFolderId === 'unsorted') {
      filteredByFolder = source.filter((note) => !note.folderId || note.folderId === 'unsorted');
    } else {
      filteredByFolder = source.filter((note) => note.folderId === currentFolderId);
    }
    // Then apply search filter
    return getFilteredNotes(filteredByFolder);
  };

  const getNoteCountsByFolder = (allNotesArray = [], folders = []) => {
    const counts = {
      all: Array.isArray(allNotesArray) ? allNotesArray.length : 0,
      unsorted: 0,
    };

    (Array.isArray(folders) ? folders : []).forEach((folder) => {
      if (folder && folder.id && folder.id !== 'unsorted') {
        counts[folder.id] = 0;
      }
    });

    (Array.isArray(allNotesArray) ? allNotesArray : []).forEach((note) => {
      const folderId = note?.folderId || 'unsorted';
      if (!folderId || folderId === 'unsorted') {
        counts.unsorted += 1;
      } else if (Object.prototype.hasOwnProperty.call(counts, folderId)) {
        counts[folderId] += 1;
      } else {
        counts.unsorted += 1;
      }
    });

    return counts;
  };

  const setEditorValues = (note) => {
    if (currentNoteId === note.id) return;
    if (!note) {
      currentNoteId = null;
      titleInput.value = '';
      setEditorContent('');
      delete titleInput.dataset.noteOriginalTitle;
      scratchNotesEditorElement.dataset.noteOriginalBody = '';
      const labelElClear = document.getElementById('note-folder-label');
      if (labelElClear) {
        labelElClear.textContent = getFolderNameById(currentEditingNoteFolderId || 'unsorted');
      }
      return;
    }
    currentNoteId = note.id;
    const nextTitle = note.title || '';
    const nextBody =
      (typeof note.bodyHtml === 'string' && note.bodyHtml.trim().length
        ? note.bodyHtml
        : typeof note.body === 'string'
          ? note.body
          : '') || '';
    titleInput.value = nextTitle;
    setEditorContent(nextBody);
    titleInput.dataset.noteOriginalTitle = nextTitle;
    scratchNotesEditorElement.dataset.noteOriginalBody = nextBody;
    // set current editing folder for existing notes
    currentEditingNoteFolderId = note.folderId && typeof note.folderId === 'string' ? note.folderId : 'unsorted';
    const labelEl = document.getElementById('note-folder-label');
    if (labelEl) {
      labelEl.textContent = getFolderNameById(currentEditingNoteFolderId);
    }
  };

  const extractPlainText = (html = '') => {
    const temp = document.createElement('div');
    temp.innerHTML = typeof html === 'string' ? html : '';
    return (temp.textContent || temp.innerText || '').trim();
  };

  const getNoteBodyText = (note) => {
    if (!note) return '';
    if (typeof note.bodyText === 'string' && note.bodyText.trim().length) {
      return note.bodyText.trim();
    }
    const source = typeof note.bodyHtml === 'string' && note.bodyHtml.trim().length
      ? note.bodyHtml
      : typeof note.body === 'string'
        ? note.body
        : '';
    return extractPlainText(source);
  };

  const getEditorValues = () => {
    const bodyHtml = getEditorHTML();
    const bodyText = extractPlainText(bodyHtml);
    return {
      title: typeof titleInput.value === 'string' ? titleInput.value.trim() : '',
      bodyHtml,
      bodyText,
    };
  };

  const updateListSelection = () => {
    if (!listElement) {
      return;
    }
    const buttons = listElement.querySelectorAll('[data-role="open-note"][data-note-id]');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const isActive = button.getAttribute('data-note-id') === currentNoteId;
      if (isActive) {
        button.setAttribute('data-state', 'active');
      } else {
        button.removeAttribute('data-state');
      }
      button.classList.toggle('active', isActive);
      button.classList.toggle('outline', isActive);
      button.classList.toggle('outline-2', isActive);
      button.classList.toggle('outline-accent', isActive);
      button.classList.toggle(ACTIVE_NOTE_SHADOW_CLASS, isActive);
      button.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  };

  const formatNoteTimestamp = (timestamp) => {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const timeString = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) {
      return `Today · ${timeString}`;
    }
    const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateString} · ${timeString}`;
  };

  const hasUnsavedChanges = () => {
    const currentTitle = typeof titleInput.value === 'string' ? titleInput.value : '';
    const currentBody = getEditorHTML();
    const originalTitle = titleInput.dataset.noteOriginalTitle ?? '';
    const originalBody = scratchNotesEditorElement.dataset.noteOriginalBody ?? '';
    return currentTitle !== originalTitle || currentBody !== originalBody;
  };

  const getNoteTimestamp = (note) => {
    if (!note) return 0;
    const candidates = [note.updatedAt, note.modifiedAt, note.createdAt];
    for (const value of candidates) {
      const parsed = Date.parse(value || '');
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  };

  const getSortedNotes = () => {
    const notes = loadAllNotes();
    if (!Array.isArray(notes)) {
      return [];
    }
    return [...notes].sort((a, b) => getNoteTimestamp(b) - getNoteTimestamp(a));
  };

  const readStoredSnapshot = () => {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      return localStorage.getItem(NOTES_STORAGE_KEY);
    } catch {
      return null;
    }
  };

  let lastSerializedNotes = readStoredSnapshot();

  const updateStoredSnapshot = () => {
    lastSerializedNotes = readStoredSnapshot();
    return lastSerializedNotes;
  };

  const refreshFromStorage = ({ preserveDraft = true } = {}) => {
    const sortedNotes = getSortedNotes();
    allNotes = Array.isArray(sortedNotes) ? [...sortedNotes] : [];
    try {
      buildFolderChips();
    } catch (e) {
      /* ignore chip render failures */
    }
    const shouldPreserveEditor = preserveDraft && hasUnsavedChanges();
    const hasAnyNotes = allNotes.length > 0;
    const visibleNotes = getVisibleNotes();

    renderNotesList(visibleNotes);

    if (!hasAnyNotes) {
      if (!shouldPreserveEditor) {
        setEditorValues(null);
      }
      updateListSelection();
      updateStoredSnapshot();
      skipAutoSelectOnce = false;
      return visibleNotes;
    }

    if (currentNoteId) {
      const activeNote = allNotes.find((note) => note.id === currentNoteId) || null;
      if (activeNote) {
        if (!shouldPreserveEditor) {
          setEditorValues(activeNote);
        }
      } else {
        currentNoteId = null;
        if (!shouldPreserveEditor && !skipAutoSelectOnce && allNotes[0]) {
          setEditorValues(allNotes[0]);
        }
      }
    } else if (!shouldPreserveEditor && !skipAutoSelectOnce && allNotes[0]) {
      setEditorValues(allNotes[0]);
    }

    skipAutoSelectOnce = false;
    updateListSelection();
    updateStoredSnapshot();
    return visibleNotes;
  };

  const NOTEBOOK_LIST_TRANSITION_MS = 160;

  const showNoteToast = (message) => {
    if (!message) return null;
    const toast = document.createElement('div');
    toast.className = 'note-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast && toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 2800);
    return toast;
  };

  const showMoveToast = (folderName) => {
    const name = folderName || 'folder';
    showNoteToast(`Moved to ${name}`);
  };
  const scheduleNotebookFrame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 0);
  const cancelNotebookFrame =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (id) => clearTimeout(id);
  let listTransitionTimeoutId = null;
  let listTransitionFrameId = null;

  const runNotebookListTransition = (renderFn) => {
    if (typeof renderFn !== 'function') {
      return;
    }

    if (!listElement) {
      renderFn();
      return;
    }

    if (listTransitionTimeoutId) {
      clearTimeout(listTransitionTimeoutId);
      listTransitionTimeoutId = null;
    }
    if (listTransitionFrameId) {
      cancelNotebookFrame(listTransitionFrameId);
      listTransitionFrameId = null;
    }

    listElement.classList.remove('notebook-list-transition-in', 'notebook-list-transition-in-active');
    listElement.classList.add('notebook-list-transition-out');

    listTransitionTimeoutId = setTimeout(() => {
      renderFn();

      listElement.classList.remove('notebook-list-transition-out');
      listElement.classList.add('notebook-list-transition-in');

      listTransitionFrameId = scheduleNotebookFrame(() => {
        listElement.classList.add('notebook-list-transition-in-active');
      });
    }, NOTEBOOK_LIST_TRANSITION_MS);
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
    updateStoredSnapshot();

    if (currentNoteId === noteId) {
      setEditorValues(null);
      skipAutoSelectOnce = true;
    }

    refreshFromStorage({ preserveDraft: false });
  };

  const renderNotesList = (notes = [], { withTransition = true } = {}) => {
    if (withTransition) {
      runNotebookListTransition(() => renderNotesList(notes, { withTransition: false }));
      return notes;
    }

    if (!listElement) {
      return notes;
    }

    listElement.innerHTML = '';

    if (countElement) {
      const totalSaved = allNotes.length;
      const visibleCount = notes.length;
      countElement.textContent = totalSaved
        ? `${visibleCount} of ${totalSaved} saved`
        : 'No saved notes yet';
    }

    if (!notes.length) {
      const hasFilter = Boolean(getNormalizedFilterQuery());
      const isAllFolder = !currentFolderId || currentFolderId === 'all';
      const isCustomFolder = currentFolderId && currentFolderId !== 'all' && currentFolderId !== 'unsorted';
      const emptyTitle = hasFilter
        ? 'No notes match this filter'
        : isAllFolder
          ? "You don't have any notes yet."
          : isCustomFolder
            ? 'Empty folder'
            : 'No notes here yet';
      const emptyBody = hasFilter
        ? 'Try adjusting your search or filters.'
        : 'Create your first note in this folder to get started.';

      listElement.innerHTML = `
        <div class="notebook-empty-state">
          <div class="notebook-empty-illustration" aria-hidden="true">📂</div>
          <h3 class="notebook-empty-title">${emptyTitle}</h3>
          <p class="notebook-empty-body">${emptyBody}</p>
        </div>
      `;
      return notes;
    }

    notes.forEach((note) => {
      const listItem = document.createElement('article');
      listItem.className = 'premium-note-card note-item-mobile notebook-note-card';
      listItem.dataset.noteId = note.id;
      listItem.dataset.role = 'open-note';
      listItem.setAttribute('role', 'button');
      listItem.tabIndex = 0;

      const noteRow = document.createElement('div');
      noteRow.className = 'notebook-note-row';

      const noteTitle = note.title || 'Untitled';
      const titleEl = document.createElement('h4');
      titleEl.className = 'note-card-title line-clamp-2';
      titleEl.textContent = noteTitle;
      titleEl.setAttribute('title', noteTitle);

      const folderId = note.folderId && typeof note.folderId === 'string' ? note.folderId : 'unsorted';
      const folderPill = document.createElement('span');
      folderPill.className = 'note-card-folder';
      const folderName = getFolderNameById(folderId) || 'Unsorted';
      folderPill.textContent = folderName;

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.dataset.noteId = note.id;
      actionBtn.dataset.role = 'note-menu';
      actionBtn.className = 'note-card-action';
      actionBtn.setAttribute('aria-label', 'Note actions');
      actionBtn.tabIndex = 0;
      actionBtn.setAttribute('aria-haspopup', 'true');
      actionBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      `;

      noteRow.appendChild(titleEl);
      noteRow.appendChild(folderPill);
      noteRow.appendChild(actionBtn);

      listItem.appendChild(noteRow);
      listElement.appendChild(listItem);
    });

    updateListSelection();
    return notes;
  };

  /* Folder chip bar rendering and interaction */
  const getFolderBarEl = () => document.getElementById('notebook-folder-bar');

  const setActiveFolderChip = (folderId) => {
    const bar = getFolderBarEl();
    if (!bar) return;
    const chips = bar.querySelectorAll('.notebook-folder-chip');
    chips.forEach((chip) => {
      const isActive = String(chip.dataset.folderId) === String(folderId);
      chip.classList.toggle('notebook-folder-chip--active', isActive);
      // keep legacy active class for compatibility
      chip.classList.toggle('active', isActive);
      if (isActive) {
        try {
          chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) {
          try { chip.scrollIntoView(); } catch {}
        }
      }
    });
  };
  const buildFolderChips = () => {
    const folderBar = getFolderBarEl();
    if (!folderBar) return;
    folderBar.innerHTML = '';
    const filterBar = document.createElement('div');
    filterBar.className = 'notebook-folder-filter-bar';
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }
    const normalized = Array.isArray(folders) ? folders.filter(Boolean) : [];
    const unsortedFolder =
      normalized.find((f) => f && f.id === 'unsorted') || { id: 'unsorted', name: 'Unsorted' };
    const extraFolders = normalized
      .filter((f) => f && f.id !== 'unsorted')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    const folderListForCounts = [unsortedFolder, ...extraFolders];
    const noteCounts = getNoteCountsByFolder(allNotes, folderListForCounts);

    const chipModel = [
      { id: 'all', name: 'All notes', isVirtual: true },
      { ...unsortedFolder, isVirtual: false },
      ...extraFolders.map((f) => ({ ...f, isVirtual: false })),
    ];

    const createChip = (folder) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      // keep legacy `folder-chip` for existing code paths, add new premium class
      chip.className = 'folder-chip notebook-folder-chip';
      chip.dataset.folderId = folder.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'notebook-folder-chip-label';
      nameSpan.textContent = folder.name;
      chip.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'notebook-folder-chip-count';
      const countKey = folder.id === 'all' ? 'all' : folder.id || 'unsorted';
      const countValue = typeof noteCounts[countKey] === 'number' ? noteCounts[countKey] : 0;
      countSpan.textContent = countValue;
      chip.appendChild(countSpan);

      chip.addEventListener('click', () => {
        currentFolderId = folder.id === 'all' ? 'all' : folder.id;
        // set active class and auto-scroll
        setActiveFolderChip(currentFolderId);
        clearSearchFilter();
        // re-render notes using current filter
        renderFilteredNotes();
      });

      // For editable folders (not All or Unsorted) show overflow affordance
      if (folder.id !== 'all' && folder.id !== 'unsorted') {
        const overflowBtn = document.createElement('button');
        overflowBtn.type = 'button';
        overflowBtn.className = 'notebook-folder-chip-overflow';
        overflowBtn.setAttribute('aria-label', 'Folder options');
        overflowBtn.innerHTML = '⋯';
        overflowBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openFolderOverflowMenu(folder.id, chip);
        });
        chip.appendChild(overflowBtn);
      }

      return chip;
    };

    chipModel.forEach((folder) => {
      filterBar.appendChild(createChip(folder));
    });

    // Create a scroll wrapper for the chips
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'notebook-folder-scroll-wrap';
    scrollWrap.appendChild(filterBar);

    // Build header container: chips on the left (scrollable)
    const header = document.createElement('div');
    header.className = 'notebook-folder-header';

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'folder-chips';
    chipsWrap.appendChild(scrollWrap);

    header.appendChild(chipsWrap);

    folderBar.appendChild(header);

    // ensure active chip is visually set and scrolled into view
    setActiveFolderChip(currentFolderId);
  };

  // Build initial folder bar when the sheet opens and when notes refresh
  const initFolderBar = () => {
    try {
      buildFolderChips();
    } catch (e) {
      // If folder rendering fails, keep behavior unchanged
      console.warn('[notebook] Unable to build folder bar', e);
    }
  };

  // Ensure a floating action button (FAB) exists inside the saved notes sheet
  const ensureFloatingNewFolderFab = () => {
    if (!savedNotesSheet) return;

    // remove any legacy new-chip that might remain
    try {
      const folderBar = document.getElementById('notebook-folder-bar');
      if (folderBar) {
        const legacy = folderBar.querySelector('[data-folder-id="new-folder"], .new-folder-btn, .notebook-folder-chip--new');
        if (legacy) legacy.remove();
      }
    } catch (e) {
      /* ignore */
    }

    if (document.getElementById('fabNewFolder')) return;

    // ensure the sheet can anchor absolute children
    try {
      savedNotesSheet.style.position = savedNotesSheet.style.position || 'relative';
    } catch (e) {
      /* ignore */
    }

    const fab = document.createElement('button');
    fab.id = 'fabNewFolder';
    fab.type = 'button';
    fab.className = 'fab-new-folder';
    fab.setAttribute('aria-label', 'Create new folder');
    fab.setAttribute('title', 'Create new folder');
    fab.innerHTML = `
      <span class="fab-icon" aria-hidden="true">+</span>
      <span class="fab-label">New folder</span>
    `;
    fab.addEventListener('click', (ev) => {
      ev.preventDefault();
      try {
        openNewFolderDialog();
      } catch (err) {
        console.warn('[notebook] openNewFolderDialog() not available', err);
      }
    });

    savedNotesSheet.appendChild(fab);
  };

  /* New Folder modal setup */
  const newFolderModalEl = document.getElementById('newFolderModal');
  const newFolderNameInput = document.getElementById('newFolderName');
  const newFolderError = document.getElementById('newFolderError');
  const newFolderCreateBtn = document.getElementById('newFolderCreate');
  const newFolderCancelBtn = document.getElementById('newFolderCancel');
  let newFolderModalController = null;
  let afterFolderCreated = null;

  const clearNewFolderError = () => {
    if (!newFolderError) return;
    newFolderError.classList.add('sr-only');
    newFolderError.textContent = '';
  };

  const showNewFolderError = (msg) => {
    if (!newFolderError) return;
    newFolderError.textContent = msg;
    newFolderError.classList.remove('sr-only');
  };

  const openNewFolderDialog = () => {
    // Prefer the dedicated modal dialog for folder creation. The modal
    // markup exists in `mobile.html` and is wired below; use the
    // ModalController to handle focus trapping and accessibility.
    if (!newFolderModalEl) {
      // Safety fallback: if modal markup is missing, log and abort.
      // Avoid using `prompt()` to provide a consistent, accessible UX.
      console.warn('[notebook] #newFolderModal not found; create folder modal missing');
      return;
    }

    if (!newFolderModalController) {
      newFolderModalController = new ModalController({
        modalElement: newFolderModalEl,
        closeButton: newFolderCancelBtn,
        titleInput: newFolderNameInput,
        modalTitle: document.getElementById('newFolderTitle'),
        autoFocus: true,
      });
    }

    clearNewFolderError();
    if (newFolderNameInput) {
      newFolderNameInput.value = '';
      // autofocus will be handled by ModalController, but ensure selection
      setTimeout(() => {
        try {
          newFolderNameInput.focus();
          newFolderNameInput.select && newFolderNameInput.select();
        } catch (e) {
          /* ignore focus errors */
        }
      }, 20);
    }

    newFolderModalController.show();
  };

  const createNewFolder = () => {
    if (!newFolderNameInput) return;
    const raw = String(newFolderNameInput.value || '');
    const name = raw.trim();
    clearNewFolderError();
    if (!name.length) {
      showNewFolderError("Folder name can't be empty.");
      return;
    }

    // Load existing folders and check duplicates (case-insensitive)
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch (e) {
      folders = [];
    }
    const exists = folders.some((f) => String(f.name).toLowerCase() === name.toLowerCase());
    if (exists) {
      showNewFolderError('You already have a folder with this name.');
      return;
    }

    const folderId = `folder-${Date.now().toString(36)}`;
    const newFolder = { id: folderId, name };
    const updated = [...folders.filter(Boolean), newFolder];
    const saved = saveFolders(updated);
    if (!saved) {
      showNewFolderError('Unable to create folder. Please try again.');
      return null;
    }

    // Close modal and rebuild folder chips. Do NOT switch view or alter filters.
    try {
      newFolderModalController.requestClose('created');
    } catch { /* ignore */ }
    // Keep the current folder/filter state intact — do not auto-select the new folder
    try {
      buildFolderChips();
    } catch (e) {
      console.warn('[notebook] rebuild folder chips failed', e);
    }
    if (typeof afterFolderCreated === 'function') {
      try {
        afterFolderCreated(folderId, name);
      } catch (err) {
        console.warn('[notebook] post-create handler failed', err);
      }
      afterFolderCreated = null;
    }
    return folderId;
  };

  if (newFolderCreateBtn) {
    newFolderCreateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      createNewFolder();
    });
  }

  if (newFolderNameInput) {
    newFolderNameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        createNewFolder();
      }
    });
  }

  if (newFolderCancelBtn) {
    newFolderCancelBtn.addEventListener('click', () => {
      afterFolderCreated = null;
    });
  }

  /* Folder picker modal for assigning a folder to the note */
  const pickFolderModalEl = document.getElementById('pickFolderModal');
  const pickFolderListEl = document.getElementById('pickFolderList');
  const pickFolderConfirmBtn = document.getElementById('pickFolderConfirm');
  const pickFolderCancelBtn = document.getElementById('pickFolderCancel');
  let pickFolderController = null;
  let pickSelectionId = null;

  let pickFolderConfirmHandler = null;

  const finalizeFolderSelection = (selectedFolderId) => {
    if (!selectedFolderId) {
      return;
    }
    if (pickFolderConfirmHandler) {
      try {
        pickFolderConfirmHandler(selectedFolderId);
      } catch (e) {
        console.warn('[notebook] folder pick handler failed', e);
      }
      pickFolderConfirmHandler = null;
    } else {
      currentEditingNoteFolderId =
        selectedFolderId === 'unsorted' ? 'unsorted' : selectedFolderId;
      const labelElPick = document.getElementById('note-folder-label');
      if (labelElPick) labelElPick.textContent = getFolderNameById(currentEditingNoteFolderId);
    }
    try {
      pickFolderController?.requestClose('selected');
    } catch {}
  };

  const openFolderPicker = (options = {}) => {
    const { initialFolderId = null, onConfirm = null } = options || {};
    if (!pickFolderModalEl || !pickFolderListEl) return;
    pickSelectionId =
      (initialFolderId && typeof initialFolderId === 'string'
        ? initialFolderId
        : currentEditingNoteFolderId) || 'unsorted';
    pickFolderConfirmHandler = typeof onConfirm === 'function' ? onConfirm : null;
    // populate folders
    pickFolderListEl.innerHTML = '';
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }
    // ensure unsorted present
    if (!folders.some((f) => f && f.id === 'unsorted')) {
      folders.unshift({ id: 'unsorted', name: 'Unsorted' });
    }
    // build radio rows
    folders.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'pick-folder-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'pick-folder';
      input.value = f.id;
      input.id = `pick-folder-${f.id}`;
      const shouldCheck =
        String(f.id) === String(pickSelectionId) ||
        (!pickSelectionId && f.id === 'unsorted');
      if (shouldCheck) {
        input.checked = true;
        pickSelectionId = f.id;
        row.classList.add('is-active');
      }
      input.addEventListener('change', () => {
        pickSelectionId = input.value;
        const rows = pickFolderListEl?.querySelectorAll('.pick-folder-row') || [];
        rows.forEach((node) => {
          if (node instanceof HTMLElement) {
            node.classList.toggle('is-active', node === row);
          }
        });
      });
      const label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = f.name;
      row.appendChild(input);
      row.appendChild(label);
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        if (pickFolderConfirmHandler) {
          finalizeFolderSelection(input.value);
        }
      });
      pickFolderListEl.appendChild(row);
    });

    if (!pickFolderController) {
      pickFolderController = new ModalController({
        modalElement: pickFolderModalEl,
        closeButton: pickFolderCancelBtn,
        titleInput: null,
        autoFocus: true,
      });
    }
    pickFolderController.show();
  };

  if (pickFolderConfirmBtn) {
    pickFolderConfirmBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!pickSelectionId) {
        // nothing selected
        return;
      }
      finalizeFolderSelection(pickSelectionId);
    });
  }

  // wire folder button to open picker
  const noteFolderBtn = document.getElementById('note-folder-button');
  if (noteFolderBtn) {
    noteFolderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openFolderSelectorForNote(currentNoteId, {
        initialFolderId: currentEditingNoteFolderId,
        triggerEl: noteFolderBtn,
      });
    });
  }

  /* Folder overflow menu + rename/delete handling */
  let activeOverflowMenu = null;
  let activeOverflowTrigger = null;
  const closeOverflowMenu = () => {
    if (activeOverflowMenu && activeOverflowMenu.parentNode) {
      activeOverflowMenu.parentNode.removeChild(activeOverflowMenu);
    }
    const focusTarget =
      activeOverflowTrigger &&
      document.body.contains(activeOverflowTrigger) &&
      typeof activeOverflowTrigger.focus === 'function'
        ? activeOverflowTrigger
        : null;
    activeOverflowMenu = null;
    activeOverflowTrigger = null;
    document.removeEventListener('click', closeOverflowMenu);
    document.removeEventListener('keydown', handleOverflowKeydown);
    if (focusTarget) {
      try {
        focusTarget.focus();
      } catch {
        /* ignore focus restoration failures */
      }
    }
  };

  const handleOverflowKeydown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeOverflowMenu();
    }
    if (ev.key === 'Tab') {
      requestAnimationFrame(() => {
        if (activeOverflowMenu && !activeOverflowMenu.contains(document.activeElement)) {
          closeOverflowMenu();
        }
      });
    }
  };

  const focusFirstOverflowItem = (menuEl) => {
    if (!menuEl) return;
    const firstItem = menuEl.querySelector('button');
    if (firstItem instanceof HTMLElement) {
      setTimeout(() => {
        try {
          firstItem.focus();
        } catch {
          /* ignore focus errors */
        }
      }, 0);
    }
  };

  const handleMoveNoteToFolder = (noteId, targetFolderId) => {
    if (!noteId) return;
    const normalizedTarget = targetFolderId === 'unsorted' ? null : targetFolderId;
    const saved = assignNoteToFolder(noteId, normalizedTarget);
    if (!saved) {
      return;
    }
    try {
      refreshFromStorage({ preserveDraft: true });
    } catch (e) {
      console.warn('[notebook] failed to refresh notes after move', e);
    }
    try {
      buildFolderChips();
    } catch (e) {
      console.warn('[notebook] failed to refresh folder chips after move', e);
    }
    try {
      const targetName = getFolderNameById(normalizedTarget || 'unsorted') || 'Unsorted';
      showMoveToast(targetName);
    } catch {
      /* no-op */
    }
    if (noteId === currentNoteId) {
      currentEditingNoteFolderId = normalizedTarget || 'unsorted';
      const labelEl = document.getElementById('note-folder-label');
      if (labelEl) {
        labelEl.textContent = getFolderNameById(currentEditingNoteFolderId);
      }
    }
    closeOverflowMenu();
  };

  const FOLDER_FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const getFolderSelectorFocusables = () => {
    if (!folderSelectorSheet) return [];
    const nodes = folderSelectorSheet.querySelectorAll(FOLDER_FOCUSABLE_SELECTOR);
    return Array.from(nodes).filter(
      (node) =>
        node instanceof HTMLElement &&
        !node.hasAttribute('disabled') &&
        node.tabIndex !== -1 &&
        node.offsetParent !== null,
    );
  };

  const focusFirstFolderSelectorItem = () => {
    const focusables = getFolderSelectorFocusables();
    if (focusables.length) {
      try {
        focusables[0].focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
      return;
    }
    if (folderSelectorSheet) {
      try {
        folderSelectorSheet.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
  };

  const handleFolderSelectorKeydown = (event) => {
    if (!folderSelectorEl || folderSelectorEl.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMoveFolderSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = getFolderSelectorFocusables();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (event.shiftKey && activeEl === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeEl === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFolderSelection = (folderId) => {
    const normalized = folderId || 'unsorted';
    if (folderSelectorOnSelect) {
      folderSelectorOnSelect(normalized);
    } else if (currentFolderMoveNoteId) {
      handleMoveNoteToFolder(currentFolderMoveNoteId, normalized);
    } else {
      currentEditingNoteFolderId = normalized;
      const labelEl = document.getElementById('note-folder-label');
      if (labelEl) {
        labelEl.textContent = getFolderNameById(currentEditingNoteFolderId);
      }
    }
    closeMoveFolderSheet();
  };

  const closeMoveFolderSheet = (options = {}) => {
    const { preserveCreateHandler = false } = options || {};
    if (folderSelectorEl) {
      folderSelectorEl.classList.add('hidden');
      folderSelectorEl.setAttribute('aria-hidden', 'true');
    }
    if (folderSelectorListEl) {
      folderSelectorListEl.innerHTML = '';
    }
    currentFolderMoveNoteId = null;
    folderSelectorOnSelect = null;
    if (!preserveCreateHandler) {
      afterFolderCreated = null;
    }
    document.removeEventListener('keydown', handleFolderSelectorKeydown);
    if (noteFolderBtn) {
      noteFolderBtn.setAttribute('aria-expanded', 'false');
    }
    if (activeFolderSheetOpener instanceof HTMLElement) {
      try {
        activeFolderSheetOpener.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    activeFolderSheetOpener = null;
  };

  const openFolderSelectorForNote = (noteId, options = {}) => {
    if (!folderSelectorEl || !folderSelectorListEl) {
      return;
    }

    const { onSelect = null, initialFolderId = null, triggerEl = null } = options;
    currentFolderMoveNoteId = noteId || null;
    folderSelectorOnSelect = typeof onSelect === 'function' ? onSelect : null;
    activeFolderSheetOpener = triggerEl || document.activeElement;
    folderSelectorListEl.innerHTML = '';

    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }

    if (!folders.some((f) => f && f.id === 'unsorted')) {
      folders.unshift({ id: 'unsorted', name: 'Unsorted' });
    }

    const activeNote = noteId ? allNotes.find((n) => n.id === noteId) || null : null;
    const activeFolderId =
      initialFolderId ||
      (activeNote && typeof activeNote.folderId === 'string' && activeNote.folderId
        ? activeNote.folderId
        : currentEditingNoteFolderId || 'unsorted');

    folders.forEach((folder) => {
      if (!folder || typeof folder.id === 'undefined') return;
      const row = document.createElement('li');
      row.className = 'folder-select-row';
      row.dataset.folderId = folder.id;
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      const isActive = String(folder.id) === String(activeFolderId);
      if (isActive) {
        row.classList.add('active');
        row.setAttribute('aria-selected', 'true');
      } else {
        row.setAttribute('aria-selected', 'false');
      }
      row.textContent = folder.name || String(folder.id);
      folderSelectorListEl.appendChild(row);
    });

    folderSelectorEl.classList.remove('hidden');
    folderSelectorEl.setAttribute('aria-hidden', 'false');
    if (folderSelectorSheet) {
      try {
        folderSelectorSheet.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
    if (triggerEl === noteFolderBtn) {
      noteFolderBtn.setAttribute('aria-expanded', 'true');
    }
    document.addEventListener('keydown', handleFolderSelectorKeydown);
    focusFirstFolderSelectorItem();
  };

  if (folderSelectorListEl) {
    folderSelectorListEl.addEventListener('click', (event) => {
      const row =
        event.target instanceof HTMLElement
          ? event.target.closest('.folder-select-row')
          : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });

    folderSelectorListEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row =
        event.target instanceof HTMLElement
          ? event.target.closest('.folder-select-row')
          : null;
      if (!row || !folderSelectorListEl.contains(row)) return;
      event.preventDefault();
      handleFolderSelection(row.dataset.folderId || 'unsorted');
    });
  }

  if (folderSelectorEl) {
    folderSelectorEl.addEventListener('click', (ev) => {
      if (ev.target === folderSelectorEl) {
        ev.preventDefault();
        closeMoveFolderSheet();
      }
    });
  }

  if (folderSelectorCancelBtn) {
    folderSelectorCancelBtn.addEventListener('click', (event) => {
      event.preventDefault();
      closeMoveFolderSheet();
    });
  }

  if (folderSelectorCreateBtn) {
    folderSelectorCreateBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const pendingNoteId = currentFolderMoveNoteId || currentNoteId;
      const pendingSelectHandler = folderSelectorOnSelect;
      afterFolderCreated = (createdId) => {
        if (pendingSelectHandler) {
          pendingSelectHandler(createdId);
        } else if (pendingNoteId) {
          handleMoveNoteToFolder(pendingNoteId, createdId);
        } else {
          currentEditingNoteFolderId = createdId || 'unsorted';
          const labelEl = document.getElementById('note-folder-label');
          if (labelEl) {
            labelEl.textContent = getFolderNameById(currentEditingNoteFolderId);
          }
        }
        closeMoveFolderSheet();
      };
      closeMoveFolderSheet({ preserveCreateHandler: true });
      openNewFolderDialog();
    });
  }

  const openNoteOverflowMenu = (note, anchorEl) => {
    if (!note || !anchorEl) return;
    closeOverflowMenu();
    const menu = document.createElement('div');
    menu.className =
      'memory-glass-card p-2 rounded-2xl shadow-xl backdrop-blur-md border border-base-200/80';
    menu.style.position = 'absolute';
    menu.style.zIndex = 1200;
    menu.style.minWidth = '180px';
    menu.setAttribute('role', 'menu');

    const moveBtn = document.createElement('button');
    moveBtn.type = 'button';
    moveBtn.className = 'w-full text-left px-3 py-2 btn-ghost rounded-xl';
    moveBtn.textContent = 'Move to folder…';
    moveBtn.setAttribute('role', 'menuitem');
    moveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeOverflowMenu();
      openFolderSelectorForNote(note.id, {
        initialFolderId:
          note.folderId && typeof note.folderId === 'string' ? note.folderId : 'unsorted',
        triggerEl: moveBtn,
      });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'w-full text-left px-3 py-2 btn-ghost text-error rounded-xl';
    deleteBtn.textContent = 'Delete note';
    deleteBtn.setAttribute('role', 'menuitem');
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const confirmFn =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm
          : null;
      if (!confirmFn) {
        showNoteToast('Delete cancelled: confirmation is not available here.');
        closeOverflowMenu();
        return;
      }

      let shouldDelete = false;
      try {
        shouldDelete = confirmFn('Delete this note? This cannot be undone.');
      } catch (confirmError) {
        console.warn('Delete confirmation failed', confirmError);
        showNoteToast('Delete cancelled: confirmation is not available here.');
        closeOverflowMenu();
        return;
      }

      if (shouldDelete) {
        handleDeleteNote(note.id);
      }
      closeOverflowMenu();
    });

    menu.appendChild(moveBtn);
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    activeOverflowMenu = menu;
    activeOverflowTrigger = anchorEl instanceof HTMLElement ? anchorEl : null;

    menu.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (!next || (activeOverflowMenu && !activeOverflowMenu.contains(next))) {
        closeOverflowMenu();
      }
    });

    try {
      const rect = anchorEl.getBoundingClientRect();
      const top = rect.bottom + window.scrollY + 6;
      const left = rect.right + window.scrollX - menu.offsetWidth;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    } catch (e) {
      menu.style.top = '50%';
      menu.style.left = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
    }

    focusFirstOverflowItem(menu);
    document.addEventListener('click', closeOverflowMenu);
    document.addEventListener('keydown', handleOverflowKeydown);
  };

  // Reorder folders by swapping `order` with neighbor and normalizing
  const reorderFolder = (folderId, direction) => {
    if (!folderId || (direction !== -1 && direction !== 1)) return;
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders().slice() : [];
    } catch (e) {
      folders = [];
    }
    if (!folders.length) return;

    // Only reorder user folders (exclude 'unsorted')
    const userFolders = folders.filter((f) => f && f.id !== 'unsorted');
    // Sort by order asc
    userFolders.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const idx = userFolders.findIndex((f) => String(f.id) === String(folderId));
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= userFolders.length) return;

    // swap orders
    const tmp = userFolders[idx].order;
    userFolders[idx].order = userFolders[targetIdx].order;
    userFolders[targetIdx].order = tmp;

    // rebuild full folders array preserving unsorted and applying new orders
    const unsorted = folders.find((f) => f && f.id === 'unsorted') || { id: 'unsorted', name: 'Unsorted', order: -1 };
    const rebuilt = [unsorted, ...userFolders];

    // normalize orders to 0..N-1 (keep unsorted as  -1 or 0? We'll place unsorted first with order 0)
    const normalized = rebuilt.map((f, i) => ({ id: f.id, name: f.name, order: i }));

    try {
      const saved = saveFolders(normalized);
      if (saved) {
        try { buildFolderChips(); } catch {}
        try { renderFilteredNotes(); } catch {}
      }
    } catch (e) {
      console.warn('[notebook] reorder save failed', e);
    }
  };

  const openFolderOverflowMenu = (folderId, anchorEl) => {
    if (!folderId || folderId === 'all' || folderId === 'unsorted') return;
    closeOverflowMenu();
    const menu = document.createElement('div');
    menu.className = 'memory-glass-card p-2 rounded shadow-lg';
    menu.style.position = 'absolute';
    menu.style.zIndex = 1200;
    menu.style.minWidth = '160px';

    // Determine position to optionally disable move controls
    let _isFirst = false;
    let _isLast = false;
    try {
      const _folders = Array.isArray(getFolders()) ? getFolders().filter(Boolean) : [];
      const _user = _folders.filter((f) => f && f.id !== 'unsorted').sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const _idx = _user.findIndex((f) => String(f.id) === String(folderId));
      _isFirst = _idx === 0;
      _isLast = _idx === -1 ? true : _idx === _user.length - 1;
    } catch (e) {
      _isFirst = false;
      _isLast = false;
    }

    // Move up / Move down controls
    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveUpBtn.textContent = 'Move up';
    if (_isFirst) {
      moveUpBtn.setAttribute('disabled', '');
      moveUpBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveUpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        reorderFolder(folderId, -1);
      } catch (err) {
        console.warn('[notebook] reorder move up failed', err);
      }
      closeOverflowMenu();
    });

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveDownBtn.textContent = 'Move down';
    if (_isLast) {
      moveDownBtn.setAttribute('disabled', '');
      moveDownBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveDownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        reorderFolder(folderId, 1);
      } catch (err) {
        console.warn('[notebook] reorder move down failed', err);
      }
      closeOverflowMenu();
    });

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    renameBtn.textContent = 'Rename folder';
    renameBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openRenameDialog(folderId);
      closeOverflowMenu();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'w-full text-left px-3 py-2 btn-ghost text-accent';
    deleteBtn.textContent = 'Delete folder';
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openDeleteConfirm(folderId);
      closeOverflowMenu();
    });

    menu.appendChild(moveUpBtn);
    menu.appendChild(moveDownBtn);
    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    activeOverflowMenu = menu;
    activeOverflowTrigger = anchorEl instanceof HTMLElement ? anchorEl : null;

    // position menu under anchor
    try {
      const rect = anchorEl.getBoundingClientRect();
      const top = rect.bottom + window.scrollY + 6;
      const left = rect.left + window.scrollX;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    } catch (e) {
      // fallback: center
      menu.style.top = '50%';
      menu.style.left = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
    }

    // close handlers
    document.addEventListener('click', closeOverflowMenu);
    document.addEventListener('keydown', handleOverflowKeydown);
  };

  /* Rename folder modal wiring */
  const renameFolderModalEl = document.getElementById('renameFolderModal');
  const renameFolderNameInput = document.getElementById('renameFolderName');
  const renameFolderError = document.getElementById('renameFolderError');
  const renameFolderSaveBtn = document.getElementById('renameFolderSave');
  const renameFolderCancelBtn = document.getElementById('renameFolderCancel');
  let renameFolderController = null;
  let pendingRenameFolderId = null;

  const clearRenameError = () => {
    if (!renameFolderError) return;
    renameFolderError.classList.add('sr-only');
    renameFolderError.textContent = '';
  };
  const showRenameError = (msg) => {
    if (!renameFolderError) return;
    renameFolderError.textContent = msg;
    renameFolderError.classList.remove('sr-only');
  };

  const openRenameDialog = (folderId) => {
    if (!renameFolderModalEl || folderId === 'all' || folderId === 'unsorted') return;
    pendingRenameFolderId = folderId;
    const folders = Array.isArray(getFolders()) ? getFolders() : [];
    const found = folders.find((f) => f && String(f.id) === String(folderId));
    if (!found) return;
    if (!renameFolderController) {
      renameFolderController = new ModalController({
        modalElement: renameFolderModalEl,
        closeButton: renameFolderCancelBtn,
        titleInput: renameFolderNameInput,
        modalTitle: document.getElementById('renameFolderTitle'),
        autoFocus: true,
      });
    }
    clearRenameError();
    if (renameFolderNameInput) renameFolderNameInput.value = found.name || '';
    renameFolderController.show();
  };

  const saveRename = () => {
    if (!pendingRenameFolderId || !renameFolderNameInput) return;
    const raw = String(renameFolderNameInput.value || '');
    const name = raw.trim();
    clearRenameError();
    if (!name.length) {
      showRenameError("Folder name can't be empty.");
      return;
    }
    let folders = [];
    try { folders = Array.isArray(getFolders()) ? getFolders() : []; } catch { folders = []; }
    const duplicate = folders.some((f) => String(f.name).toLowerCase() === name.toLowerCase() && String(f.id) !== String(pendingRenameFolderId));
    if (duplicate) {
      showRenameError('You already have a folder with this name.');
      return;
    }
    const updated = folders.map((f) => (String(f.id) === String(pendingRenameFolderId) ? { ...f, name } : f));
    const saved = saveFolders(updated);
    if (!saved) {
      showRenameError('Unable to rename folder. Please try again.');
      return;
    }
    try { renameFolderController.requestClose('saved'); } catch {}
    pendingRenameFolderId = null;
    // refresh UI
    try { buildFolderChips(); } catch {}
    renderFilteredNotes();
  };

  if (renameFolderSaveBtn) {
    renameFolderSaveBtn.addEventListener('click', (e) => { e.preventDefault(); saveRename(); });
  }
  if (renameFolderNameInput) {
    renameFolderNameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveRename(); } });
  }

  /* Delete folder flow */
  const deleteFolderModalEl = document.getElementById('deleteFolderModal');
  const deleteFolderConfirmBtn = document.getElementById('deleteFolderConfirm');
  const deleteFolderCancelBtn = document.getElementById('deleteFolderCancel');
  let deleteFolderController = null;
  let pendingDeleteFolderId = null;

  const openDeleteConfirm = (folderId) => {
    if (!deleteFolderModalEl || folderId === 'all' || folderId === 'unsorted') return;
    pendingDeleteFolderId = folderId;
    if (!deleteFolderController) {
      deleteFolderController = new ModalController({
        modalElement: deleteFolderModalEl,
        closeButton: deleteFolderCancelBtn,
        titleInput: null,
        modalTitle: document.getElementById('deleteFolderTitle'),
        autoFocus: false,
      });
    }
    deleteFolderController.show();
  };

  const confirmDeleteFolder = () => {
    if (!pendingDeleteFolderId) return;
    // Remove folder and reassign notes
    let folders = [];
    try { folders = Array.isArray(getFolders()) ? getFolders() : []; } catch { folders = []; }
    const updatedFolders = folders.filter((f) => String(f.id) !== String(pendingDeleteFolderId));
    // Ensure unsorted exists
    if (!updatedFolders.some((f) => f && f.id === 'unsorted')) {
      updatedFolders.unshift({ id: 'unsorted', name: 'Unsorted' });
    }
    const saved = saveFolders(updatedFolders);
    if (!saved) {
      try { deleteFolderController.requestClose('failed'); } catch {}
      pendingDeleteFolderId = null;
      return;
    }
    // Reassign notes
    const notes = loadAllNotes();
    const updatedNotes = (Array.isArray(notes) ? notes : []).map((n) => {
      if (n && String(n.folderId) === String(pendingDeleteFolderId)) {
        return { ...n, folderId: 'unsorted', updatedAt: new Date().toISOString() };
      }
      return n;
    });
    saveAllNotes(updatedNotes);
    // If current filter was the deleted folder, switch to unsorted
    if (String(currentFolderId) === String(pendingDeleteFolderId)) {
      currentFolderId = 'unsorted';
      clearSearchFilter();
    }
    pendingDeleteFolderId = null;
    try { deleteFolderController.requestClose('deleted'); } catch {}
    buildFolderChips();
    renderFilteredNotes();
  };

  if (deleteFolderConfirmBtn) {
    deleteFolderConfirmBtn.addEventListener('click', (e) => { e.preventDefault(); confirmDeleteFolder(); });
  }

  if (listElement) {
    listElement.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const menuTrigger = target.closest('button[data-role="note-menu"]');
      if (menuTrigger && listElement.contains(menuTrigger)) {
        event.preventDefault();
        const noteId = menuTrigger.getAttribute('data-note-id');
        if (!noteId) {
          return;
        }
        const note = allNotes.find((item) => item.id === noteId);
        if (note) {
          openNoteOverflowMenu(note, menuTrigger);
        }
        return;
      }

      const openTrigger = target.closest('[data-role="open-note"]');
      if (openTrigger && listElement.contains(openTrigger)) {
        event.preventDefault();
        const noteId = openTrigger.getAttribute('data-note-id');
        if (!noteId) {
          return;
        }
        const note = allNotes.find((item) => item.id === noteId);
        if (note) {
          setEditorValues(note);
          updateListSelection();
          if (isSavedNotesSheetOpen()) {
            hideSavedNotesSheet();
          }
        }
      }
    });

    // Touch devices: ensure the overflow menu opens reliably on touch.
    listElement.addEventListener('pointerup', (event) => {
      // Only handle touch pointers here to avoid duplicate activation with mouse clicks
      if (!(event instanceof PointerEvent) || event.pointerType !== 'touch') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      const menuTrigger = target.closest('button[data-role="note-menu"]');
      if (menuTrigger && listElement.contains(menuTrigger)) {
        event.preventDefault();
        const noteId = menuTrigger.getAttribute('data-note-id');
        if (!noteId) return;
        const note = allNotes.find((item) => item.id === noteId);
        if (note) {
          openNoteOverflowMenu(note, menuTrigger);
        }
        return;
      }
    });
  }

  const renderFilteredNotes = () => {
    renderNotesList(getVisibleNotes());
  };

  if (filterInput) {
    const handleFilterInput = debounce(() => {
      filterQuery = typeof filterInput.value === 'string' ? filterInput.value : '';
      renderFilteredNotes();
    }, 180);

    filterInput.addEventListener('input', handleFilterInput);
    filterInput.addEventListener('search', handleFilterInput);
  }

  const applyInitialSelection = () => {
    refreshFromStorage({ preserveDraft: false });
  };

  saveButton.addEventListener('click', () => {
    const existingNotes = loadAllNotes();
    const notesArray = Array.isArray(existingNotes) ? [...existingNotes] : [];
    const { title, bodyHtml, bodyText } = getEditorValues();
    const noteBodyHtml = bodyHtml || '';
    const noteBodyText = bodyText || extractPlainText(noteBodyHtml);
    const sanitizedTitle = title || 'Untitled note';
    const timestamp = new Date().toISOString();
    const normalizedFolderId =
      currentEditingNoteFolderId && currentEditingNoteFolderId !== 'all'
        ? currentEditingNoteFolderId
        : 'unsorted';

    if (currentNoteId) {
      const noteIndex = notesArray.findIndex((note) => note.id === currentNoteId);
      if (noteIndex >= 0) {
        notesArray[noteIndex] = {
          ...notesArray[noteIndex],
          title: sanitizedTitle,
          body: noteBodyHtml,
          bodyHtml: noteBodyHtml,
          bodyText: noteBodyText,
          updatedAt: timestamp,
          folderId: normalizedFolderId,
        };
      } else {
        const newNote = createNote(sanitizedTitle, noteBodyHtml, {
          updatedAt: timestamp,
          folderId: normalizedFolderId,
          bodyHtml: noteBodyHtml,
          bodyText: noteBodyText,
        });
        currentNoteId = newNote.id;
        notesArray.unshift(newNote);
      }
    } else {
      const newNote = createNote(sanitizedTitle, noteBodyHtml, {
        folderId: normalizedFolderId,
        bodyHtml: noteBodyHtml,
        bodyText: noteBodyText,
      });
      currentNoteId = newNote.id;
      notesArray.unshift(newNote);
    }

    saveAllNotes(notesArray);
    updateStoredSnapshot();
    refreshFromStorage({ preserveDraft: false });
  });

  const prepareNewNote = () => {
    // Prepare editor for creating a new note. Default folder depends on selected folder chip.
    setEditorValues(null);
    // default editing folder: if a folder is selected in folder bar, use that; otherwise 'unsorted'
    currentEditingNoteFolderId = currentFolderId && currentFolderId !== 'all' ? currentFolderId : 'unsorted';
    const labelElNew = document.getElementById('note-folder-label');
    if (labelElNew) {
      labelElNew.textContent = getFolderNameById(currentEditingNoteFolderId);
    }
    updateListSelection();
    if (typeof titleInput.focus === 'function') {
      try { titleInput.focus(); } catch {}
    }
  };

  if (newButton) {
    newButton.addEventListener('click', (e) => {
      e.preventDefault();
      prepareNewNote();
    });
  }

  // Also wire the footer 'New note' floating button to the same behavior
  const footerNewNoteBtn = document.getElementById('mobile-footer-new-note');
  if (footerNewNoteBtn) {
    footerNewNoteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // switch navigation/view if needed
      try {
        // If app uses data-nav-target, attempt to activate the notebook/add-note view
        const target = footerNewNoteBtn.getAttribute('data-nav-target');
        if (target) {
          const navBtns = document.querySelectorAll('[data-nav-target]');
          navBtns.forEach((b) => b.classList.remove('active'));
          footerNewNoteBtn.classList.add('active');
        }
      } catch (err) {
        /* ignore nav activation errors */
      }
      prepareNewNote();
    });
  }

  // Autosave: debounce saving when user edits title or body
  const AUTOSAVE_DELAY = 1500; // ms
  const debouncedAutoSave = debounce(() => {
    try {
      if (!hasUnsavedChanges()) return;
      if (saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
        saveButton.click();
      }
    } catch (e) {
      /* ignore autosave errors */
    }
  }, AUTOSAVE_DELAY);

  // Listen for input changes on title and editor
  try {
    titleInput.addEventListener('input', debouncedAutoSave);
  } catch (e) {
    /* ignore */
  }

  try {
    // contenteditable should emit input events
    scratchNotesEditorElement.addEventListener('input', debouncedAutoSave);
    scratchNotesEditorElement.addEventListener('keydown', handleListShortcuts);
    scratchNotesEditorElement.addEventListener('keydown', handleFormattingShortcuts);
    // also save on blur (user leaving editor)
    scratchNotesEditorElement.addEventListener('blur', () => {
      // flush any pending autosave immediately
      debouncedAutoSave();
    });
    titleInput.addEventListener('blur', () => debouncedAutoSave());
  } catch (e) {
    /* ignore */
  }

  // Save when the page is about to unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (evt) => {
      try {
        if (hasUnsavedChanges() && saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
          // attempt to synchronously save by invoking click
          saveButton.click();
        }
      } catch (e) {
        /* ignore */
      }
    });
  }

  applyInitialSelection();

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === NOTES_STORAGE_KEY) {
        lastSerializedNotes = event.newValue ?? null;
        refreshFromStorage({ preserveDraft: true });
      }
    });

    if (!window.__memoryCueNotesWatcher) {
      window.__memoryCueNotesWatcher = window.setInterval(() => {
        const snapshot = readStoredSnapshot();
        if (snapshot !== lastSerializedNotes) {
          lastSerializedNotes = snapshot;
          refreshFromStorage({ preserveDraft: true });
        }
      }, 2000);
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileNotes, { once: true });
} else {
  initMobileNotes();
}

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
    syncStatusText: ['#mcStatusText'],
    statusIndicator: ['#mcStatus'],
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

(() => {
  const menuBtn = document.getElementById('overflowMenuBtn');
  const menu = document.getElementById('overflowMenu');

  if (!(menuBtn instanceof HTMLElement) || !(menu instanceof HTMLElement)) {
    return;
  }

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

  const updateAriaHidden = () => {
    const hidden = menu.classList.contains('hidden');
    menu.setAttribute('aria-hidden', hidden ? 'true' : 'false');
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
        /* ignore focus errors */
      }
    }
  };

  const openMenu = () => {
    if (!menu.classList.contains('hidden')) {
      return;
    }

    restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : menuBtn;
    menu.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    updateAriaHidden();
    document.addEventListener('focusin', handleFocusIn);

    if (menu.contains(document.activeElement)) {
      return;
    }

    focusFirstItem();
  };

  const closeMenu = ({ restoreFocus = true } = {}) => {
    if (menu.classList.contains('hidden')) {
      return;
    }

    menu.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    updateAriaHidden();
    document.removeEventListener('focusin', handleFocusIn);

    if (restoreFocus && restoreFocusTo instanceof HTMLElement) {
      try {
        restoreFocusTo.focus();
      } catch {
        /* ignore focus restoration errors */
      }
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

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      closeMenu({ restoreFocus: false });
    }
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') {
      return;
    }

    const items = getFocusableItems();
    if (!items.length) {
      return;
    }

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
        /* ignore focus errors */
      }
    }
  });
})();

(() => {
  const voiceAddBtn = document.getElementById('voiceAddBtn');

  if (!(voiceAddBtn instanceof HTMLElement)) {
    return;
  }

  const getVoiceBtn = () => {
    const el = document.getElementById('voiceBtn');
    return el instanceof HTMLElement ? el : null;
  };

  const syncVoiceAvailability = () => {
    const voiceBtn = getVoiceBtn();
    if (!voiceBtn) {
      return;
    }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVoiceAvailability, { once: true });
  } else {
    syncVoiceAvailability();
  }

  const startDictation = () => {
    const voiceBtn = getVoiceBtn();
    if (!voiceBtn) {
      return;
    }

    if (voiceBtn.hasAttribute('disabled') || voiceBtn.getAttribute('aria-disabled') === 'true') {
      return;
    }

    try {
      voiceBtn.focus({ preventScroll: true });
    } catch {
      try {
        voiceBtn.focus();
      } catch {
        /* ignore focus errors */
      }
    }

    try {
      voiceBtn.click();
    } catch (error) {
      console.warn('Voice add trigger failed', error);
    }
  };

  voiceAddBtn.addEventListener('click', (event) => {
    event.preventDefault();

    let didTrigger = false;
    let fallbackTimer = null;

    const startIfNeeded = () => {
      if (didTrigger) {
        return;
      }
      didTrigger = true;
      document.removeEventListener('reminder:sheet-opened', handleOpened);
      startDictation();
    };

    const handleOpened = (evt) => {
      if (evt?.detail?.trigger !== voiceAddBtn) {
        return;
      }
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
        fallbackTimer = null;
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
})();


(() => {
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
})();

(() => {
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
})();

document.addEventListener('memoryCue:remindersUpdated', (event) => {
  const totalCountEl = document.getElementById('totalCount');
  if (!totalCountEl) return;
  const total = Array.isArray(event?.detail?.items) ? event.detail.items.length : 0;
  totalCountEl.textContent = String(total);
});

// DEBUG: global listener to detect clicks on the Save Reminder button
document.addEventListener('click', (ev) => {
  try {
    const target = ev.target;
    if (!target) return;
    // If the actual element clicked is the save button or inside it
    if ((target instanceof HTMLElement && target.id === 'saveReminder') || (target instanceof Element && target.closest && target.closest('#saveReminder'))) {
      // Log and add a temporary visual indicator
      console.log('Global click detected on #saveReminder', { target });
      try {
        const flash = document.createElement('div');
        flash.textContent = 'Save clicked';
        flash.style.position = 'fixed';
        flash.style.right = '16px';
        flash.style.bottom = '16px';
        flash.style.background = 'rgba(34,197,94,0.95)';
        flash.style.color = '#fff';
        flash.style.padding = '8px 12px';
        flash.style.borderRadius = '8px';
        flash.style.zIndex = '99999';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 900);
      } catch (e) {}
    }
  } catch (e) {}
});

/* BEGIN GPT CHANGE: progressive list loading */
(function () {
  const list = document.getElementById('reminderList');
  if (!list) return;

  const all = Array.from(list.children);
  if (all.length <= 30) return;
  const PAGE_SIZE = 20;
  list.innerHTML = '';
  let index = 0;

  function appendPage() {
    const slice = all.slice(index, index + PAGE_SIZE);
    slice.forEach((node) => list.appendChild(node));
    index += slice.length;
  }

  appendPage();
  const sentinel = document.createElement('div');
  sentinel.id = 'listSentinel';
  list.appendChild(sentinel);

  const io = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && index < all.length) {
      appendPage();
      if (index >= all.length) io.disconnect();
    }
  });
  io.observe(sentinel);
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: settings modal wiring */
(function () {
  const openButtons = Array.from(
    new Set([
      ...Array.from(document.querySelectorAll('[data-open="settings"]')),
      ...Array.from(document.querySelectorAll('#openSettings')),
    ])
  ).filter((btn) => btn instanceof HTMLElement);
  const modal = document.getElementById('settingsModal');
  const closeBtn = document.getElementById('closeSettings');
  if (!openButtons.length || !modal || !closeBtn) return;

  function open() {
    modal.classList.remove('hidden');
  }
  function close() {
    modal.classList.add('hidden');
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
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: sync controls */
(function () {
  const statusContainer = document.getElementById('syncStatus');
  const statusDotEl = document.getElementById('mcStatus');
  const statusTextEl = document.getElementById('mcStatusText');
  const syncUrlInput = document.getElementById('syncUrl');
  const saveSettingsBtn = document.getElementById('saveSyncSettings');
  const testSyncBtn = document.getElementById('testSync');
  const syncAllBtn = document.getElementById('syncAll');
  const STORAGE_KEY = 'syncUrl';

  if (!statusTextEl) return;

  const ACTIVE_CLASSES = ['online', 'offline', 'error'];
  const DOT_CLASSES = ['online', 'offline'];
  const DEFAULT_MESSAGES = {
    checking: 'Checking connection…',
    syncing: 'Syncing your latest changes…',
    online: 'Connected. Changes sync automatically.',
    offline:
      "You're offline. Changes are saved on this device until you reconnect.",
    error: "We couldn't sync right now. We'll retry soon.",
    info: '',
  };

  const DISPLAY_MESSAGES = {
    checking: 'Checking…',
    syncing: 'Syncing…',
    online: 'Synced. Auto-save on.',
    offline: 'Offline. Saving locally.',
    error: 'Sync issue. Retrying.',
    info: '',
  };

  let currentState = null;

  function applyDotState(state) {
    if (!statusDotEl) return;
    DOT_CLASSES.forEach((cls) => statusDotEl.classList.remove(cls));
    const isOnline = state !== 'offline' && state !== 'error';
    statusDotEl.classList.add(isOnline ? 'online' : 'offline');
    statusDotEl.setAttribute('aria-label', isOnline ? 'Online' : 'Offline');
  }

  function setStatus(state, message) {
    currentState = state;
    ACTIVE_CLASSES.forEach((cls) => statusTextEl.classList.remove(cls));
    if (statusContainer) {
      ACTIVE_CLASSES.forEach((cls) => statusContainer.classList.remove(cls));
    }

    if (state === 'online') {
      statusTextEl.classList.add('online');
      if (statusContainer) statusContainer.classList.add('online');
    } else if (state === 'error') {
      statusTextEl.classList.add('error');
      if (statusContainer) statusContainer.classList.add('error');
    } else {
      statusTextEl.classList.add('offline');
      if (statusContainer) statusContainer.classList.add('offline');
    }

    const fullText =
      typeof message === 'string' && message.trim()
        ? message.trim()
        : DEFAULT_MESSAGES[state] || '';

    const displayText =
      typeof message === 'string' && message.trim()
        ? message.trim()
        : DISPLAY_MESSAGES[state] || fullText;

    const srText = fullText || displayText || '';
    statusTextEl.textContent = srText;

    if (srText) {
      statusTextEl.setAttribute('title', srText);
      statusTextEl.setAttribute('aria-label', srText);
    } else {
      statusTextEl.removeAttribute('title');
      statusTextEl.removeAttribute('aria-label');
    }

    applyDotState(state);

    statusTextEl.dataset.state = state;
  }

  function updateOnlineState() {
    if (currentState === 'syncing') return;
    setStatus(navigator.onLine ? 'online' : 'offline');
  }

  function persistUrl(value) {
    if (typeof localStorage === 'undefined') return;
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function getStoredUrl() {
    if (typeof localStorage === 'undefined') return '';
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function normaliseReminder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id || raw.uid || raw.key || raw.slug || raw.uuid;
    const title = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : (typeof raw.name === 'string' ? raw.name.trim() : '');
    if (!title) return null;

    const dueIso = typeof raw.dueIso === 'string' && raw.dueIso
      ? raw.dueIso
      : (typeof raw.due === 'string' ? raw.due : null);

    const priority = typeof raw.priority === 'string' && raw.priority.trim()
      ? raw.priority.trim()
      : (raw.level || raw.importance || 'Medium');

    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : (raw.group || raw.bucket || 'General');

    const done = typeof raw.done === 'boolean'
      ? raw.done
      : Boolean(raw.completed || raw.isDone || raw.status === 'done');

    return {
      id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      title,
      dueIso: dueIso && dueIso.trim() ? dueIso.trim() : null,
      priority,
      category,
      done,
    };
  }

  function collectFromDom() {
    const elements = Array.from(document.querySelectorAll('[data-reminder]'));
    if (!elements.length) return [];

    return elements
      .map((el) => {
        const dataset = el.dataset || {};
        let raw = null;

        if (dataset.reminder) {
          try {
            raw = JSON.parse(dataset.reminder);
          } catch {
            raw = null;
          }
        }

        const candidate = raw || {
          id: dataset.id || dataset.reminderId || el.getAttribute('data-id') || null,
          title: dataset.title || dataset.reminderTitle || '',
          dueIso: dataset.due || dataset.reminderDue || el.getAttribute('data-due') || null,
          priority: dataset.priority || dataset.reminderPriority || el.getAttribute('data-priority') || '',
          category: dataset.category || dataset.reminderCategory || el.getAttribute('data-category') || '',
          done: dataset.done === 'true' || dataset.reminderDone === 'true' || el.getAttribute('data-done') === 'true',
        };

        if (!candidate.title) {
          const titleEl = el.querySelector('[data-reminder-title], [data-title], h3, h4, strong');
          if (titleEl) {
            candidate.title = titleEl.textContent.trim();
          }
        }

        if (!candidate.dueIso) {
          const dueEl = el.querySelector('[data-due], time');
          if (dueEl) {
            const attr = dueEl.getAttribute('datetime') || dueEl.getAttribute('data-due');
            candidate.dueIso = attr || dueEl.textContent.trim();
          }
        }

        return normaliseReminder(candidate);
      })
      .filter(Boolean);
  }

  function collectFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    const reminders = [];
    const triedKeys = new Set();
    const preferredKeys = [
      'memoryCue.reminders.v1',
      'memoryCue.reminders',
      'memoryCueMobile.reminders',
      'memoryCue.reminders.cache',
      'reminders',
    ];

    preferredKeys.forEach((key) => {
      if (triedKeys.has(key)) return;
      triedKeys.add(key);
      try {
        const value = localStorage.getItem(key);
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => reminders.push(item));
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
          if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
        }
      } catch {
        // ignore invalid storage entries
      }
    });

    if (!reminders.length) {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || triedKeys.has(key) || !/remind/i.test(key)) continue;
        triedKeys.add(key);
        try {
          const value = localStorage.getItem(key);
          if (!value) continue;
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => reminders.push(item));
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
            if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
          }
        } catch {
          // ignore
        }
      }
    }

    return reminders.map(normaliseReminder).filter(Boolean);
  }

  function collectReminders() {
    const fromDom = collectFromDom();
    if (fromDom.length) return fromDom;
    return collectFromStorage();
  }

  function toggleBusy(isBusy) {
    if (isBusy) {
      syncAllBtn?.setAttribute('aria-busy', 'true');
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('aria-busy', 'true');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    } else {
      syncAllBtn?.removeAttribute('aria-busy');
      testSyncBtn?.removeAttribute('aria-busy');
      updateButtonState();
    }
  }

  function updateButtonState() {
    const hasUrl = Boolean((syncUrlInput?.value || '').trim() || getStoredUrl());
    if (hasUrl) {
      syncAllBtn?.removeAttribute('disabled');
      testSyncBtn?.removeAttribute('disabled');
    } else {
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    }
  }

  const storedUrl = getStoredUrl();
  if (syncUrlInput && storedUrl) {
    syncUrlInput.value = storedUrl;
  }

  updateButtonState();
  setStatus(navigator.onLine ? 'online' : 'offline');

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  syncUrlInput?.addEventListener('input', updateButtonState);

  saveSettingsBtn?.addEventListener('click', () => {
    const value = (syncUrlInput?.value || '').trim();
    if (!value) {
      persistUrl('');
      setStatus('info', 'Sync URL cleared. Add one to enable sync.');
      updateButtonState();
      return;
    }

    try {
      const parsed = new URL(value);
      if (!/^https?:/.test(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      setStatus('error', 'Enter a valid sync URL before saving.');
      return;
    }

    persistUrl(value);
    setStatus('online', 'Sync settings saved.');
    updateButtonState();
  });

  testSyncBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your sync URL in Settings first.');
      return;
    }

    toggleBusy(true);
    setStatus('syncing', 'Testing connection…');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      if (response.ok) {
        setStatus('online', 'Connection looks good.');
      } else {
        setStatus('error', 'Test failed. Check your Apps Script deployment.');
      }
    } catch (error) {
      console.error('Test sync failed', error);
      setStatus('error', 'Test failed. Check your Apps Script deployment.');
    } finally {
      toggleBusy(false);
    }
  });

  syncAllBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your sync URL in Settings first.');
      return;
    }

    const reminders = collectReminders();
    if (!reminders.length) {
      setStatus('info', 'Nothing to sync right now.');
      return;
    }

    toggleBusy(true);
    setStatus('syncing', `Syncing ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}…`);

    const chunkSize = 20;
    let okCount = 0;
    let failCount = 0;

    const makePayload = (reminder) => ({
      id: reminder.id,
      title: reminder.title,
      dueIso: reminder.dueIso || null,
      priority: reminder.priority || 'Medium',
      category: reminder.category || 'General',
      done: Boolean(reminder.done),
      source: 'memory-cue-mobile',
    });

    try {
      for (let index = 0; index < reminders.length; index += chunkSize) {
        const slice = reminders.slice(index, index + chunkSize);
        const results = await Promise.allSettled(slice.map((reminder) => (
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makePayload(reminder)),
          })
        )));

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.ok) {
            okCount += 1;
          } else if (result.status === 'fulfilled') {
            failCount += 1;
          } else {
            failCount += 1;
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (!failCount) {
        setStatus('online', `Sync complete. ${okCount} updated.`);
      } else if (!okCount) {
        setStatus('error', 'Sync failed. Check your sync URL and retry.');
      } else {
        setStatus('error', `Partial sync: ${okCount} success, ${failCount} failed.`);
      }
    } catch (error) {
      console.error('Sync failed', error);
      setStatus('error', 'Sync failed. Try again soon.');
    } finally {
      toggleBusy(false);
    }
  });
})();
/* END GPT CHANGE */
