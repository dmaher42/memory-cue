import { initViewportHeight } from './js/modules/viewport-height.js';
import { initReminders } from './js/reminders.js';
import { initSupabaseAuth } from './js/supabase-auth.js';
import {
  loadAllNotes,
  saveAllNotes,
  createNote,
  NOTES_STORAGE_KEY,
} from './js/modules/notes-storage.js';
import { initNotesSync } from './js/modules/notes-sync.js';

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

      dispatchSheetEvent('reminder:sheet-opened', { trigger: lastTrigger });
    };

    const closeSheet = (reason = 'dismissed') => {
      const wasOpen = !sheet.classList.contains('hidden');
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

const initMobileNotes = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const titleInput = document.getElementById('noteTitleMobile');
  const bodyInput = document.getElementById('noteBodyMobile');
  const saveButton = document.getElementById('noteSaveMobile');
  const newButton = document.getElementById('noteNewMobile');
  const listElement = document.getElementById('notesListMobile');
  const countElement = document.getElementById('notesCountMobile');
  const filterInput = document.getElementById('notesFilterMobile');
  const savedNotesSheet = document.getElementById('savedNotesSheet');
  const openSavedNotesButton = document.querySelector('[data-action="open-saved-notes"]');
  const closeSavedNotesButton = document.querySelector('[data-action="close-saved-notes"]');

  if (!titleInput || !bodyInput || !saveButton) {
    return;
  }

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
  let filterQuery = '';
  let skipAutoSelectOnce = false;
  let savedNotesSheetHideTimeout = null;

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
      const body = typeof note?.body === 'string' ? note.body.toLowerCase() : '';
      return title.includes(normalizedQuery) || body.includes(normalizedQuery);
    });
  };

  const setEditorValues = (note) => {
    if (!note) {
      currentNoteId = null;
      titleInput.value = '';
      bodyInput.value = '';
      delete titleInput.dataset.noteOriginalTitle;
      delete bodyInput.dataset.noteOriginalBody;
      return;
    }
    currentNoteId = note.id;
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
    titleInput.dataset.noteOriginalTitle = note.title || '';
    bodyInput.dataset.noteOriginalBody = note.body || '';
  };

  const updateListSelection = () => {
    if (!listElement) {
      return;
    }
    const buttons = listElement.querySelectorAll(
      'button[data-role="open-note"][data-note-id]'
    );
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
    const currentBody = typeof bodyInput.value === 'string' ? bodyInput.value : '';
    const originalTitle = titleInput.dataset.noteOriginalTitle ?? '';
    const originalBody = bodyInput.dataset.noteOriginalBody ?? '';
    return currentTitle !== originalTitle || currentBody !== originalBody;
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
    const shouldPreserveEditor = preserveDraft && hasUnsavedChanges();
    const hasAnyNotes = allNotes.length > 0;
    const visibleNotes = getFilteredNotes();

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

  const renderNotesList = (notes = []) => {
    if (!listElement) {
      return notes;
    }

    listElement.innerHTML = '';

    if (countElement) {
      const totalSaved = allNotes.length;
      countElement.textContent = `${totalSaved} saved`;
    }

    if (!notes.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'text-xs italic text-base-content/60 px-1';
      emptyItem.textContent =
        allNotes.length && getNormalizedFilterQuery()
          ? 'No notes match this filter.'
          : 'No saved notes yet.';
      listElement.appendChild(emptyItem);
      return notes;
    }

    notes.forEach((note) => {
      const listItem = document.createElement('li');
      listItem.className = 'note-item-mobile';

      const row = document.createElement('div');
      row.className = 'flex items-stretch gap-1';

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.noteId = note.id;
      button.dataset.role = 'open-note';
      button.className =
        'flex-1 text-left rounded-xl border border-base-200/70 bg-base-100 px-3 py-2.5 flex flex-col gap-0.5 active:scale-[0.99] transition-transform';

      const headerRow = document.createElement('div');
      headerRow.className = 'flex items-center justify-between gap-2';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'text-[0.82rem] font-medium truncate';
      titleSpan.textContent = note.title || 'Untitled note';
      headerRow.appendChild(titleSpan);

      const timestampText = formatNoteTimestamp(note.updatedAt || note.createdAt);
      if (timestampText) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'text-[0.7rem] text-base-content/50 whitespace-nowrap';
        dateSpan.textContent = timestampText;
        headerRow.appendChild(dateSpan);
      }

      const preview = document.createElement('p');
      preview.className = 'text-[0.75rem] text-base-content/60 line-clamp-2';
      const bodyText =
        typeof note.body === 'string' ? note.body.replace(/\s+/g, ' ').trim() : '';
      preview.textContent = bodyText || 'No body text yet.';

      button.appendChild(headerRow);
      button.appendChild(preview);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.dataset.noteId = note.id;
      deleteButton.dataset.role = 'delete-note';
      deleteButton.className =
        'shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-base-200/80 text-base-content/60 text-xs active:scale-95';
      deleteButton.setAttribute('aria-label', 'Delete note');
      deleteButton.textContent = '✕';

      row.appendChild(button);
      row.appendChild(deleteButton);
      listItem.appendChild(row);
      listElement.appendChild(listItem);
    });

    updateListSelection();
    return notes;
  };

  if (listElement) {
    listElement.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const deleteTrigger = target.closest('button[data-role="delete-note"]');
      if (deleteTrigger && listElement.contains(deleteTrigger)) {
        event.preventDefault();
        const noteId = deleteTrigger.getAttribute('data-note-id');
        if (!noteId) {
          return;
        }
        const confirmFn =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm
            : null;
        const shouldDelete = confirmFn
          ? confirmFn('Delete this note? This cannot be undone.')
          : true;
        if (shouldDelete) {
          handleDeleteNote(noteId);
        }
        return;
      }

      const openTrigger = target.closest('button[data-role="open-note"]');
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
  }

  const renderFilteredNotes = () => {
    renderNotesList(getFilteredNotes());
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
    updateStoredSnapshot();
    refreshFromStorage({ preserveDraft: false });
  });

  if (newButton) {
    newButton.addEventListener('click', () => {
      setEditorValues(null);
      updateListSelection();
      if (typeof titleInput.focus === 'function') {
        titleInput.focus();
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
    feedback: '#auth-feedback',
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
