import { initViewportHeight } from './js/modules/viewport-height.js';
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

initViewportHeight();

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

let currentDailyTasks = [];
let dailyListLoadPromise = null;
let shouldUseLocalDailyList = false;

const DAILY_TASKS_STORAGE_KEY = 'dailyTasksByDate';
let firestoreDailyListContextPromise = null;

function getTodayDateId() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateForHeader(dateId) {
  if (typeof dateId !== 'string') {
    return '';
  }
  const [yearRaw, monthRaw, dayRaw] = dateId.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateId;
  }
  const displayDate = new Date(year, month - 1, day);
  if (Number.isNaN(displayDate.getTime())) {
    return dateId;
  }
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return formatter.format(displayDate);
}

function updateClearCompletedButtonState(tasks) {
  if (!clearCompletedButton) {
    return;
  }
  const hasCompletedTasks = Array.isArray(tasks) && tasks.some((task) => Boolean(task?.completed));
  clearCompletedButton.disabled = !hasCompletedTasks;
}

function renderDailyTasks(tasks) {
  if (!dailyTasksContainer) {
    return;
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">No tasks for today yet.</p>';
    updateClearCompletedButtonState([]);
    return;
  }
  const markup = tasks
    .map((task, index) => {
      const safeText = escapeCueText(task?.text || '');
      const completed = Boolean(task?.completed);
      const textClasses = ['ml-3', 'flex-1', 'text-sm', 'sm:text-base', 'text-base-content'];
      if (completed) {
        textClasses.push('line-through', 'text-opacity-50');
      }
      return `
        <div class="flex items-center p-3 border-b border-base-200" data-task-index="${index}">
          <input type="checkbox" class="checkbox checkbox-sm" data-task-index="${index}" data-task-text="${safeText}" ${completed ? 'checked' : ''} />
          <span class="${textClasses.join(' ')}">${safeText}</span>
        </div>
      `;
    })
    .join('');
  dailyTasksContainer.innerHTML = markup;
  updateClearCompletedButtonState(tasks);
}

function showDailyListPermissionNotice() {
  if (dailyListPermissionNotice) {
    dailyListPermissionNotice.classList.remove('hidden');
  }
}

function hideDailyListPermissionNotice() {
  if (dailyListPermissionNotice) {
    dailyListPermissionNotice.classList.add('hidden');
  }
}

function normaliseDailyTask(task) {
  return {
    text: typeof task?.text === 'string' ? task.text : '',
    completed: Boolean(task?.completed)
  };
}

function normaliseDailyTaskArray(tasks) {
  return Array.isArray(tasks) ? tasks.map((task) => normaliseDailyTask(task)) : [];
}

function readDailyTaskStorage() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(DAILY_TASKS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to read daily tasks from storage', error);
    return {};
  }
}

function writeDailyTaskStorage(map) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const payload = map && typeof map === 'object' ? map : {};
    localStorage.setItem(DAILY_TASKS_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist daily tasks locally', error);
  }
}

function getLocalDailyTasks(dateId) {
  const map = readDailyTaskStorage();
  const tasks = map && typeof map === 'object' ? map[dateId] : [];
  return normaliseDailyTaskArray(tasks);
}

function setLocalDailyTasks(dateId, tasks) {
  const map = readDailyTaskStorage();
  const payload = normaliseDailyTaskArray(tasks);
  map[dateId] = payload;
  writeDailyTaskStorage(map);
  return payload;
}

function appendLocalDailyTask(dateId, task) {
  const map = readDailyTaskStorage();
  const existing = normaliseDailyTaskArray(map[dateId]);
  existing.push(normaliseDailyTask(task));
  map[dateId] = existing;
  writeDailyTaskStorage(map);
  return existing;
}

function isPermissionDeniedError(error) {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  if (code) {
    return code.includes('permission-denied') || code.includes('insufficient-permission');
  }
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return Boolean(message && message.includes('permission'));
}

