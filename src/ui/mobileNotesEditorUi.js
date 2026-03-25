export const initMobileNotesEditorUi = (options = {}) => {
  if (typeof document === 'undefined') {
    return {
      openNoteEditorForNewNote: () => {},
      startNewNoteFromUI: () => {},
    };
  }

  const {
    saveButton = null,
    titleInput = null,
    scratchNotesEditorElement = null,
    footerNewNoteBtn = null,
    newNoteButton = null,
    fabNewNoteButton = null,
    debounce = (fn) => fn,
    createNote = () => ({}),
    loadAllNotes = () => [],
    saveAllNotes = () => {},
    getEditorBodyHtml = () => '',
    getEditorBodyText = () => '',
    getCurrentNoteId = () => null,
    setCurrentNoteId = () => {},
    getCurrentFolderId = () => 'all',
    getCurrentEditingNoteFolderId = () => 'unsorted',
    setCurrentEditingNoteFolderId = () => {},
    getCurrentNoteIsNew = () => false,
    setCurrentNoteIsNew = () => {},
    getCurrentNoteHasChanged = () => false,
    setCurrentNoteHasChanged = () => {},
    hasMeaningfulContent = () => false,
    hasUnsavedChanges = () => false,
    resetEditorScroll = () => {},
    setEditorValues = () => {},
    updateListSelection = () => {},
    updateStoredSnapshot = () => {},
    refreshFromStorage = () => {},
    syncNoteFolderButtonLabel = () => {},
    updateToolbarState = () => {},
    handleListShortcuts = () => {},
    handleFormattingShortcuts = () => {},
  } = options;

  const openNoteEditorForNewNote = (note) => {
    if (!note) return;
    const nextFolderId =
      note.folderId && typeof note.folderId === 'string' ? note.folderId : 'everyday';
    setCurrentEditingNoteFolderId(nextFolderId);
    syncNoteFolderButtonLabel(nextFolderId);
    resetEditorScroll();
    setEditorValues(note, { isNew: true });
    updateListSelection();
  };

  const startNewNoteFromUI = () => {
    const timestamp = new Date().toISOString();
    const activeFolderId = getCurrentFolderId() && getCurrentFolderId() !== 'all'
      ? getCurrentFolderId()
      : 'everyday';
    const draftNote = createNote('', '', { folderId: activeFolderId, updatedAt: timestamp });
    const newNote = {
      ...draftNote,
      title: '',
      body: '',
      bodyHtml: '',
      bodyText: '',
      updatedAt: timestamp,
      folderId: activeFolderId,
    };
    openNoteEditorForNewNote(newNote);
  };

  saveButton?.addEventListener('click', () => {
    if (getCurrentNoteIsNew() && !getCurrentNoteHasChanged() && !hasMeaningfulContent()) {
      return;
    }

    const existingNotes = loadAllNotes();
    const notesArray = Array.isArray(existingNotes) ? [...existingNotes] : [];
    const noteBodyHtml = getEditorBodyHtml() || '';
    const noteBodyText = getEditorBodyText(noteBodyHtml);
    const rawTitle = typeof titleInput?.value === 'string' ? titleInput.value.trim() : '';
    const sanitizedTitle = rawTitle || 'Untitled note';
    const timestamp = new Date().toISOString();
    const normalizedFolderId =
      getCurrentEditingNoteFolderId() && getCurrentEditingNoteFolderId() !== 'all'
        ? getCurrentEditingNoteFolderId()
        : 'everyday';
    const currentNoteId = getCurrentNoteId();

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
          bodyText: noteBodyText,
        });
        setCurrentNoteId(newNote.id);
        notesArray.unshift(newNote);
      }
    } else {
      const newNote = createNote(sanitizedTitle, noteBodyHtml, {
        folderId: normalizedFolderId,
        bodyText: noteBodyText,
      });
      setCurrentNoteId(newNote.id);
      notesArray.unshift(newNote);
    }

    saveAllNotes(notesArray);
    updateStoredSnapshot();
    setCurrentNoteIsNew(false);
    setCurrentNoteHasChanged(false);
    refreshFromStorage({ preserveDraft: false });
  });

  footerNewNoteBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    try {
      const target = footerNewNoteBtn.getAttribute('data-nav-target');
      if (target) {
        const navBtns = document.querySelectorAll('[data-nav-target]');
        navBtns.forEach((button) => button.classList.remove('active'));
        footerNewNoteBtn.classList.add('active');
      }
    } catch {
      /* ignore nav activation errors */
    }
    startNewNoteFromUI();
  });

  newNoteButton?.addEventListener('click', (event) => {
    event.preventDefault();
    startNewNoteFromUI();
  });

  fabNewNoteButton?.addEventListener('click', () => {
    startNewNoteFromUI();
  });

  const AUTOSAVE_DELAY = 1500;
  const debouncedAutoSave = debounce(() => {
    try {
      if (getCurrentNoteIsNew() && !getCurrentNoteHasChanged()) {
        return;
      }
      if (!hasUnsavedChanges()) return;
      if (saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
        saveButton.click();
      }
    } catch {
      /* ignore autosave errors */
    }
  }, AUTOSAVE_DELAY);

  const handleNoteEditorInput = () => {
    if (getCurrentNoteIsNew()) {
      if (!hasMeaningfulContent()) {
        setCurrentNoteHasChanged(false);
        return;
      }
      setCurrentNoteHasChanged(true);
    } else {
      setCurrentNoteHasChanged(true);
    }
    debouncedAutoSave();
  };

  try {
    titleInput?.addEventListener('input', handleNoteEditorInput);
  } catch {
    /* ignore */
  }

  try {
    scratchNotesEditorElement?.addEventListener('input', debouncedAutoSave);
    scratchNotesEditorElement?.addEventListener('input', updateToolbarState);
    scratchNotesEditorElement?.addEventListener('keyup', updateToolbarState);
    scratchNotesEditorElement?.addEventListener('mouseup', updateToolbarState);
    scratchNotesEditorElement?.addEventListener('keydown', handleListShortcuts);
    scratchNotesEditorElement?.addEventListener('keydown', handleFormattingShortcuts);
    scratchNotesEditorElement?.addEventListener('blur', () => {
      debouncedAutoSave();
    });
    titleInput?.addEventListener('blur', () => debouncedAutoSave());
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      try {
        if (hasUnsavedChanges() && saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
          saveButton.click();
        }
      } catch {
        /* ignore */
      }
    });
  }

  return {
    openNoteEditorForNewNote,
    startNewNoteFromUI,
  };
};
