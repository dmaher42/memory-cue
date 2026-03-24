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
  let currentNoteOptionsNoteId = null;

  const applyNotesMode = (mode = 'notebooks') => {
    notesMode = mode === 'overview' ? 'overview' : 'notebooks';
    if (notesOverviewPanel instanceof HTMLElement) {
      notesOverviewPanel.classList.toggle('hidden', notesMode !== 'overview');
    }
    if (noteEditorSheet instanceof HTMLElement) {
      noteEditorSheet.classList.toggle('hidden', notesMode === 'overview');
    }
  };

  const isSavedNotesSheetOpen = () => savedNotesSheet?.dataset.open === 'true';

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

  const hideSavedNotesSheet = () => {
    if (!savedNotesSheet) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && savedNotesSheet.contains(activeElement)) {
      if (openSavedNotesButton instanceof HTMLElement && typeof openSavedNotesButton.focus === 'function') {
        openSavedNotesButton.focus();
      } else if (typeof activeElement.blur === 'function') {
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
  }

  const isNoteOptionsOpen = () => noteOptionsSheet && noteOptionsSheet.classList.contains('open');

  const closeNoteOptionsMenu = () => {
    currentNoteOptionsNoteId = null;
    if (noteOptionsSheet) {
      noteOptionsSheet.classList.remove('open');
      noteOptionsSheet.setAttribute('aria-hidden', 'true');
      noteOptionsSheet.removeAttribute('data-note-id');
    }
    if (noteOptionsOverlay) {
      noteOptionsOverlay.classList.remove('open');
      noteOptionsOverlay.setAttribute('aria-hidden', 'true');
    }
  };

  const handleNoteOptionsKeydown = (event) => {
    if (event.key === 'Escape' && isNoteOptionsOpen()) {
      event.preventDefault();
      closeNoteOptionsMenu();
    }
  };

  const openNoteOptionsMenu = (noteId) => {
    if (!noteId || !noteOptionsSheet || !noteOptionsOverlay) {
      return;
    }
    closeNoteOptionsMenu();
    closeOverflowMenu();
    currentNoteOptionsNoteId = noteId;
    const note = getAllNotes().find((item) => item.id === noteId);
    if (noteActionTogglePinBtn) {
      const isPinned = Boolean(note?.pinned);
      noteActionTogglePinBtn.textContent = isPinned ? 'Unpin' : 'Pin';
    }
    noteOptionsSheet.classList.add('open');
    noteOptionsSheet.setAttribute('aria-hidden', 'false');
    noteOptionsSheet.setAttribute('data-note-id', noteId);
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

  document.addEventListener('thinkingBar:openNote', (event) => {
    const noteId = event?.detail?.noteId;
    if (!noteId || typeof onOpenNoteFromDashboard !== 'function') {
      return;
    }
    onOpenNoteFromDashboard(noteId, { isSavedNotesSheetOpen, hideSavedNotesSheet });
  });

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