async function ensureDailyListFirestore() {
  if (firestoreDailyListContextPromise) {
    return firestoreDailyListContextPromise;
  }
  firestoreDailyListContextPromise = ensureCueFirestore()
    .then((base) => {
      const { db, getCollection } = base;
      const dailyListsCollection = typeof getCollection === 'function' && db ? getCollection(db, 'dailyLists') : null;
      return { ...base, dailyListsCollection };
    })
    .catch((error) => {
      console.error('Failed to initialise Firestore for daily lists', error);
      throw error;
    });
  return firestoreDailyListContextPromise;
}

function getDailyListDocRef(firestore, dateId) {
  const { doc, dailyListsCollection, db } = firestore || {};
  if (typeof doc !== 'function') {
    throw new Error('Firestore document helper is unavailable');
  }
  if (dailyListsCollection) {
    return doc(dailyListsCollection, dateId);
  }
  return doc(db, 'dailyLists', dateId);
}

async function loadDailyList() {
  if (!dailyListHeader || !dailyTasksContainer) {
    return;
  }
  const todayId = getTodayDateId();
  const formatted = formatDateForHeader(todayId);
  dailyListHeader.textContent = formatted ? `Today's List - ${formatted}` : "Today's List";
  if (shouldUseLocalDailyList) {
    showDailyListPermissionNotice();
    const localTasks = getLocalDailyTasks(todayId);
    currentDailyTasks = localTasks;
    renderDailyTasks(localTasks);
    return Promise.resolve(localTasks);
  }
  if (!dailyListLoadPromise) {
    dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">Loading tasks…</p>';
    updateClearCompletedButtonState([]);
    dailyListLoadPromise = (async () => {
      try {
        const firestore = await ensureDailyListFirestore();
        const ref = getDailyListDocRef(firestore, todayId);
        const snapshot = await firestore.getDoc(ref);
        const rawTasks = snapshot.exists() ? snapshot.data()?.tasks : [];
        currentDailyTasks = normaliseDailyTaskArray(rawTasks);
        renderDailyTasks(currentDailyTasks);
        setLocalDailyTasks(todayId, currentDailyTasks);
        shouldUseLocalDailyList = false;
        hideDailyListPermissionNotice();
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          console.warn('Falling back to local daily tasks due to permission issue', error);
          shouldUseLocalDailyList = true;
          showDailyListPermissionNotice();
          const localTasks = getLocalDailyTasks(todayId);
          currentDailyTasks = localTasks;
          renderDailyTasks(localTasks);
          return;
        }
        console.error('Failed to load daily list', error);
        dailyTasksContainer.innerHTML = '<p class="text-sm text-error">Unable to load daily tasks right now.</p>';
        currentDailyTasks = [];
        updateClearCompletedButtonState(currentDailyTasks);
      }
    })().finally(() => {
      dailyListLoadPromise = null;
    });
  }
  return dailyListLoadPromise;
}

async function addTaskToDailyList(task) {
  const todayId = getTodayDateId();
  const normalisedTask = normaliseDailyTask(task);
  if (shouldUseLocalDailyList) {
    appendLocalDailyTask(todayId, normalisedTask);
    return;
  }
  try {
    const firestore = await ensureDailyListFirestore();
    const ref = getDailyListDocRef(firestore, todayId);
    const snapshot = await firestore.getDoc(ref);
    if (snapshot.exists() && typeof firestore.arrayUnion === 'function') {
      await firestore.updateDoc(ref, { tasks: firestore.arrayUnion(normalisedTask) });
    } else {
      const existing = snapshot.exists() ? snapshot.data()?.tasks : [];
      const nextTasks = Array.isArray(existing) ? normaliseDailyTaskArray(existing) : [];
      nextTasks.push(normalisedTask);
      if (typeof firestore.setDoc === 'function') {
        await firestore.setDoc(ref, { tasks: nextTasks }, { merge: true });
      } else {
        await firestore.updateDoc(ref, { tasks: nextTasks });
      }
    }
    appendLocalDailyTask(todayId, normalisedTask);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Saving task locally because cloud sync is unavailable', error);
      shouldUseLocalDailyList = true;
      showDailyListPermissionNotice();
      appendLocalDailyTask(todayId, normalisedTask);
      return;
    }
    throw error;
  }
}

