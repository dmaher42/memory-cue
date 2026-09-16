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
    requestReflection = async () => { throw new Error('AI unavailable'); },
  } = options;

  const buildAutomaticNoteTitle = (bodyText = '') => {
    const normalizedText = String(bodyText).replace(/\s+/g, ' ').trim();
    const maximumLength = 72;
    if (!normalizedText || normalizedText.length <= maximumLength) {
      return normalizedText;
    }

    const clippedText = normalizedText.slice(0, maximumLength - 3).trimEnd();
    const lastWordBreak = clippedText.lastIndexOf(' ');
    const titleText = lastWordBreak >= 40 ? clippedText.slice(0, lastWordBreak) : clippedText;
    return `${titleText.trimEnd()}...`;
  };

  const resizeTitleInput = () => {
    if (
      !(titleInput instanceof HTMLElement)
      || titleInput.tagName !== 'TEXTAREA'
      || titleInput.hidden
    ) {
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
      note.folderId && typeof note.folderId === 'string' ? note.folderId : 'unsorted';
    setCurrentEditingNoteFolderId(nextFolderId);
    syncNoteFolderButtonLabel(nextFolderId);
    resetEditorScroll();
    setEditorValues(note, { isNew: true });
    updateListSelection();
  };

  const startNewNoteFromUI = () => {
    const timestamp = new Date().toISOString();
    const activeFolderId = getCurrentFolderId() && getCurrentFolderId() !== 'all'
      && getCurrentFolderId() !== 'unsorted'
      ? getCurrentFolderId()
      : null;
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
    const automaticTitle = rawTitle ? '' : buildAutomaticNoteTitle(noteBodyText);
    const sanitizedTitle = rawTitle || automaticTitle || 'Untitled note';
    const timestamp = new Date().toISOString();
    const normalizedFolderId =
      getCurrentEditingNoteFolderId() && getCurrentEditingNoteFolderId() !== 'all'
        && getCurrentEditingNoteFolderId() !== 'unsorted'
        ? getCurrentEditingNoteFolderId()
        : null;
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
      titleInput.value = sanitizedTitle;
      titleInput.dataset.noteOriginalTitle = sanitizedTitle;
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

  const reflectionPanel = document.getElementById('noteReflection');
  if (reflectionPanel) {
    const allButton = document.getElementById('reflectionAll');
    const selectedButton = document.getElementById('reflectionSelection');
    const keepButton = document.getElementById('reflectionKeep');
    const undoButton = document.getElementById('reflectionUndo');
    const polished = document.getElementById('reflectionPolished');
    const scopeLabel = document.getElementById('reflectionScope');
    const status = document.getElementById('reflectionStatus');
    let selectionText = '';
    let draft = null;
    let busy = false;
    let generation = 0;
    const current = () => loadAllNotes().find((note) => note.id === getCurrentNoteId());
    const render = () => {
      const saved = current()?.metadata?.reflection;
      const version = draft || saved;
      polished.textContent = version?.text || '';
      scopeLabel.textContent = version?.text
        ? `${draft ? 'Preview' : 'Saved'}${version.scope === 'selection' ? ' · Selection' : ''}` : '';
      allButton.disabled = busy;
      selectedButton.disabled = busy || !selectionText;
      selectedButton.hidden = !selectionText;
      keepButton.disabled = busy || !draft;
      undoButton.disabled = busy || (!draft && !saved?.history?.length);
      keepButton.hidden = !draft;
      undoButton.hidden = !draft && !saved?.history?.length;
    };
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (scratchNotesEditorElement.contains(range.commonAncestorContainer)) {
          selectionText = selection.toString();
          render();
          return;
        }
      }
      // Keep a selection while its action button takes focus, but clear it on a new caret.
      if (document.activeElement === scratchNotesEditorElement) {
        selectionText = '';
        render();
      }
    });
    [allButton, selectedButton].forEach((button) => button.addEventListener('mousedown', (event) => event.preventDefault()));
    const organise = async (scope) => {
      if (busy || scratchNotesEditorElement.getAttribute('aria-readonly') === 'true') return;
      const sourceText = scope === 'selection' ? selectionText : getEditorBodyText(getEditorBodyHtml());
      if (!sourceText.trim()) { status.textContent = 'No writing yet.'; return; }
      if (sourceText.length > 12000) { status.textContent = 'Too long — select up to 12,000 characters.'; return; }
      if (!persistCurrentNote({ refreshAfterSave: false })) {
        status.textContent = 'Could not save your original. Try again.';
        return;
      }
      const noteId = getCurrentNoteId();
      const originalBody = getEditorBodyHtml();
      const token = ++generation;
      busy = true;
      status.textContent = 'Organising…';
      render();
      try {
        const result = await requestReflection(sourceText);
        if (token !== generation || noteId !== getCurrentNoteId()) return;
        if (originalBody !== getEditorBodyHtml()) {
          status.textContent = 'Writing changed. Organise again.';
          return;
        }
        const text = result?.reflectionDraft;
        if (typeof text !== 'string' || !text.trim() || text.length > 24000) throw new Error('Invalid draft');
        draft = { text, sourceText, scope };
        status.textContent = '';
      } catch {
        if (token === generation) status.textContent = 'AI is unavailable. Your writing is saved.';
      } finally {
        if (token === generation) { busy = false; render(); }
      }
    };
    allButton.addEventListener('click', () => organise('all'));
    selectedButton.addEventListener('click', () => organise('selection'));
    const saveVersion = (reflection) => {
      flushAutoSave();
      const notes = loadAllNotes();
      const index = notes.findIndex((note) => note.id === getCurrentNoteId());
      if (index < 0) return false;
      notes[index] = { ...notes[index], metadata: { ...notes[index].metadata, reflection },
        updatedAt: new Date().toISOString(), pendingSync: true };
      return saveAllNotes(notes);
    };
    keepButton.addEventListener('click', () => {
      if (!draft || busy) return;
      const saved = current()?.metadata?.reflection;
      const previous = { text: saved?.text || '', sourceText: saved?.sourceText || '', scope: saved?.scope || 'all' };
      const next = { ...draft, history: [...(saved?.history || []), previous].slice(-10) };
      if (!saveVersion(next)) { status.textContent = 'Could not save. Preview retained.'; return; }
      draft = null;
      status.textContent = '';
      render();
    });
    undoButton.addEventListener('click', () => {
      if (busy) return;
      if (draft) {
        draft = null;
        status.textContent = 'Discarded.';
      } else {
        const saved = current()?.metadata?.reflection;
        if (!saved?.history?.length) return;
        const history = [...saved.history];
        const previous = history.pop();
        if (!saveVersion({ ...previous, history })) { status.textContent = 'Could not undo. Try again.'; return; }
        status.textContent = 'Restored.';
      }
      render();
    });
    scratchNotesEditorElement.addEventListener('reflection:noteChanged', () => {
      generation += 1;
      busy = false;
      draft = null;
      selectionText = '';
      status.textContent = '';
      reflectionPanel.open = Boolean(current()?.metadata?.reflection?.text);
      render();
    });
    scratchNotesEditorElement.addEventListener('input', () => {
      selectionText = '';
      if (draft) { draft = null; status.textContent = 'Writing changed. Organise again.'; }
      render();
    });
    render();
  }

  return {
    openNoteEditorForNewNote,
    startNewNoteFromUI,
    flushAutoSave,
    resizeTitleInput,
  };
};
