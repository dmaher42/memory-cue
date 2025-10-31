import { initReminders } from './js/reminders.js';
import {
  CUE_FIELD_DEFINITIONS,
  DEFAULT_CUE_MODAL_TITLE,
  EDIT_CUE_MODAL_TITLE,
  getFieldElements,
  getCueFieldValueFromData,
  populateCueFormFields,
  clearCueFormFields,
  gatherCueFormData,
  escapeCueText
} from './js/modules/field-helpers.js';
import { createModalController } from './js/modules/modal-controller.js';
import { createDailyTasksManager } from './js/modules/daily-tasks.js';

const titleInput = document.getElementById('title');
const mobileTitleInput = document.getElementById('reminderText');

const modalController = (() => {
  const modalElement = document.getElementById('cue-modal') ?? document.getElementById('cue_modal');
  return createModalController({
    modalElement,
    openButton: document.getElementById('openCueModal'),
    closeButton: document.getElementById('closeCueModal'),
    backdropButton: modalElement?.querySelector('.modal-backdrop button') ?? null,
    titleInput,
    modalTitle: document.getElementById('modal-title'),
    defaultTitle: DEFAULT_CUE_MODAL_TITLE,
    editTitle: EDIT_CUE_MODAL_TITLE
  });
})();

modalController?.setEditMode(false);

const initialiseReminders = () => {
  const hasDesktopForm = Boolean(titleInput);
  const hasMobileForm = Boolean(mobileTitleInput);

  if (!hasDesktopForm && !hasMobileForm) {
    return Promise.resolve();
  }

  if (hasMobileForm) {
    return initReminders({
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
      syncStatusSel: '#syncStatus',
      voiceBtnSel: '#voiceBtn',
      notifBtnSel: '#notifBtn',
      filterBtnsSel: '[data-filter]',
      categoryFilterSel: '#categoryFilter',
      categoryOptionsSel: '#categorySuggestions',
      defaultFilter: 'all',
      countTodaySel: '#todayCount',
      countOverdueSel: '#overdueCount',
      countTotalSel: '#totalCountBadge',
      countCompletedSel: '#completedCount',
      googleSignInBtnSel: '#googleSignInBtn',
      googleSignOutBtnSel: '#googleSignOutBtn',
      googleAvatarSel: '#googleAvatar',
      googleUserNameSel: '#googleUserName',
      syncAllBtnSel: '#syncAll',
      syncUrlInputSel: '#syncUrl',
      saveSettingsSel: '#saveSyncSettings',
      testSyncSel: '#testSync',
      openSettingsSel: '#openSettings',
      dateFeedbackSel: '#dateFeedback'
    });
  }

  return initReminders({
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
    defaultFilter: 'today',
    countTodaySel: '#inlineTodayCount',
    countOverdueSel: '#inlineOverdueCount',
    countTotalSel: '#inlineTotalCount',
    countCompletedSel: '#inlineCompletedCount',
    emptyStateSel: '#emptyState',
    listWrapperSel: '#remindersWrapper',
    dateFeedbackSel: '#dateFeedback',
    variant: 'desktop'
  });
};

initialiseReminders().catch((error) => {
  console.error('Failed to initialise reminders', error);
});

const cuesList = document.getElementById('cues-list');
const cueForm = document.getElementById('cue-form');
const cueIdInput = cueForm?.querySelector('#cue-id-input');
const defaultCueModalTitle =
  modalController?.defaultTitle ||
  modalController?.modalTitle?.textContent?.trim() ||
  DEFAULT_CUE_MODAL_TITLE;
const editCueModalTitle = modalController?.editTitle || EDIT_CUE_MODAL_TITLE;

const cuesTab = document.getElementById('tab-cues');
const dailyTab = document.getElementById('tab-daily');
const cuesView = document.getElementById('cues-view');
const dailyListView = document.getElementById('daily-list-view');
const dailyListHeader = document.getElementById('daily-list-header');
const quickAddForm = document.getElementById('quick-add-form');
const quickAddInput = document.getElementById('quick-add-input');
const quickAddVoiceButton = document.getElementById('daily-voice-btn');
const dailyTasksContainer = document.getElementById('daily-tasks-container');
const clearCompletedButton = document.getElementById('clear-completed-btn');
const dailyListPermissionNotice = document.getElementById('daily-list-permission-notice');