async function saveDailyTasks(tasks) {
  const todayId = getTodayDateId();
  const payload = normaliseDailyTaskArray(tasks);
  if (shouldUseLocalDailyList) {
    setLocalDailyTasks(todayId, payload);
    return;
  }
  try {
    const firestore = await ensureDailyListFirestore();
    const ref = getDailyListDocRef(firestore, todayId);
    if (typeof firestore.setDoc === 'function') {
      await firestore.setDoc(ref, { tasks: payload }, { merge: true });
    } else {
      await firestore.updateDoc(ref, { tasks: payload });
    }
    setLocalDailyTasks(todayId, payload);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Persisting daily tasks locally because cloud sync is unavailable', error);
      shouldUseLocalDailyList = true;
      showDailyListPermissionNotice();
      setLocalDailyTasks(todayId, payload);
      return;
    }
    throw error;
  }
}

function activateTab(tabToActivate) {
  [cuesTab, dailyTab].forEach((tab) => {
    if (!tab) {
      return;
    }
    const isActive = tab === tabToActivate;
    tab.classList.toggle('tab-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function showCuesTab() {
  if (!cuesView || !dailyListView) {
    return;
  }
  cuesView.classList.remove('hidden');
  dailyListView.classList.add('hidden');
  activateTab(cuesTab);
}

function showDailyTab() {
  if (!cuesView || !dailyListView) {
    return;
  }
  cuesView.classList.add('hidden');
  dailyListView.classList.remove('hidden');
  activateTab(dailyTab);
  loadDailyList();
}

if (cuesTab && dailyTab && cuesView && dailyListView) {
  cuesTab.addEventListener('click', (event) => {
    event.preventDefault();
    showCuesTab();
  });
  dailyTab.addEventListener('click', (event) => {
    event.preventDefault();
    showDailyTab();
  });
}

let quickAddVoiceRecognition = null;
let quickAddVoiceListening = false;
let quickAddVoiceRestartTimer = null;

function setQuickAddVoiceButtonActive(isActive) {
  if (!quickAddVoiceButton) {
    return;
  }
  quickAddVoiceButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  const iconSpan = quickAddVoiceButton.querySelector('[aria-hidden="true"]');
  if (iconSpan) {
    iconSpan.textContent = isActive ? '👂' : '🎙️';
  } else {
    quickAddVoiceButton.textContent = isActive ? '👂' : '🎙️';
  }
}

function scheduleQuickAddVoiceRestart() {
  if (!quickAddVoiceListening) {
    return;
  }
  window.clearTimeout(quickAddVoiceRestartTimer);
  quickAddVoiceRestartTimer = window.setTimeout(() => {
    quickAddVoiceRestartTimer = null;
    if (quickAddVoiceListening) {
      startQuickAddVoiceRecognition(true);
    }
  }, 400);
}

function startQuickAddVoiceRecognition(forceRestart = false) {
  if (!quickAddVoiceRecognition) {
    return false;
  }
  if (quickAddVoiceListening && !forceRestart) {
    return true;
  }
  try {
    quickAddVoiceRecognition.start();
    quickAddVoiceListening = true;
    setQuickAddVoiceButtonActive(true);
    return true;
  } catch {
    quickAddVoiceListening = false;
    setQuickAddVoiceButtonActive(false);
    return false;
  }
}

function stopQuickAddVoiceRecognition() {
  if (!quickAddVoiceRecognition) {
    return;
  }
  quickAddVoiceListening = false;
  window.clearTimeout(quickAddVoiceRestartTimer);
  try {
    quickAddVoiceRecognition.stop();
  } catch {
    // ignore stop errors so the UI can recover
  }
  setQuickAddVoiceButtonActive(false);
}

function initialiseQuickAddVoiceRecognition() {
  if (!quickAddVoiceButton) {
    return;
  }
  try {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      quickAddVoiceButton.setAttribute('disabled', 'true');
      quickAddVoiceButton.setAttribute('aria-disabled', 'true');
      quickAddVoiceButton.title = 'Voice input is not supported in this browser.';
      return;
    }
    quickAddVoiceRecognition = new SpeechRecognitionCtor();
    const lang = document.documentElement?.lang || navigator?.language || 'en-AU';
    quickAddVoiceRecognition.lang = lang;
    quickAddVoiceRecognition.interimResults = false;
    if ('continuous' in quickAddVoiceRecognition) {
      try {
        quickAddVoiceRecognition.continuous = true;
      } catch {
        // ignore unsupported assignments
      }
    }
    quickAddVoiceRecognition.onresult = (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      if (!transcript) {
        return;
      }
      if (quickAddInput) {
        quickAddInput.value = transcript.trim();
        try {
          quickAddInput.focus({ preventScroll: true });
        } catch {
          quickAddInput.focus();
        }
        try {
          const length = quickAddInput.value.length;
          quickAddInput.setSelectionRange(length, length);
        } catch {
          // ignore selection errors in unsupported browsers
        }
      }
    };
    quickAddVoiceRecognition.onend = () => {
      if (!quickAddVoiceListening) {
        setQuickAddVoiceButtonActive(false);
        return;
      }
      scheduleQuickAddVoiceRestart();
    };
    quickAddVoiceRecognition.onerror = () => {
      quickAddVoiceListening = false;
      setQuickAddVoiceButtonActive(false);
    };
  } catch {
    quickAddVoiceRecognition = null;
    setQuickAddVoiceButtonActive(false);
    quickAddVoiceButton.setAttribute('disabled', 'true');
    quickAddVoiceButton.setAttribute('aria-disabled', 'true');
  }
}

initialiseQuickAddVoiceRecognition();

quickAddVoiceButton?.addEventListener('click', () => {
  if (!quickAddVoiceRecognition) {
    return;
  }
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  } else {
    startQuickAddVoiceRecognition();
  }
});

quickAddForm?.addEventListener('submit', () => {
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  }
});

