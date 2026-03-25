import { ModalController } from '../../js/modules/modal-controller.js';

export const initMobileNotesFolderManager = (options = {}) => {
  if (typeof document === 'undefined') {
    return {
      setAfterFolderCreated: () => {},
      openNewFolderDialog: () => {},
      syncNoteFolderButtonLabel: () => {},
      closeOverflowMenu: () => {},
      handleMoveNoteToFolder: () => {},
      openFolderOverflowMenu: () => {},
    };
  }

  const {
    folderFilterNewButton = null,
    newFolderModalEl = null,
    newFolderNameInput = null,
    newFolderError = null,
    newFolderCreateBtn = null,
    newFolderCancelBtn = null,
    noteFolderBtn = null,
    renameFolderModalEl = null,
    renameFolderNameInput = null,
    renameFolderError = null,
    renameFolderSaveBtn = null,
    renameFolderCancelBtn = null,
    deleteFolderModalEl = null,
    deleteFolderConfirmBtn = null,
    deleteFolderCancelBtn = null,
    getFolders = () => [],
    saveFolders = () => false,
    getFolderNameById = () => 'Unsorted',
    assignNoteToFolder = () => false,
    buildFolderChips = () => {},
    buildFolderFilterSelect = () => {},
    renderFilteredNotes = () => {},
    refreshFromStorage = () => {},
    showMoveToast = () => {},
    loadAllNotes = () => [],
    saveAllNotes = () => {},
    clearSearchFilter = () => {},
    getCurrentNoteId = () => null,
    getCurrentEditingNoteFolderId = () => 'unsorted',
    setCurrentEditingNoteFolderId = () => {},
    getCurrentFolderId = () => 'all',
    setCurrentFolderId = () => {},
  } = options;

  let newFolderModalController = null;
  let renameFolderController = null;
  let deleteFolderController = null;
  let afterFolderCreated = null;
  let activeOverflowMenu = null;
  let activeOverflowTrigger = null;
  let pendingRenameFolderId = null;
  let pendingDeleteFolderId = null;

  const clearNewFolderError = () => {
    if (!newFolderError) return;
    newFolderError.classList.add('sr-only');
    newFolderError.textContent = '';
  };

  const showNewFolderError = (message) => {
    if (!newFolderError) return;
    newFolderError.textContent = message;
    newFolderError.classList.remove('sr-only');
  };

  const openNewFolderDialog = () => {
    if (!newFolderModalEl) {
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
      setTimeout(() => {
        try {
          newFolderNameInput.focus();
          newFolderNameInput.select && newFolderNameInput.select();
        } catch {
          /* ignore focus errors */
        }
      }, 20);
    }

    newFolderModalController.show();
  };

  const createNewFolder = () => {
    if (!newFolderNameInput) return null;
    const raw = String(newFolderNameInput.value || '');
    const name = raw.trim();
    clearNewFolderError();
    if (!name.length) {
      showNewFolderError("Folder name can't be empty.");
      return null;
    }

    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }

    const exists = folders.some((folder) => String(folder.name).toLowerCase() === name.toLowerCase());
    if (exists) {
      showNewFolderError('You already have a folder with this name.');
      return null;
    }

    const folderId = `folder-${Date.now().toString(36)}`;
    const saved = saveFolders([...folders.filter(Boolean), { id: folderId, name }]);
    if (!saved) {
      showNewFolderError('Unable to create folder. Please try again.');
      return null;
    }

    try {
      newFolderModalController?.requestClose('created');
    } catch {
      /* ignore */
    }

    try {
      buildFolderChips();
    } catch (error) {
      console.warn('[notebook] rebuild folder chips failed', error);
    }
    try {
      buildFolderFilterSelect();
    } catch (error) {
      console.warn('[notebook] rebuild folder filter failed', error);
    }

    if (typeof afterFolderCreated === 'function') {
      try {
        afterFolderCreated(folderId, name);
      } catch (error) {
        console.warn('[notebook] post-create handler failed', error);
      }
      afterFolderCreated = null;
    }

    return folderId;
  };

  const syncNoteFolderButtonLabel = (folderId) => {
    if (!(noteFolderBtn instanceof HTMLElement)) {
      return;
    }
    noteFolderBtn.textContent = getFolderNameById(folderId || 'unsorted') || 'Unsorted';
  };

  const closeOverflowMenu = () => {
    if (activeOverflowMenu && activeOverflowMenu.parentNode) {
      activeOverflowMenu.parentNode.removeChild(activeOverflowMenu);
    }

    const focusTarget =
      activeOverflowTrigger
      && document.body.contains(activeOverflowTrigger)
      && typeof activeOverflowTrigger.focus === 'function'
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

  const handleOverflowKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeOverflowMenu();
    }
    if (event.key === 'Tab') {
      requestAnimationFrame(() => {
        if (activeOverflowMenu && !activeOverflowMenu.contains(document.activeElement)) {
          closeOverflowMenu();
        }
      });
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
    } catch (error) {
      console.warn('[notebook] failed to refresh notes after move', error);
    }
    try {
      buildFolderChips();
    } catch (error) {
      console.warn('[notebook] failed to refresh folder chips after move', error);
    }
    try {
      const targetName = getFolderNameById(normalizedTarget || 'unsorted') || 'Unsorted';
      showMoveToast(targetName);
    } catch {
      /* no-op */
    }

    if (noteId === getCurrentNoteId()) {
      setCurrentEditingNoteFolderId(normalizedTarget || 'unsorted');
      syncNoteFolderButtonLabel(normalizedTarget || 'unsorted');
    }

    closeOverflowMenu();
  };

  const reorderFolder = (folderId, direction) => {
    if (!folderId || (direction !== -1 && direction !== 1)) return;

    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders().slice() : [];
    } catch {
      folders = [];
    }
    if (!folders.length) return;

    const userFolders = folders.filter((folder) => folder && folder.id !== 'unsorted');
    userFolders.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const index = userFolders.findIndex((folder) => String(folder.id) === String(folderId));
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= userFolders.length) return;

    const tmp = userFolders[index].order;
    userFolders[index].order = userFolders[targetIndex].order;
    userFolders[targetIndex].order = tmp;

    const unsorted =
      folders.find((folder) => folder && folder.id === 'unsorted')
      || { id: 'unsorted', name: 'Unsorted', order: -1 };
    const normalized = [unsorted, ...userFolders].map((folder, indexValue) => ({
      id: folder.id,
      name: folder.name,
      order: indexValue,
    }));

    try {
      const saved = saveFolders(normalized);
      if (saved) {
        try { buildFolderChips(); } catch {}
        try { renderFilteredNotes(); } catch {}
      }
    } catch (error) {
      console.warn('[notebook] reorder save failed', error);
    }
  };

  const clearRenameError = () => {
    if (!renameFolderError) return;
    renameFolderError.classList.add('sr-only');
    renameFolderError.textContent = '';
  };

  const showRenameError = (message) => {
    if (!renameFolderError) return;
    renameFolderError.textContent = message;
    renameFolderError.classList.remove('sr-only');
  };

  const openRenameDialog = (folderId) => {
    if (!renameFolderModalEl || folderId === 'all' || folderId === 'unsorted') return;

    pendingRenameFolderId = folderId;
    const folders = Array.isArray(getFolders()) ? getFolders() : [];
    const found = folders.find((folder) => folder && String(folder.id) === String(folderId));
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
    if (renameFolderNameInput) {
      renameFolderNameInput.value = found.name || '';
    }
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
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }

    const duplicate = folders.some(
      (folder) => String(folder.name).toLowerCase() === name.toLowerCase()
        && String(folder.id) !== String(pendingRenameFolderId),
    );
    if (duplicate) {
      showRenameError('You already have a folder with this name.');
      return;
    }

    const saved = saveFolders(
      folders.map((folder) => (
        String(folder.id) === String(pendingRenameFolderId)
          ? { ...folder, name }
          : folder
      )),
    );
    if (!saved) {
      showRenameError('Unable to rename folder. Please try again.');
      return;
    }

    try {
      renameFolderController?.requestClose('saved');
    } catch {
      /* ignore */
    }
    pendingRenameFolderId = null;
    try { buildFolderChips(); } catch {}
    renderFilteredNotes();
  };

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

    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }

    const updatedFolders = folders.filter((folder) => String(folder.id) !== String(pendingDeleteFolderId));
    if (!updatedFolders.some((folder) => folder && folder.id === 'unsorted')) {
      updatedFolders.unshift({ id: 'unsorted', name: 'Unsorted' });
    }

    const saved = saveFolders(updatedFolders);
    if (!saved) {
      try {
        deleteFolderController?.requestClose('failed');
      } catch {
        /* ignore */
      }
      pendingDeleteFolderId = null;
      return;
    }

    const notes = loadAllNotes();
    const updatedNotes = (Array.isArray(notes) ? notes : []).map((note) => {
      if (note && String(note.folderId) === String(pendingDeleteFolderId)) {
        return { ...note, folderId: 'unsorted', updatedAt: new Date().toISOString() };
      }
      return note;
    });
    saveAllNotes(updatedNotes);

    if (String(getCurrentFolderId()) === String(pendingDeleteFolderId)) {
      setCurrentFolderId('unsorted');
      clearSearchFilter();
    }

    pendingDeleteFolderId = null;
    try {
      deleteFolderController?.requestClose('deleted');
    } catch {
      /* ignore */
    }
    buildFolderChips();
    renderFilteredNotes();
  };

  const openFolderOverflowMenu = (folderId, anchorEl) => {
    if (!folderId || folderId === 'all' || folderId === 'unsorted') return;

    closeOverflowMenu();

    const menu = document.createElement('div');
    menu.className = 'memory-glass-card p-2 rounded shadow-lg';
    menu.style.position = 'absolute';
    menu.style.zIndex = 1200;
    menu.style.minWidth = '160px';

    let isFirst = false;
    let isLast = false;
    try {
      const folders = Array.isArray(getFolders()) ? getFolders().filter(Boolean) : [];
      const userFolders = folders
        .filter((folder) => folder && folder.id !== 'unsorted')
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const index = userFolders.findIndex((folder) => String(folder.id) === String(folderId));
      isFirst = index === 0;
      isLast = index === -1 ? true : index === userFolders.length - 1;
    } catch {
      isFirst = false;
      isLast = false;
    }

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveUpBtn.textContent = 'Move up';
    if (isFirst) {
      moveUpBtn.setAttribute('disabled', '');
      moveUpBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveUpBtn.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        reorderFolder(folderId, -1);
      } catch (error) {
        console.warn('[notebook] reorder move up failed', error);
      }
      closeOverflowMenu();
    });

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveDownBtn.textContent = 'Move down';
    if (isLast) {
      moveDownBtn.setAttribute('disabled', '');
      moveDownBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveDownBtn.addEventListener('click', (event) => {
      event.preventDefault();
      try {
        reorderFolder(folderId, 1);
      } catch (error) {
        console.warn('[notebook] reorder move down failed', error);
      }
      closeOverflowMenu();
    });

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    renameBtn.textContent = 'Rename folder';
    renameBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openRenameDialog(folderId);
      closeOverflowMenu();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'w-full text-left px-3 py-2 btn-ghost text-accent';
    deleteBtn.textContent = 'Delete folder';
    deleteBtn.addEventListener('click', (event) => {
      event.preventDefault();
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

    try {
      const rect = anchorEl.getBoundingClientRect();
      menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
      menu.style.left = `${rect.left + window.scrollX}px`;
    } catch {
      menu.style.top = '50%';
      menu.style.left = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
    }

    document.addEventListener('click', closeOverflowMenu);
    document.addEventListener('keydown', handleOverflowKeydown);
  };

  if (typeof window !== 'undefined' && typeof window.openNewFolderDialog === 'undefined') {
    window.openNewFolderDialog = openNewFolderDialog;
  }

  folderFilterNewButton?.addEventListener('click', (event) => {
    event.preventDefault();
    openNewFolderDialog();
  });

  newFolderCreateBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    createNewFolder();
  });

  newFolderNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      createNewFolder();
    }
  });

  newFolderCancelBtn?.addEventListener('click', () => {
    afterFolderCreated = null;
  });

  renameFolderSaveBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    saveRename();
  });

  renameFolderNameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename();
    }
  });

  deleteFolderConfirmBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    confirmDeleteFolder();
  });

  return {
    setAfterFolderCreated: (value) => {
      afterFolderCreated = value;
    },
    openNewFolderDialog,
    syncNoteFolderButtonLabel,
    closeOverflowMenu,
    handleMoveNoteToFolder,
    openFolderOverflowMenu,
  };
};
