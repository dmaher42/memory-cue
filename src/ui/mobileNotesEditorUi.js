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

  const resizeTitleInput = () => {
    if (!(titleInput instanceof HTMLElement) || titleInput.tagName !== 'TEXTAREA') {
      return;
    }

    const styles = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(titleInput)
      : null;
    const readPixels = (value) => Number.parseFloat(value) || 0;
    const fontSize = readPixels(styles?.fontSize) || 15;
    const lineHeight = readPixels(styles?.lineHeight) || fontSize * 1.25;
    const frameHeight = readPixels(styles?.paddingTop)
      + readPixels(styles?.paddingBottom)
      + readPixels(styles?.borderTopWidth)
      + readPixels(styles?.borderBottomWidth);
    const minimumHeight = lineHeight + frameHeight;
    const maximumHeight = (lineHeight * 2) + frameHeight;

    titleInput.style.height = 'auto';
    const measuredHeight = Number(titleInput.scrollHeight) || minimumHeight;
    titleInput.style.height = `${Math.ceil(Math.max(minimumHeight, Math.min(measuredHeight, maximumHeight)))}px`;
    titleInput.style.overflowY = measuredHeight > maximumHeight + 0.5 ? 'auto' : 'hidden';
  };

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

  const persistCurrentNote = ({ refreshAfterSave = true, saveOptions = {} } = {}) => {
    if (getCurrentNoteIsNew() && !getCurrentNoteHasChanged() && !hasMeaningfulContent()) {
      return false;
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
    // A local-only save (autosave) hasn't reached Firestore yet, so flag it so a remote
    // snapshot won't revert it. A save that also pushes to remote clears the flag.
    const pendingSync = Boolean(saveOptions.skipRemoteSync);

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
          pendingSync,
        };
      } else {
        const newNote = createNote(sanitizedTitle, noteBodyHtml, {
          updatedAt: timestamp,
          folderId: normalizedFolderId,
          bodyText: noteBodyText,
          pendingSync,
        });
        setCurrentNoteId(newNote.id);
        notesArray.unshift(newNote);
      }
    } else {
      const newNote = createNote(sanitizedTitle, noteBodyHtml, {
        folderId: normalizedFolderId,
        bodyText: noteBodyText,
        pendingSync,
      });
      setCurrentNoteId(newNote.id);
      notesArray.unshift(newNote);
    }

    const saved = saveAllNotes(notesArray, saveOptions);
    if (!saved) {
      return false;
    }
    updateStoredSnapshot();
    setCurrentNoteIsNew(false);
    setCurrentNoteHasChanged(false);
    if (titleInput instanceof HTMLElement) {
      titleInput.dataset.noteOriginalTitle = rawTitle;
    }
    if (scratchNotesEditorElement instanceof HTMLElement) {
      scratchNotesEditorElement.dataset.noteOriginalBody = noteBodyHtml;
    }
    if (refreshAfterSave) {
      refreshFromStorage({ preserveDraft: false });
    }
    return true;
  };

  saveButton?.addEventListener('click', () => {
    persistCurrentNote({ refreshAfterSave: true });
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
        persistCurrentNote({
          refreshAfterSave: false,
          saveOptions: { skipNotesUpdatedEvent: true, skipRemoteSync: true },
        });
      }
    } catch {
      /* ignore autosave errors */
    }
  }, AUTOSAVE_DELAY);

  // Persist any pending autosave immediately (used before switching/closing notes so the
  // debounced save can't fire later against a different note and lose the current edits).
  // The save stays local-only (marked pendingSync); the sync layer propagates it to
  // Firestore on the next pull so a remote snapshot can't revert it in the meantime.
  const flushAutoSave = () => {
    try {
      if (typeof debouncedAutoSave.cancel === 'function') {
        debouncedAutoSave.cancel();
      }
      if (getCurrentNoteIsNew() && !getCurrentNoteHasChanged()) {
        return;
      }
      if (!hasUnsavedChanges()) return;
      if (saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
        persistCurrentNote({
          refreshAfterSave: false,
          saveOptions: { skipNotesUpdatedEvent: true, skipRemoteSync: true },
        });
      }
    } catch {
      /* ignore autosave errors */
    }
  };

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

  let toolbarStateUpdatePending = false;
  const scheduleToolbarStateUpdate = () => {
    if (toolbarStateUpdatePending) {
      return;
    }
    toolbarStateUpdatePending = true;
    const runUpdate = () => {
      toolbarStateUpdatePending = false;
      updateToolbarState();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(runUpdate);
      return;
    }
    setTimeout(runUpdate, 0);
  };

  try {
    titleInput?.addEventListener('input', () => {
      resizeTitleInput();
      handleNoteEditorInput();
    });
    titleInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      scratchNotesEditorElement?.focus();
    });
  } catch {
    /* ignore */
  }

  try {
    scratchNotesEditorElement?.addEventListener('input', handleNoteEditorInput);
    scratchNotesEditorElement?.addEventListener('input', scheduleToolbarStateUpdate);
    scratchNotesEditorElement?.addEventListener('keyup', scheduleToolbarStateUpdate);
    scratchNotesEditorElement?.addEventListener('mouseup', scheduleToolbarStateUpdate);
    scratchNotesEditorElement?.addEventListener('keydown', handleListShortcuts);
    scratchNotesEditorElement?.addEventListener('keydown', handleFormattingShortcuts);
    // Input already schedules autosave. Do not force a whole-notebook save merely because
    // focus moved between the title, body, or formatting toolbar. Real note switches still
    // call flushAutoSave explicitly before replacing the editor contents.
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined') {
    const scheduleTitleResize = () => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(resizeTitleInput);
        return;
      }
      setTimeout(resizeTitleInput, 0);
    };
    window.addEventListener('resize', scheduleTitleResize);
    window.addEventListener('memorycue:navigation:changed', (event) => {
      if (event?.detail?.view === 'notebooks') {
        scheduleTitleResize();
      }
    });

    const persistBeforeSuspension = () => {
      flushAutoSave();
    };
    window.addEventListener('pagehide', persistBeforeSuspension);
    window.addEventListener('beforeunload', persistBeforeSuspension);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        persistBeforeSuspension();
      }
    });
  }

  return {
    openNoteEditorForNewNote,
    startNewNoteFromUI,
    flushAutoSave,
    resizeTitleInput,
  };
};