window.addEventListener('pagehide', () => {
  if (quickAddVoiceListening) {
    stopQuickAddVoiceRecognition();
  }
});

quickAddForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!quickAddInput) {
    return;
  }
  const value = quickAddInput.value.trim();
  if (!value) {
    quickAddInput.focus();
    return;
  }
  const task = { text: value, completed: false };
  quickAddInput.value = '';
  quickAddInput.focus();
  try {
    await addTaskToDailyList(task);
    await loadDailyList();
  } catch (error) {
    console.error('Failed to add task to the daily list', error);
    quickAddInput.value = value;
    quickAddInput.focus();
  }
});

dailyTasksContainer?.addEventListener('change', async (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target || target.type !== 'checkbox') {
    return;
  }
  const index = Number.parseInt(target.getAttribute('data-task-index') || '', 10);
  if (!Array.isArray(currentDailyTasks) || Number.isNaN(index) || !currentDailyTasks[index]) {
    return;
  }
  const previousState = currentDailyTasks.map((task) => ({ ...task }));
  const updatedTasks = previousState.map((task, taskIndex) =>
    taskIndex === index ? { ...task, completed: target.checked } : task
  );
  currentDailyTasks = updatedTasks;
  renderDailyTasks(updatedTasks);
  try {
    await saveDailyTasks(updatedTasks);
  } catch (error) {
    console.error('Failed to update task completion state', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
  }
});

clearCompletedButton?.addEventListener('click', async () => {
  if (!Array.isArray(currentDailyTasks) || currentDailyTasks.length === 0) {
    return;
  }
  const remainingTasks = currentDailyTasks.filter((task) => !task.completed);
  if (remainingTasks.length === currentDailyTasks.length) {
    return;
  }
  const previousState = currentDailyTasks.map((task) => ({ ...task }));
  currentDailyTasks = remainingTasks;
  renderDailyTasks(remainingTasks);
  try {
    await saveDailyTasks(remainingTasks);
  } catch (error) {
    console.error('Failed to clear completed tasks', error);
    currentDailyTasks = previousState;
    renderDailyTasks(previousState);
  }
});

updateClearCompletedButtonState(currentDailyTasks);

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
