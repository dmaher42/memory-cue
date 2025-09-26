import { initReminders } from './js/reminders.js';

const cueModal = document.getElementById('cue-modal') ?? document.getElementById('cue_modal');
const openCueButton = document.getElementById('openCueModal');
const closeCueButton = document.getElementById('closeCueModal');
const modalBackdropButton = cueModal?.querySelector('.modal-backdrop button');
const titleInput = document.getElementById('title');

const focusTitleInput = () => {
  if (!titleInput) return;
  window.setTimeout(() => {
    try {
      titleInput.focus({ preventScroll: true });
    } catch {
      titleInput.focus();
    }
  }, 50);
};

const showCueModal = () => {
  if (!cueModal || typeof cueModal.showModal !== 'function') return;
  if (!cueModal.open) {
    cueModal.showModal();
  }
  focusTitleInput();
};

const hideCueModal = () => {
  if (!cueModal) return;
  if (cueModal.open) {
    cueModal.close();
  }
};

openCueButton?.addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('cue:prepare', { detail: { mode: 'create' } }));
  showCueModal();
});

closeCueButton?.addEventListener('click', () => {
  const detail = { reason: 'user-dismissed' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

modalBackdropButton?.addEventListener('click', () => {
  const detail = { reason: 'backdrop' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

cueModal?.addEventListener('cancel', (event) => {
  event.preventDefault();
  const detail = { reason: 'keyboard' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

document.addEventListener('cue:open', () => {
  showCueModal();
});

document.addEventListener('cue:close', () => {
  hideCueModal();
  openCueButton?.focus();
});

initReminders({
  titleSel: '#title',
  dateSel: '#date',
  timeSel: '#time',
  detailsSel: '#details',
  prioritySel: '#priority',
  categorySel: '#category',
  saveBtnSel: '#saveBtn',
  cancelEditBtnSel: '#cancelEditBtn',
  listSel: '#reminderList',
  statusSel: '#status',
  syncStatusSel: '#syncStatus',
  voiceBtnSel: '#voiceBtn',
  filterBtnsSel: '[data-filter]',
  sortSel: '#sort',
  categoryFilterSel: '#categoryFilter',
  categoryOptionsSel: '#categorySuggestions',
  countTodaySel: '#inlineTodayCount',
  countOverdueSel: '#inlineOverdueCount',
  countTotalSel: '#inlineTotalCount',
  countCompletedSel: '#inlineCompletedCount',
  emptyStateSel: '#emptyState',
  listWrapperSel: '#remindersWrapper',
  dateFeedbackSel: '#dateFeedback',
  variant: 'desktop'
});

const cuesList = document.getElementById('cues-list');
const cueForm = document.getElementById('cue-form');
const cueIdInput = cueForm?.querySelector('#cue-id-input');
const cueModalTitle = document.getElementById('modal-title');
const defaultCueModalTitle = cueModalTitle?.textContent?.trim() || '';
const editCueModalTitle = 'Edit Cue';

const cueFieldDefinitions = [
  { key: 'title', ids: ['cue-title', 'title'] },
  { key: 'details', ids: ['cue-details', 'details', 'cue-description'] },
  { key: 'date', ids: ['cue-date', 'date'] },
  { key: 'time', ids: ['cue-time', 'time'] },
  { key: 'priority', ids: ['cue-priority', 'priority'] },
  { key: 'category', ids: ['cue-category', 'category'] }
];

const cueFieldAliases = {
  title: ['title', 'name'],
  details: ['details', 'description', 'notes', 'body'],
  date: ['date', 'dueDate', 'due_date'],
  time: ['time', 'dueTime', 'due_time'],
  priority: ['priority', 'level'],
  category: ['category', 'tag']
};

const cueFieldElements = cueFieldDefinitions
  .map(({ key, ids }) => {
    for (const id of ids) {
      const el = id ? document.getElementById(id) : null;
      if (el) {
        return { key, element: el };
      }
    }
    return null;
  })
  .filter((entry) => entry && entry.element);

const firebaseCueConfig = {
  apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
  authDomain: 'memory-cue-app.firebaseapp.com',
  projectId: 'memory-cue-app',
  storageBucket: 'memory-cue-app.firebasestorage.app',
  messagingSenderId: '751284466633',
  appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
  measurementId: 'G-R0V4M7VCE6'
};

let firestoreCueContextPromise = null;

function getCueFieldValueFromData(data, key) {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const possibleKeys = cueFieldAliases[key] || [key];
  for (const field of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const value = data[field];
      if (value === null || value === undefined) {
        return '';
      }
      return typeof value === 'string' ? value : String(value);
    }
  }
  return '';
}

function setCueFieldValue(element, value) {
  const normalised = value === undefined || value === null ? '' : value;
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      element.checked = Boolean(normalised);
    } else {
      element.value = typeof normalised === 'string' ? normalised : String(normalised);
    }
    return;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    element.value = typeof normalised === 'string' ? normalised : String(normalised);
  }
}

function readCueFieldValue(element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      return element.checked;
    }
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value;
  }
  return '';
}

function populateCueFormFields(cue) {
  cueFieldElements.forEach(({ key, element }) => {
    const value = cue && typeof cue === 'object' ? getCueFieldValueFromData(cue, key) : '';
    setCueFieldValue(element, value);
  });
}

function clearCueFormFields() {
  cueFieldElements.forEach(({ element }) => {
    if (element instanceof HTMLInputElement) {
      if (['checkbox', 'radio'].includes(element.type)) {
        element.checked = false;
      } else {
        element.value = '';
      }
    } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      element.value = '';
    }
  });
  if (cueIdInput) {
    cueIdInput.value = '';
  }
  if (cueModalTitle) {
    cueModalTitle.textContent = defaultCueModalTitle;
  }
}

function gatherCueFormData() {
  const result = {};
  cueFieldElements.forEach(({ key, element }) => {
    const raw = readCueFieldValue(element);
    if (typeof raw === 'boolean') {
      result[key] = raw;
      return;
    }
    const trimmed = typeof raw === 'string' ? raw.trim() : raw;
    result[key] = trimmed === undefined || trimmed === null ? '' : trimmed;
  });
  return result;
}

function escapeCueText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/[&<>'"]/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function renderCueList(cues) {
  if (!cuesList) {
    return;
  }
  if (!Array.isArray(cues) || cues.length === 0) {
    cuesList.innerHTML = '<p class="text-sm text-base-content/60">No cues yet.</p>';
    return;
  }
  const markup = cues
    .map((cue) => {
      const title = escapeCueText(getCueFieldValueFromData(cue, 'title') || 'Untitled Cue');
      const details = escapeCueText(getCueFieldValueFromData(cue, 'details'));
      return `
        <div class="card w-96 bg-base-100 shadow-xl">
          <div class="card-body">
            <h2 class="card-title">${title}</h2>
            ${details ? `<p>${details}</p>` : ''}
            <div class="card-actions justify-end">
              <div class="dropdown dropdown-left">
                <label tabindex="0" class="btn btn-ghost btn-xs m-1">...</label>
                <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                  <li><a class="edit-btn" data-id="${escapeCueText(cue.id)}">Edit</a></li>
                  <li><a class="delete-btn" data-id="${escapeCueText(cue.id)}">Delete</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
  cuesList.innerHTML = markup;
}

async function ensureCueFirestore() {
  if (firestoreCueContextPromise) {
    return firestoreCueContextPromise;
  }
  firestoreCueContextPromise = (async () => {
    const [{ initializeApp, getApps }, { getFirestore, collection, doc, getDoc, addDoc, updateDoc, getDocs, query, orderBy, serverTimestamp }]
      = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js')
      ]);
    const apps = getApps();
    const app = apps && apps.length ? apps[0] : initializeApp(firebaseCueConfig);
    const db = getFirestore(app);
    const cuesCollection = collection(db, 'cues');
    return {
      db,
      cuesCollection,
      doc,
      getDoc,
      addDoc,
      updateDoc,
      getDocs,
      query,
      orderBy,
      serverTimestamp
    };
  })().catch((error) => {
    console.error('Failed to initialise Firestore for cues', error);
    throw error;
  });
  return firestoreCueContextPromise;
}

async function fetchCues() {
  const firestore = await ensureCueFirestore();
  const { getDocs, cuesCollection, query, orderBy } = firestore;
  const baseQuery = query && orderBy ? query(cuesCollection, orderBy('createdAt', 'desc')) : cuesCollection;
  const snapshot = await getDocs(baseQuery);
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function fetchCueById(id) {
  if (!id) {
    return null;
  }
  const firestore = await ensureCueFirestore();
  const { db, doc, getDoc } = firestore;
  const ref = doc(db, 'cues', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    return null;
  }
  return { id: snapshot.id, ...snapshot.data() };
}

async function refreshCueList() {
  if (!cuesList) {
    return;
  }
  try {
    const cues = await fetchCues();
    renderCueList(cues);
  } catch (error) {
    console.error('Failed to load cues', error);
  }
}

function enterCueEditMode(cue) {
  if (!cueForm || !cueIdInput) {
    return;
  }
  populateCueFormFields(cue);
  cueIdInput.value = cue?.id || '';
  if (cueModalTitle) {
    cueModalTitle.textContent = editCueModalTitle;
  }
  showCueModal();
}

async function handleCueEditClick(event) {
  const target = event.target instanceof Element ? event.target.closest('.edit-btn') : null;
  if (!target) {
    return;
  }
  event.preventDefault();
  const cueId = target.getAttribute('data-id');
  if (!cueId) {
    return;
  }
  try {
    const cue = await fetchCueById(cueId);
    if (!cue) {
      return;
    }
    enterCueEditMode(cue);
  } catch (error) {
    console.error('Failed to prepare cue for editing', error);
  }
}

async function handleCueFormSubmit(event) {
  event.preventDefault();
  if (!cueForm || !cueIdInput) {
    return;
  }
  const cueId = cueIdInput.value.trim();
  const data = gatherCueFormData();
  try {
    const firestore = await ensureCueFirestore();
    const { db, doc, addDoc, updateDoc, cuesCollection, serverTimestamp } = firestore;
    const timestamp = typeof serverTimestamp === 'function' ? serverTimestamp() : null;
    if (cueId) {
      const ref = doc(db, 'cues', cueId);
      const payload = { ...data };
      if (timestamp) {
        payload.updatedAt = timestamp;
      }
      await updateDoc(ref, payload);
    } else {
      const payload = { ...data };
      if (timestamp) {
        payload.createdAt = timestamp;
        payload.updatedAt = timestamp;
      }
      await addDoc(cuesCollection, payload);
    }
    await refreshCueList();
    clearCueFormFields();
    hideCueModal();
  } catch (error) {
    console.error('Failed to save cue', error);
  }
}

async function initialiseCueEditing() {
  if (!cueForm || !cueIdInput || !cuesList) {
    return;
  }
  await refreshCueList();
  cuesList.addEventListener('click', handleCueEditClick);
  cueForm.addEventListener('submit', handleCueFormSubmit);
}

if (cueForm && cueIdInput) {
  document.addEventListener('cue:prepare', () => {
    if (cueIdInput) {
      cueIdInput.value = '';
    }
    if (cueModalTitle) {
      cueModalTitle.textContent = defaultCueModalTitle;
    }
  });
  document.addEventListener('cue:close', () => {
    if (cueIdInput) {
      cueIdInput.value = '';
    }
    if (cueModalTitle) {
      cueModalTitle.textContent = defaultCueModalTitle;
    }
  });
}

if (cueForm && cueIdInput && cuesList) {
  initialiseCueEditing().catch((error) => {
    console.error('Failed to initialise cue editing', error);
  });
}

const THEME_STORAGE_KEY = 'theme';
const themeMenu = document.getElementById('theme-menu');

function applyTheme(themeName) {
  if (typeof themeName !== 'string' || !themeName.trim()) {
    return;
  }
  const normalisedTheme = themeName.trim();
  document.documentElement.setAttribute('data-theme', normalisedTheme);
  document.documentElement.classList.toggle('dark', normalisedTheme === 'dark');
}

function saveTheme(themeName) {
  if (typeof themeName !== 'string' || !themeName.trim()) {
    return;
  }
  const normalisedTheme = themeName.trim();
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalisedTheme);
  } catch (error) {
    console.warn('Unable to save theme preference', error);
  }
}

function loadSavedTheme() {
  let storedTheme = '';
  try {
    storedTheme = localStorage.getItem(THEME_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Unable to load theme preference', error);
  }

  if (storedTheme) {
    applyTheme(storedTheme);
  }
}

themeMenu?.addEventListener('click', (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-theme-name]') : null;
  if (!target) {
    return;
  }

  event.preventDefault();
  const themeName = target.getAttribute('data-theme-name');
  if (!themeName) {
    return;
  }

  applyTheme(themeName);
  saveTheme(themeName);
});

loadSavedTheme();
