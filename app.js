import { initReminders } from './js/reminders.js';

const cueModal = document.getElementById('cue-modal');
const openCueButton = document.getElementById('openCueModal');
const closeCueButton = document.getElementById('closeCueModal');
const modalBackdropButton = cueModal?.querySelector('.modal-backdrop button');
const titleInput = document.getElementById('title');

const cuesTab = document.getElementById('tab-cues');
const dailyTab = document.getElementById('tab-daily');
const cuesView = document.getElementById('cues-view');
const dailyListView = document.getElementById('daily-list-view');
const dailyListHeader = document.getElementById('daily-list-header');
const quickAddForm = document.getElementById('quick-add-form');
const quickAddInput = document.getElementById('quick-add-input');
const dailyTasksContainer = document.getElementById('daily-tasks-container');
const clearCompletedBtn = document.getElementById('clear-completed-btn');

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
  authDomain: 'memory-cue-app.firebaseapp.com',
  projectId: 'memory-cue-app',
  storageBucket: 'memory-cue-app.firebasestorage.app',
  messagingSenderId: '751284466633',
  appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
  measurementId: 'G-R0V4M7VCE6'
};

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

async function setupDailyList(remindersReadyPromise) {
  if (
    !cuesTab ||
    !dailyTab ||
    !cuesView ||
    !dailyListView ||
    !dailyListHeader ||
    !quickAddForm ||
    !quickAddInput ||
    !dailyTasksContainer ||
    !clearCompletedBtn
  ) {
    return;
  }

  const locale = (() => {
    try {
      return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    } catch {
      return 'en-US';
    }
  })();

  let headerFormatter;
  try {
    headerFormatter = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    headerFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  let firestoreDepsPromise;

  const ensureFirestoreDeps = async () => {
    if (!firestoreDepsPromise) {
      firestoreDepsPromise = (async () => {
        try {
          await remindersReadyPromise;
        } catch (error) {
          console.warn('Reminders failed to initialise before Daily List', error);
        }
        const [{ getApps, getApp, initializeApp }, firestoreModule] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js')
        ]);
        const { getFirestore, doc, getDoc, setDoc, arrayUnion } = firestoreModule;
        let app;
        const apps = getApps();
        if (apps.length) {
          app = getApp();
        } else {
          app = initializeApp(FIREBASE_CONFIG);
        }
        const db = getFirestore(app);
        return { db, doc, getDoc, setDoc, arrayUnion };
      })();
    }
    return firestoreDepsPromise;
  };

  const getTodayId = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatHeaderDate = (dateId) => {
    const [year, month, day] = dateId.split('-').map((part) => parseInt(part, 10));
    const displayDate = new Date(year || 0, (month || 1) - 1, day || 1);
    return headerFormatter.format(displayDate);
  };

  const setHeaderForDate = (dateId) => {
    dailyListHeader.textContent = `Today's List – ${formatHeaderDate(dateId)}`;
  };

  let dailyTasks = [];

  const updateClearCompletedState = () => {
    const hasCompleted = dailyTasks.some((task) => task && task.completed);
    clearCompletedBtn.disabled = !hasCompleted;
  };

  const renderDailyTasks = () => {
    dailyTasksContainer.innerHTML = '';
    if (!dailyTasks.length) {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-slate-500 dark:text-slate-400';
      empty.textContent = 'No tasks for today yet. Add one above to get started.';
      dailyTasksContainer.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'space-y-3';

    dailyTasks.forEach((task, index) => {
      const item = document.createElement('li');
      item.className =
        'flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/80 p-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/40';

      const label = document.createElement('label');
      label.className = 'flex flex-1 items-center gap-3 cursor-pointer';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'checkbox checkbox-sm';
      checkbox.dataset.index = String(index);
      checkbox.checked = Boolean(task?.completed);

      const textSpan = document.createElement('span');
      textSpan.className = `flex-1 text-sm ${
        task?.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-100'
      }`;
      textSpan.textContent = typeof task?.text === 'string' ? task.text : '';

      label.append(checkbox, textSpan);
      item.append(label);
      list.append(item);
    });

    dailyTasksContainer.append(list);
  };

  const loadDailyList = async () => {
    const todayId = getTodayId();
    setHeaderForDate(todayId);
    dailyTasksContainer.innerHTML =
      '<p class="text-sm text-slate-500 dark:text-slate-400">Loading today&#39;s tasks…</p>';

    try {
      const deps = await ensureFirestoreDeps();
      const docRef = deps.doc(deps.db, 'dailyLists', todayId);
      const snapshot = await deps.getDoc(docRef);
      const data = snapshot.exists() ? snapshot.data() : null;
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      dailyTasks = tasks.map((task) => ({
        text: typeof task?.text === 'string' ? task.text : '',
        completed: Boolean(task?.completed)
      }));
      renderDailyTasks();
      updateClearCompletedState();
    } catch (error) {
      console.error("Failed to load today's daily list", error);
      dailyTasks = [];
      const errorMessage = document.createElement('p');
      errorMessage.className = 'text-sm text-rose-500 dark:text-rose-400';
      errorMessage.textContent = "We couldn't load today's tasks. Please try again soon.";
      dailyTasksContainer.innerHTML = '';
      dailyTasksContainer.append(errorMessage);
      updateClearCompletedState();
    }
  };

  const activateTab = (view) => {
    const showDaily = view === 'daily';
    const wasDailyVisible = !dailyListView.classList.contains('hidden');

    cuesTab.classList.toggle('tab-active', !showDaily);
    cuesTab.setAttribute('aria-selected', String(!showDaily));
    dailyTab.classList.toggle('tab-active', showDaily);
    dailyTab.setAttribute('aria-selected', String(showDaily));

    cuesView.classList.toggle('hidden', showDaily);
    dailyListView.classList.toggle('hidden', !showDaily);

    if (showDaily && !wasDailyVisible) {
      loadDailyList();
    }
  };

  cuesTab.addEventListener('click', () => {
    activateTab('cues');
  });

  dailyTab.addEventListener('click', () => {
    activateTab('daily');
  });

  quickAddForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = quickAddInput.value.trim();
    if (!value) {
      quickAddInput.focus();
      return;
    }

    const newTask = { text: value, completed: false };

    try {
      const deps = await ensureFirestoreDeps();
      const todayId = getTodayId();
      const docRef = deps.doc(deps.db, 'dailyLists', todayId);
      await deps.setDoc(docRef, { tasks: deps.arrayUnion(newTask) }, { merge: true });
      quickAddInput.value = '';
      await loadDailyList();
      quickAddInput.focus();
    } catch (error) {
      console.error('Failed to add task to daily list', error);
    }
  });

  dailyTasksContainer.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
      return;
    }

    const index = Number.parseInt(target.dataset.index || '', 10);
    if (Number.isNaN(index) || !dailyTasks[index]) {
      return;
    }

    const checked = target.checked;
    const updatedTasks = dailyTasks.map((task, taskIndex) =>
      taskIndex === index ? { ...task, completed: checked } : task
    );

    try {
      const deps = await ensureFirestoreDeps();
      const todayId = getTodayId();
      const docRef = deps.doc(deps.db, 'dailyLists', todayId);
      await deps.setDoc(docRef, { tasks: updatedTasks }, { merge: true });
      dailyTasks = updatedTasks;
      renderDailyTasks();
      updateClearCompletedState();
    } catch (error) {
      console.error('Failed to update daily task status', error);
      target.checked = !checked;
    }
  });

  clearCompletedBtn.addEventListener('click', async () => {
    const remaining = dailyTasks.filter((task) => !task?.completed);
    if (remaining.length === dailyTasks.length) {
      return;
    }

    try {
      const deps = await ensureFirestoreDeps();
      const todayId = getTodayId();
      const docRef = deps.doc(deps.db, 'dailyLists', todayId);
      await deps.setDoc(docRef, { tasks: remaining }, { merge: true });
      dailyTasks = remaining;
      renderDailyTasks();
      updateClearCompletedState();
    } catch (error) {
      console.error('Failed to clear completed daily tasks', error);
    }
  });

  setHeaderForDate(getTodayId());
  updateClearCompletedState();
}

const remindersInitPromise = initReminders({
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
}).catch((error) => {
  console.error('Failed to initialise reminders', error);
  throw error;
});

void setupDailyList(remindersInitPromise);
