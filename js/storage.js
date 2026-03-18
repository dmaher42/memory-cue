(function() {
  // Enhanced Notes Editor
  const notesEditor = document.getElementById('notes');
  const notesToolbar = document.getElementById('notesToolbar');
  const notesStatus = document.getElementById('notesStatusText');
  const notesSyncStatus = document.getElementById('notesSyncStatus');
  const notesWordCount = document.getElementById('notesWordCount');
  const searchPanel = document.getElementById('searchPanel');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');

  if (!notesEditor) return;

  let savedSelectionRange = null;

  const focusEditor = () => {
    try {
      notesEditor.focus({ preventScroll: true });
    } catch {
      notesEditor.focus();
    }
  };

  const saveSelectionRange = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerElement =
      container && container.nodeType === 1
        ? container
        : container?.parentElement || null;

    if (!containerElement || !notesEditor.contains(containerElement)) {
      return;
    }

    savedSelectionRange = range.cloneRange();
  };

  const restoreSelectionRange = () => {
    if (!savedSelectionRange) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    try {
      selection.removeAllRanges();
      selection.addRange(savedSelectionRange);
      return true;
    } catch {
      savedSelectionRange = null;
      return false;
    }
  };

  document.addEventListener('selectionchange', saveSelectionRange);
  notesEditor.addEventListener('mouseup', saveSelectionRange);
  notesEditor.addEventListener('keyup', saveSelectionRange);
  notesEditor.addEventListener('touchend', saveSelectionRange);

  let autoSaveTimeout;
  let currentSearchIndex = 0;
  let searchMatches = [];

  let firestoreSyncPromise = null;
  let remoteSaveTimeout = null;
  let remoteSyncActive = false;
  let isApplyingRemoteUpdate = false;
  let lastStoredLocalContent = '';
  let lastRemoteContent = '';

  const getFirestoreSync = () => {
    if (!firestoreSyncPromise) {
      firestoreSyncPromise = import('../src/services/firestoreSyncService.js')
        .catch((error) => {
          console.warn('Notes sync: Firebase module unavailable; remote sync disabled.', error);
          return null;
        });
    }
    return firestoreSyncPromise;
  };

  const getCurrentUserId = () => {
    const userId = typeof window.__MEMORY_CUE_AUTH_USER_ID === 'string'
      ? window.__MEMORY_CUE_AUTH_USER_ID.trim()
      : '';
    return userId || null;
  };

  const stopRemoteNotesSync = () => {
    remoteSyncActive = false;
    if (remoteSaveTimeout) {
      clearTimeout(remoteSaveTimeout);
      remoteSaveTimeout = null;
    }
  };

  const scheduleRemoteSave = (content) => {
    if (!remoteSyncActive) {
      setStatus('saved', 'Saved');
      setTimeout(() => setStatus('ready', 'Ready'), 1500);
      return;
    }

    if (content === lastRemoteContent) {
      setStatus('saved', 'Synced');
      setTimeout(() => setStatus('ready', 'Ready'), 1200);
      return;
    }

    if (remoteSaveTimeout) {
      clearTimeout(remoteSaveTimeout);
    }

    remoteSaveTimeout = setTimeout(async () => {
      try {
        const syncModule = await getFirestoreSync();
        if (!syncModule?.syncNotes) {
          setStatus('saved', 'Saved');
          setTimeout(() => setStatus('ready', 'Ready'), 1200);
          return;
        }

        await syncModule.syncNotes();
        lastRemoteContent = content;
        setStatus('saved', 'Synced');
        setTimeout(() => setStatus('ready', 'Ready'), 1200);
      } catch (error) {
        console.error('Notes sync: Failed to sync notes', error);
        setStatus('error', 'Sync failed');
      }
    }, 400);
  };

  const pullRemoteNotes = async () => {
    if (!remoteSyncActive) {
      return;
    }

    try {
      const syncModule = await getFirestoreSync();
      const remoteNotes = await syncModule?.syncNotes?.();
      const firstNote = Array.isArray(remoteNotes) && remoteNotes.length ? remoteNotes[0] : null;
      const remoteContent = typeof firstNote?.bodyHtml === 'string'
        ? firstNote.bodyHtml
        : typeof firstNote?.body === 'string'
          ? firstNote.body
          : '';

      if (!remoteContent || remoteContent === (notesEditor.innerHTML || '')) {
        return;
      }

      isApplyingRemoteUpdate = true;
      notesEditor.innerHTML = remoteContent;
      savedSelectionRange = null;
      updateWordCount();
      localStorage.setItem('memory-cue-notes', remoteContent);
      lastStoredLocalContent = remoteContent;
      lastRemoteContent = remoteContent;
      setStatus('saved', 'Synced');
      setTimeout(() => setStatus('ready', 'Ready'), 1200);
    } catch (error) {
      console.warn('Notes sync: Unable to pull remote notes', error);
    } finally {
      isApplyingRemoteUpdate = false;
    }
  };

  const initRemoteNotebookSync = () => {
    if (initRemoteNotebookSync._started) {
      return;
    }
    initRemoteNotebookSync._started = true;

    const refreshSyncState = () => {
      remoteSyncActive = Boolean(getCurrentUserId());
      if (!remoteSyncActive) {
        stopRemoteNotesSync();
        setStatus('ready', 'Ready');
        return;
      }
      void pullRemoteNotes();
    };

    refreshSyncState();
    window.addEventListener('focus', refreshSyncState);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshSyncState();
      }
    });
  };

  // Auto-save functionality
  const autoSave = () => {
    if (!notesEditor) return;

    const content = notesEditor.innerHTML;
    clearTimeout(autoSaveTimeout);
    setStatus('saving', remoteSyncActive ? 'Syncing...' : 'Saving...');

    autoSaveTimeout = setTimeout(() => {
      try {
        if (content !== lastStoredLocalContent) {
          localStorage.setItem('memory-cue-notes', content);
          lastStoredLocalContent = content;
        }
      } catch (error) {
        console.error('Failed to save notes:', error);
        setStatus('error', 'Save failed');
        setTimeout(autoSave, 3000);
        return;
      }

      if (remoteSyncActive && !isApplyingRemoteUpdate) {
        scheduleRemoteSave(content);
      } else {
        setStatus('saved', 'Saved');
        setTimeout(() => setStatus('ready', 'Ready'), 1500);
      }
    }, 800);
  };

  // Status management
  const setStatus = (state, message) => {
    if (notesStatus) notesStatus.textContent = message;
    if (notesSyncStatus) {
      notesSyncStatus.className = `sync-dot ${state}`;
    }
  };

  // Word count
  const updateWordCount = () => {
    if (!notesWordCount || !notesEditor) return;
    const text = notesEditor.textContent || '';
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    notesWordCount.textContent = `${words.length} words`;
  };

  // Load saved notes
  const loadNotes = () => {
    try {
      const saved = localStorage.getItem('memory-cue-notes');
      if (typeof saved === 'string' && saved && notesEditor) {
        notesEditor.innerHTML = saved;
        savedSelectionRange = null;
        lastStoredLocalContent = saved;
        lastRemoteContent = saved;
        setStatus('ready', 'Notes loaded');
      } else {
        lastStoredLocalContent = notesEditor.innerHTML || '';
        lastRemoteContent = lastStoredLocalContent;
      }
    } catch (error) {
      console.error('Failed to load notes:', error);
      lastStoredLocalContent = notesEditor.innerHTML || '';
      lastRemoteContent = lastStoredLocalContent;
    }
  };

  // Formatting functions
  const formatText = (command, value = null) => {
    if (typeof document.execCommand !== 'function') {
      return;
    }

    focusEditor();
    if (!restoreSelectionRange()) {
      const selection = window.getSelection();
      if (selection) {
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(notesEditor);
        fallbackRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
      }
    }

    document.execCommand(command, false, value);
    saveSelectionRange();
    autoSave();
  };

  const insertAtCursor = (html) => {
    focusEditor();
    if (!restoreSelectionRange()) {
      const selection = window.getSelection();
      if (selection) {
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(notesEditor);
        fallbackRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
      }
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      range.insertNode(fragment);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      savedSelectionRange = range.cloneRange();
    }
    autoSave();
    saveSelectionRange();
  };

  // Toolbar event handlers
  if (notesToolbar) {
    notesToolbar.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      e.preventDefault();

      switch(action) {
        case 'bold':
          formatText('bold');
          break;
        case 'italic':
          formatText('italic');
          break;
        case 'strikethrough':
          formatText('strikeThrough');
          break;
        case 'bullets':
          formatText('insertUnorderedList');
          break;
        case 'numbers':
          formatText('insertOrderedList');
          break;
        case 'checklist':
          insertAtCursor('<div class="checklist-item"><span class="checklist-checkbox" role="button" tabindex="0" onclick="toggleCheckbox(this)" onkeypress="if(event.key===\'Enter\')toggleCheckbox(this)">☐</span><span contenteditable="true">New item</span></div>');
          break;
        case 'heading':
          formatText('formatBlock', 'h2');
          break;
        case 'divider':
          insertAtCursor('<hr>');
          break;
        case 'link':
          const url = prompt('Enter URL:');
          if (url) formatText('createLink', url);
          break;
        case 'clear':
          formatText('removeFormat');
          break;
      }
    });
  }

  // Search functionality
  const performSearch = (query) => {
    if (!query.trim()) {
      clearHighlights();
      updateSearchResults(0);
      return;
    }

    clearHighlights();
    searchMatches = [];
    
    try {
      const content = notesEditor.innerHTML;
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      
      const highlightedContent = content.replace(regex, '<span class="highlight">$1</span>');
      notesEditor.innerHTML = highlightedContent;
      savedSelectionRange = null;

      searchMatches = Array.from(notesEditor.querySelectorAll('.highlight'));
      updateSearchResults(searchMatches.length);
      
      if (searchMatches.length > 0) {
        currentSearchIndex = 0;
        highlightCurrentMatch();
      }
    } catch (error) {
      console.error('Search error:', error);
      updateSearchResults(0);
    }
  };

  const clearHighlights = () => {
    const highlights = notesEditor.querySelectorAll('.highlight');
    highlights.forEach(highlight => {
      const parent = highlight.parentNode;
      parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
      parent.normalize();
    });
    savedSelectionRange = null;
  };

  const highlightCurrentMatch = () => {
    searchMatches.forEach((match, index) => {
      match.style.backgroundColor = index === currentSearchIndex 
        ? 'color-mix(in srgb, var(--primary-color) 40%, transparent)' 
        : 'color-mix(in srgb, var(--warning-color) 25%, transparent)';
    });
    
    if (searchMatches[currentSearchIndex]) {
      searchMatches[currentSearchIndex].scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  };

  const updateSearchResults = (count) => {
    if (searchResults) {
      searchResults.textContent = count > 0 
        ? `${count} matches found` 
        : 'No matches found';
    }
  };

  // Search controls
  document.getElementById('searchNotes')?.addEventListener('click', () => {
    searchPanel?.classList.toggle('hidden');
    if (!searchPanel?.classList.contains('hidden')) {
      searchInput?.focus();
    } else {
      clearHighlights();
    }
  });

  document.getElementById('closeSearch')?.addEventListener('click', () => {
    searchPanel?.classList.add('hidden');
    clearHighlights();
  });

  searchInput?.addEventListener('input', (e) => {
    performSearch(e.target.value);
  });

  document.getElementById('searchNext')?.addEventListener('click', () => {
    if (searchMatches.length > 0) {
      currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length;
      highlightCurrentMatch();
    }
  });

  document.getElementById('searchPrev')?.addEventListener('click', () => {
    if (searchMatches.length > 0) {
      currentSearchIndex = currentSearchIndex === 0 
        ? searchMatches.length - 1 
        : currentSearchIndex - 1;
      highlightCurrentMatch();
    }
  });

  // Export functionality
  document.getElementById('exportNotes')?.addEventListener('click', () => {
    if (!notesEditor) return;
    
    try {
      const content = notesEditor.textContent || '';
      if (!content.trim()) {
        alert('No content to export');
        return;
      }
      
      // For mobile devices, use share API if available
      if (navigator.share) {
        navigator.share({
          title: 'My Notes',
          text: content,
        }).catch(error => {
          console.log('Error sharing:', error);
          fallbackExport(content);
        });
      } else {
        fallbackExport(content);
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    }
  });
  
  const fallbackExport = (content) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memory-cue-notes-${new Date().toISOString().split('T')[0]}.txt`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Voice notes (integrate with existing voice functionality)
  document.getElementById('voiceNotes')?.addEventListener('click', () => {
    // Trigger existing voice functionality if available
    const voiceBtn = document.getElementById('voiceBtn') || document.getElementById('quickAddVoice');
    if (voiceBtn) {
      voiceBtn.click();
    } else {
      alert('Voice functionality not available');
    }
  });

  const manualSaveButton = document.getElementById('noteSaveMobile');
  if (manualSaveButton) {
    manualSaveButton.addEventListener('click', () => {
      if (!notesEditor) return;

      const content = notesEditor.innerHTML;
      clearTimeout(autoSaveTimeout);
      setStatus('saving', remoteSyncActive ? 'Syncing...' : 'Saving...');

      try {
        if (content !== lastStoredLocalContent) {
          localStorage.setItem('memory-cue-notes', content);
          lastStoredLocalContent = content;
        }
      } catch (error) {
        console.error('Failed to save notes:', error);
        setStatus('error', 'Save failed');
        setTimeout(autoSave, 3000);
        return;
      }

      if (remoteSyncActive && !isApplyingRemoteUpdate) {
        scheduleRemoteSave(content);
      } else {
        setStatus('saved', 'Saved');
        setTimeout(() => setStatus('ready', 'Ready'), 1500);
      }
    });
  }

  // Event listeners
  notesEditor.addEventListener('input', () => {
    updateWordCount();
    autoSave();
    saveSelectionRange();
  });

  notesEditor.addEventListener('paste', (e) => {
    // Clean pasted content
    setTimeout(() => {
      updateWordCount();
      autoSave();
      saveSelectionRange();
    }, 100);
  });

  // Keyboard shortcuts
  notesEditor.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch(e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          formatText('bold');
          break;
        case 'i':
          e.preventDefault();
          formatText('italic');
          break;
        case 'f':
          e.preventDefault();
          document.getElementById('searchNotes')?.click();
          break;
      }
    }
  });

  // Helper function for checkbox toggling
  window.toggleCheckbox = function(element) {
    if (element && element.textContent) {
      element.textContent = element.textContent === '☐' ? '☑' : '☐';
      autoSave();
      saveSelectionRange();
    }
  };
  
  // Improve mobile keyboard handling
  notesEditor.addEventListener('focus', () => {
    restoreSelectionRange();
    // Prevent zoom on iOS
    if (window.navigator.userAgent.includes('iPhone') || window.navigator.userAgent.includes('iPad')) {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', viewport.getAttribute('content') + ', user-scalable=no');
      }
    }
  });

  notesEditor.addEventListener('blur', () => {
    saveSelectionRange();
    // Re-enable zoom
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      const content = viewport.getAttribute('content').replace(', user-scalable=no', '');
      viewport.setAttribute('content', content);
    }
  });

  // Initialize
  loadNotes();
  updateWordCount();
  initRemoteNotebookSync();
  setStatus('ready', 'Ready');
  
  // Add mobile-friendly touch handling for toolbar
  if (notesToolbar) {
    notesToolbar.addEventListener('touchstart', (e) => {
      e.preventDefault(); // Prevent double-tap zoom
    }, { passive: false });
  }
})();

// Clear any unwanted JavaScript content from notes editor on load
document.addEventListener('DOMContentLoaded', function() {
  const notesEditor = document.getElementById('notebook-editor-body');
  if (notesEditor) {
    const content = notesEditor.innerHTML || '';
    // Remove any script tags, function definitions, or JavaScript code
    if (content.includes('<script') || content.includes('function') || content.includes('addEventListener') || content.includes('document.')) {
      notesEditor.innerHTML = '';
      // Also clear localStorage if it contains JavaScript
      try {
        const stored = localStorage.getItem('memory-cue-notes');
        if (stored && (stored.includes('function') || stored.includes('addEventListener') || stored.includes('document.'))) {
          localStorage.removeItem('memory-cue-notes');
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  }
});