const cueFieldElements = getFieldElements(CUE_FIELD_DEFINITIONS);

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
    const [
      { initializeApp, getApps },
      {
        getFirestore,
        enableMultiTabIndexedDbPersistence,
        enableIndexedDbPersistence,
        collection: getCollection,
        doc,
        getDoc,
        addDoc,
        updateDoc,
        getDocs,
        query,
        orderBy,
        serverTimestamp,
        setDoc,
        arrayUnion
      }
    ]
      = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js')
      ]);
    const apps = getApps();
    const app = apps && apps.length ? apps[0] : initializeApp(firebaseCueConfig);
    const db = getFirestore(app);
    // Firestore offline persistence: prefer multi-tab, fallback to single-tab
    // Runs once per app load, before any reads/writes/listeners.
    (function initFirestorePersistence() {
      const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
      if (!scope) {
        return;
      }
      // Guard against accidental double-initialization
      if (scope.__persistenceInitialized__) return;
      scope.__persistenceInitialized__ = true;

      (async () => {
        try {
          await enableMultiTabIndexedDbPersistence(db);
          console.info('[Firestore] Persistence: multi-tab enabled');
        } catch (err) {
          if (err && err.code === 'failed-precondition') {
            // Multi-tab not available (e.g., private mode or another constraint) -> try single-tab
            try {
              await enableIndexedDbPersistence(db);
              console.info('[Firestore] Persistence: single-tab fallback enabled');
            } catch (e2) {
              console.warn('[Firestore] Persistence disabled (single-tab fallback failed):', e2?.code || e2);
            }
          } else if (err && err.code === 'unimplemented') {
            // IndexedDB not supported in this browser/environment
            console.warn('[Firestore] Persistence not supported in this browser (online-only).');
          } else {
            console.warn('[Firestore] Persistence initialization error:', err?.code || err);
          }
        }
      })();
    })();
    const cuesCollection = getCollection(db, 'cues');
    return {
      db,
      cuesCollection,
      getCollection,
      doc,
      getDoc,
      addDoc,
      updateDoc,
      getDocs,
      query,
      orderBy,
      serverTimestamp,
      setDoc,
      arrayUnion
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
  populateCueFormFields(cue, cueFieldElements);
  cueIdInput.value = cue?.id || '';
  modalController?.setEditMode(true);
  modalController?.show({ mode: 'edit' });
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
  const data = gatherCueFormData(cueFieldElements);
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
    clearCueFormFields(
      cueFieldElements,
      cueIdInput,
      modalController?.modalTitle ?? null,
      defaultCueModalTitle
    );
    await modalController?.hide({ reason: 'form-submit' });
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
    cueIdInput.value = '';
    modalController?.setEditMode(false);
  });
  document.addEventListener('cue:close', () => {
    cueIdInput.value = '';
    modalController?.setEditMode(false);
  });
}

if (cueForm && cueIdInput && cuesList) {
  initialiseCueEditing().catch((error) => {
    console.error('Failed to initialise cue editing', error);
  });
}

const dailyTasksManager = createDailyTasksManager({
  dailyTab,
  dailyView: dailyListView,
  dailyListHeader,
  quickAddForm,
  quickAddInput,
  quickAddVoiceButton,
  dailyTasksContainer,
  clearCompletedButton,
  dailyListPermissionNotice,
  cuesTab,
  cuesView,
  ensureCueFirestore: () => ensureCueFirestore()
});

const THEME_STORAGE_KEY = 'theme';
const themeMenu = document.getElementById('theme-menu');

function applyTheme(themeName) {
  if (typeof themeName !== 'string' || !themeName.trim()) {
    return;
  }
  const normalisedTheme = themeName.trim();
  document.documentElement.setAttribute('data-theme', normalisedTheme);
  const darkThemes = new Set(['dark', 'dracula', 'synthwave']);
  document.documentElement.classList.toggle('dark', darkThemes.has(normalisedTheme));
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
