window.__ENV = {
  GOOGLE_SCRIPT_ENDPOINT: "https://script.google.com/macros/s/AKfycbylH5GmqeojNoZ-MA9WRg-w1S-ei9cv8Jo1M0qL7t5cn59LBRCCJ779WOyLi7qQwkSx/exec"
};

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

  const FALLBACK_FIREBASE_CONFIG = Object.freeze({
    apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
    authDomain: 'memory-cue-app.firebaseapp.com',
    projectId: 'memory-cue-app',
    storageBucket: 'memory-cue-app.appspot.com',
    messagingSenderId: '751284466633',
    appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
    measurementId: 'G-R0V4M7VCE6'
  });

  let firebaseContextPromise;
  let firebaseContext;
  let remoteNotesUnsubscribe = null;
  let remoteNotesDocRef = null;
  let remoteSaveTimeout = null;
  let remoteSyncActive = false;
  let isApplyingRemoteUpdate = false;
  let remoteUserId = null;
  let lastStoredLocalContent = '';
  let lastRemoteContent = '';

  const getFirebaseContext = () => {
    if (firebaseContextPromise) {
      return firebaseContextPromise;
    }

    firebaseContextPromise = (async () => {
      try {
        const [appMod, firestoreMod, authMod] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js'),
          import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
        ]);

        const { initializeApp, getApps, getApp } = appMod || {};
        const { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } = firestoreMod || {};
        const { getAuth, onAuthStateChanged } = authMod || {};

        if (
          typeof initializeApp !== 'function' ||
          typeof getFirestore !== 'function' ||
          typeof getAuth !== 'function'
        ) {
          return null;
        }

        const api = window?.memoryCueFirebase || {};
        const configCandidate = typeof api.getFirebaseConfig === 'function'
          ? api.getFirebaseConfig()
          : null;
        const config =
          (configCandidate && typeof configCandidate === 'object' ? configCandidate : null)
          || (api.DEFAULT_FIREBASE_CONFIG ? { ...api.DEFAULT_FIREBASE_CONFIG } : null)
          || FALLBACK_FIREBASE_CONFIG;

        if (!config || !config.projectId) {
          console.warn('Notes sync: Firebase config unavailable; remote sync disabled.');
          return null;
        }

        const app = (typeof getApps === 'function' && getApps().length)
          ? getApp()
          : initializeApp(config);
        const db = getFirestore(app);
        const auth = getAuth(app);

        return {
          app,
          db,
          auth,
          doc,
          onSnapshot,
          setDoc,
          serverTimestamp,
          onAuthStateChanged,
        };
      } catch (error) {
        console.warn('Notes sync: Firebase modules unavailable; remote sync disabled.', error);
        return null;
      }
    })();

    return firebaseContextPromise;
  };

  const stopRemoteNotesSync = () => {
    remoteSyncActive = false;
    remoteNotesDocRef = null;
    remoteUserId = null;
    if (remoteSaveTimeout) {
      clearTimeout(remoteSaveTimeout);
      remoteSaveTimeout = null;
    }
    if (typeof remoteNotesUnsubscribe === 'function') {
      try {
        remoteNotesUnsubscribe();
      } catch (error) {
        console.warn('Notes sync: Unable to clean up listener', error);
      }
    }
    remoteNotesUnsubscribe = null;
  };

  const scheduleRemoteSave = (content) => {
    if (!remoteSyncActive || !firebaseContext || !remoteNotesDocRef) {
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
        const payload = { content };
        if (remoteUserId) {
          payload.ownerUid = remoteUserId;
        }
        if (typeof firebaseContext.serverTimestamp === 'function') {
          payload.updatedAt = firebaseContext.serverTimestamp();
        } else {
          payload.updatedAt = new Date();
        }
        const user = firebaseContext?.auth?.currentUser;
        console.log(
          'Notes sync debug:',
          'user.uid =',
          user?.uid,
          'remoteNotesDocRef path =',
          remoteNotesDocRef.path
        );
        await firebaseContext.setDoc(remoteNotesDocRef, payload, { merge: true });
        lastRemoteContent = content;
        setStatus('saved', 'Synced');
        setTimeout(() => setStatus('ready', 'Ready'), 1200);
      } catch (error) {
        console.error('Notes sync: Failed to sync notes', error);
        if (error && error.code === 'permission-denied') {
          setStatus('error', 'Sync unavailable');
          stopRemoteNotesSync();
        } else {
          setStatus('error', 'Sync failed');
        }
      }
    }, 400);
  };

  const handleRemoteSnapshot = (snapshot) => {
    if (!snapshot || typeof snapshot.exists !== 'function') {
      return;
    }

    if (!snapshot.exists()) {
      if (lastStoredLocalContent) {
        setStatus('saving', 'Syncing...');
        scheduleRemoteSave(lastStoredLocalContent);
      }
      return;
    }

    const data = snapshot.data();
    const remoteContent = typeof data?.content === 'string' ? data.content : '';
    lastRemoteContent = remoteContent;

    if (remoteContent === (notesEditor.innerHTML || '')) {
      return;
    }

    isApplyingRemoteUpdate = true;
    notesEditor.innerHTML = remoteContent;
    savedSelectionRange = null;
    updateWordCount();
    try {
      localStorage.setItem('memory-cue-notes', remoteContent);
      lastStoredLocalContent = remoteContent;
    } catch (error) {
      console.warn('Notes sync: Unable to persist remote notes locally', error);
    }
    setStatus('saved', 'Synced');
    setTimeout(() => setStatus('ready', 'Ready'), 1200);
    isApplyingRemoteUpdate = false;
  };

  const startRemoteNotesSync = (user, context) => {
    if (!user || !context || !context.db || typeof context.doc !== 'function' || typeof context.onSnapshot !== 'function') {
      return;
    }

    stopRemoteNotesSync();
    firebaseContext = context;
    remoteSyncActive = true;
    remoteNotesDocRef = context.doc(context.db, 'users', user.uid, 'notebook', 'scratch');
    remoteUserId = user.uid;

    const ensureRemoteDoc = typeof context.setDoc === 'function'
      ? context.setDoc(remoteNotesDocRef, { ownerUid: user.uid }, { merge: true }).catch((error) => {
          console.error('Notes sync: Unable to prepare remote notebook', error);
          if (error && error.code === 'permission-denied') {
            setStatus('error', 'Sync unavailable');
            stopRemoteNotesSync();
          }
          return null;
        })
      : Promise.resolve(null);

    ensureRemoteDoc.then(() => {
      if (!remoteSyncActive) {
        return;
      }

      try {
        remoteNotesUnsubscribe = context.onSnapshot(remoteNotesDocRef, handleRemoteSnapshot, (error) => {
          console.error('Notes sync: Listener error', error);
          if (error && error.code === 'permission-denied') {
            setStatus('error', 'Sync unavailable');
            stopRemoteNotesSync();
          } else {
            setStatus('error', 'Sync error');
          }
        });
      } catch (error) {
        console.error('Notes sync: Unable to subscribe to updates', error);
        return;
      }

      const initialContent = notesEditor.innerHTML || lastStoredLocalContent;
      if (initialContent && !isApplyingRemoteUpdate) {
        setStatus('saving', 'Syncing...');
        scheduleRemoteSave(initialContent);
      }
    });
  };

  const initRemoteNotebookSync = () => {
    if (initRemoteNotebookSync._started) {
      return;
    }
    initRemoteNotebookSync._started = true;

    getFirebaseContext().then((context) => {
      if (!context || !context.auth || typeof context.onAuthStateChanged !== 'function') {
        return;
      }

      firebaseContext = context;
      context.onAuthStateChanged(context.auth, (user) => {
        if (user && user.uid) {
          startRemoteNotesSync(user, context);
        } else {
          stopRemoteNotesSync();
          setStatus('ready', 'Ready');
        }
      });
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

