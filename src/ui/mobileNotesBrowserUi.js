export const initMobileNotesBrowserUi = (options = {}) => {
  if (typeof document === 'undefined') {
    return {};
  }

  const {
    filterInput = null,
    notesOverviewSearch = null,
    notesOverviewSort = null,
    notesOverviewState = null,
    notebookBrowserList = null,
    folderFilterSelect = null,
    debounce = (fn) => fn,
    getFolders = () => [],
    normalizeFolderId = (value) => value,
    setCurrentFolderId = () => {},
    setFilterQuery = () => {},
    setNotesOverviewQuery = () => {},
    setNotesOverviewSortValue = () => {},
    setNotesOverviewStateValue = () => {},
    setActiveFolderFilter = () => {},
    setActiveFolderChip = () => {},
    renderFilteredNotes = () => {},
    renderNotesOverview = () => {},
    applyNotesMode = () => {},
    getNotesMode = () => 'notebooks',
  } = options;

  if (filterInput) {
    const handleFilterInput = debounce(() => {
      const nextQuery = typeof filterInput.value === 'string' ? filterInput.value.trim() : '';
      setFilterQuery(nextQuery);
      renderFilteredNotes();
    }, 200);

    filterInput.addEventListener('input', handleFilterInput);
    filterInput.addEventListener('search', handleFilterInput);
  }

  if (notesOverviewSearch instanceof HTMLElement) {
    notesOverviewSearch.addEventListener('input', () => {
      const nextQuery = typeof notesOverviewSearch.value === 'string'
        ? notesOverviewSearch.value.trim()
        : '';
      setNotesOverviewQuery(nextQuery);
      renderNotesOverview();
    });
  }

  if (notesOverviewSort instanceof HTMLSelectElement) {
    notesOverviewSort.addEventListener('change', () => {
      setNotesOverviewSortValue(notesOverviewSort.value || 'recent');
      renderNotesOverview();
    });
  }

  if (notesOverviewState instanceof HTMLSelectElement) {
    notesOverviewState.addEventListener('change', () => {
      setNotesOverviewStateValue(notesOverviewState.value || 'all');
      renderNotesOverview();
    });
  }

  if (notebookBrowserList instanceof HTMLElement) {
    notebookBrowserList.addEventListener('click', (event) => {
      const trigger = event.target instanceof HTMLElement
        ? event.target.closest('[data-notebook-folder]')
        : null;
      if (!(trigger instanceof HTMLElement)) {
        return;
      }

      const requestedName = String(trigger.dataset.notebookFolder || '').trim();
      if (!requestedName) {
        return;
      }

      const allFolderOptions = Array.isArray(getFolders()) ? getFolders() : [];
      const normalizedName = requestedName.toLowerCase();
      const folderMatch = allFolderOptions.find((folder) => {
        const folderName = typeof folder?.name === 'string' ? folder.name.trim().toLowerCase() : '';
        return folderName === normalizedName;
      });

      const nextFolderId = folderMatch?.id || (normalizedName === 'unsorted' ? 'unsorted' : 'all');
      setCurrentFolderId(nextFolderId);
      setActiveFolderFilter(nextFolderId);
      setActiveFolderChip(nextFolderId);
      renderFilteredNotes();
    });
  }

  window.addEventListener('memorycue:notes:mode', (event) => {
    applyNotesMode(event?.detail?.mode);
    if (getNotesMode() === 'overview') {
      renderNotesOverview();
    }
  });

  if (folderFilterSelect) {
    folderFilterSelect.addEventListener('change', (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      const selectedFolderId = normalizeFolderId(target.value, { fallback: 'all' });
      setCurrentFolderId(selectedFolderId || 'all');
      renderFilteredNotes();
    });
  }

  return {};
};
