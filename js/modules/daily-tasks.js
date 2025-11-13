import { escapeCueText } from './field-helpers.js';

const DAILY_TASKS_STORAGE_KEY = 'dailyTasksByDate';
const PRIORITY_ORDER = ['high', 'medium', 'low'];
const PRIORITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};
const DEFAULT_CATEGORY = 'general';

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatDuration(milliseconds = 0) {
  const safeValue = Number.isFinite(milliseconds) ? milliseconds : 0;
  if (safeValue <= 0) {
    return '0m';
  }
  const totalSeconds = Math.floor(safeValue / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (minutes) {
    parts.push(`${minutes}m`);
  }
  if (!hours && !minutes) {
    parts.push(`${seconds}s`);
  }
  return parts.join(' ');
}

/**
 * @returns {string}
 */
function getTodayDateId() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * @param {string} dateId
 * @returns {string}
 */
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
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  return formatter.format(displayDate);
}

/**
 * @typedef {object} DailyTask
 * @property {string} id
 * @property {string} text
 * @property {boolean} completed
 * @property {"high"|"medium"|"low"} priority
 * @property {string} category
 * @property {number} createdAt
 * @property {number|null} completedAt
 * @property {number} timeTrackedMs
 * @property {number|null} estimateMs
 */

/**
 * @param {Partial<DailyTask>} task
 * @returns {DailyTask}
 */
function normaliseDailyTask(task = {}) {
  const text = typeof task?.text === 'string' ? task.text.trim() : '';
  const priorityRaw = typeof task?.priority === 'string' ? task.priority.toLowerCase() : '';
  const priority = PRIORITY_ORDER.includes(priorityRaw) ? priorityRaw : 'medium';
  const category = typeof task?.category === 'string' && task.category.trim() ? task.category.trim() : DEFAULT_CATEGORY;
  const now = Date.now();
  const createdAt = Number.isFinite(task?.createdAt) ? Number(task.createdAt) : now;
  const completedAt = Number.isFinite(task?.completedAt) ? Number(task.completedAt) : null;
  const timeTrackedMs = Number.isFinite(task?.timeTrackedMs) ? Number(task.timeTrackedMs) : 0;
  const estimateMs = Number.isFinite(task?.estimateMs) ? Number(task.estimateMs) : null;
  const completed = Boolean(task?.completed);
  const id =
    typeof task?.id === 'string' && task.id
      ? task.id
      : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${createdAt}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    text,
    completed,
    priority,
    category,
    createdAt,
    completedAt: completed ? completedAt ?? now : null,
    timeTrackedMs: completed ? timeTrackedMs || Math.max(0, (completedAt ?? now) - createdAt) : timeTrackedMs,
    estimateMs
  };
}

/**
 * @param {DailyTask[]} tasks
 * @returns {DailyTask[]}
 */
function normaliseDailyTaskArray(tasks) {
  return Array.isArray(tasks) ? tasks.map((task) => normaliseDailyTask(task)) : [];
}

/**
 * Parse metadata tokens from quick add text.
 * Supported tokens:
 *  - !high | !medium | !low for priority
 *  - #category for category name
 *  - @<number>[m|h] for estimated duration in minutes or hours
 * @param {string} raw
 */
function extractQuickAddMetadata(raw) {
  const result = {
    text: raw,
    priority: 'medium',
    category: DEFAULT_CATEGORY,
    estimateMs: null
  };
  if (typeof raw !== 'string') {
    result.text = '';
    return result;
  }
  let text = raw;
  const priorityMatch = raw.match(/!(high|medium|low)/i);
  if (priorityMatch) {
    result.priority = priorityMatch[1].toLowerCase();
    text = text.replace(priorityMatch[0], '').trim();
  }
  const categoryMatch = raw.match(/#([a-z0-9_-]+)/i);
  if (categoryMatch) {
    result.category = categoryMatch[1].toLowerCase();
    text = text.replace(categoryMatch[0], '').trim();
  }
  const estimateMatch = raw.match(/@([0-9]+)(h|m)?/i);
  if (estimateMatch) {
    const numeric = Number.parseInt(estimateMatch[1], 10);
    if (Number.isFinite(numeric)) {
      const unit = (estimateMatch[2] || 'm').toLowerCase();
      const multiplier = unit === 'h' ? 60 : 1;
      result.estimateMs = numeric * multiplier * 60_000;
    }
    text = text.replace(estimateMatch[0], '').trim();
  }
  result.text = text.trim();
  if (!result.text) {
    result.text = raw.trim();
  }
  return result;
}

export class DailyTasksManager {
  /**
   * @param {object} [options]
   * @param {HTMLElement|null} [options.dailyTab]
   * @param {HTMLElement|null} [options.dailyView]
   * @param {HTMLElement|null} [options.dailyListHeader]
   * @param {HTMLFormElement|null} [options.quickAddForm]
   * @param {HTMLInputElement|null} [options.quickAddInput]
   * @param {HTMLElement|null} [options.quickAddVoiceButton]
   * @param {HTMLElement|null} [options.dailyTasksContainer]
   * @param {HTMLElement|null} [options.clearCompletedButton]
   * @param {HTMLElement|null} [options.dailyListPermissionNotice]
   * @param {HTMLElement|null} [options.cuesTab]
   * @param {HTMLElement|null} [options.cuesView]
   * @param {() => Promise<any>} [options.ensureCueFirestore]
   * @param {Storage} [options.storage]
   * @param {Window} [options.window]
   * @param {Document} [options.document]
   * @param {boolean} [options.forceLocalMode]
   */
  constructor(options = {}) {
    this.dailyTab = options.dailyTab ?? null;
    this.dailyView = options.dailyView ?? null;
    this.dailyListHeader = options.dailyListHeader ?? null;
    this.quickAddForm = options.quickAddForm ?? null;
    this.quickAddInput = options.quickAddInput ?? null;
    this.quickAddVoiceButton = options.quickAddVoiceButton ?? null;
    this.dailyTasksContainer = options.dailyTasksContainer ?? null;
    this.clearCompletedButton = options.clearCompletedButton ?? null;
    this.dailyListPermissionNotice = options.dailyListPermissionNotice ?? null;
    this.cuesTab = options.cuesTab ?? null;
    this.cuesView = options.cuesView ?? null;
    this.ensureCueFirestore = typeof options.ensureCueFirestore === 'function' ? options.ensureCueFirestore : null;
    this.storage = options.storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    this.window = options.window ?? window;
    this.document = options.document ?? document;
    this.forceLocalMode = Boolean(options.forceLocalMode);

    /** @type {DailyTask[]} */
    this.tasks = [];
    this.dailyListLoadPromise = null;
    this.shouldUseLocalDailyList = this.forceLocalMode;
    this.firestoreDailyListContextPromise = null;
    this.activeTimers = new Map();
    this.undoStack = [];
    this.quickAddVoiceRecognition = null;
    this.quickAddVoiceListening = false;
    this.quickAddVoiceRestartTimer = null;
    this.todayId = getTodayDateId();
    this.statsElement = null;
    this.undoButton = null;

    this.boundDailyTabClick = (event) => {
      event.preventDefault();
      this.switchToDailyView();
    };
    this.boundCuesTabClick = (event) => {
      event.preventDefault();
      this.switchToCuesView();
    };
    this.boundClearCompletedClick = () => {
      void this.clearCompleted();
    };
    this.boundQuickAddSubmit = (event) => {
      event.preventDefault();
      const value = this.quickAddInput?.value?.trim() ?? '';
      if (!value) {
        this.quickAddInput?.focus();
        return;
      }
      this.quickAddInput.value = '';
      void this.handleQuickAdd(value);
    };
    this.boundQuickAddFormStopVoice = () => {
      if (this.quickAddVoiceListening) {
        this.stopQuickAddVoiceRecognition();
      }
    };
    this.boundVoiceButtonClick = () => {
      if (!this.quickAddVoiceRecognition) {
        return;
      }
      if (this.quickAddVoiceListening) {
        this.stopQuickAddVoiceRecognition();
      } else {
        this.startQuickAddVoiceRecognition();
      }
    };
    this.boundPageHide = () => {
      if (this.quickAddVoiceListening) {
        this.stopQuickAddVoiceRecognition();
      }
    };
    this.boundTaskContainerChange = (event) => {
      const target = event.target;
      if (!(target instanceof this.window.HTMLInputElement) || target.type !== 'checkbox') {
        return;
      }
      const taskId = target.getAttribute('data-task-id');
      if (!taskId) {
        return;
      }
      void this.completeTask(taskId, target.checked);
    };
    this.boundTaskContainerClick = (event) => {
      const target = event.target instanceof this.window.HTMLElement ? event.target : null;
      if (!target) {
        return;
      }
      const taskRow = target.closest('[data-task-id]');
      if (!taskRow) {
        return;
      }
      const taskId = taskRow.getAttribute('data-task-id');
      if (!taskId) {
        return;
      }
      const action = target.getAttribute('data-action');
      if (action === 'cycle-priority') {
        this.cycleTaskPriority(taskId);
        return;
      }
      if (action === 'delete-task') {
        this.deleteTask(taskId);
        return;
      }
    };
    this.boundUndoClick = () => {
      this.undoLastAction();
    };

    this.init();
  }

  init() {
    this.setupStatsElement();
    this.setupUndoButton();
    this.setupEventListeners();
    this.initialiseQuickAddVoiceRecognition();
    void this.loadDailyTasks();
  }

  setupStatsElement() {
    if (!this.dailyTasksContainer || !this.document) {
      return;
    }
    if (this.statsElement) {
      return;
    }
    const stats = this.document.createElement('div');
    stats.className = 'text-sm text-base-content/70 mb-2 flex items-center gap-3';
    stats.dataset.role = 'daily-task-stats';
    stats.textContent = 'No tasks yet';
    this.dailyTasksContainer.insertAdjacentElement('beforebegin', stats);
    this.statsElement = stats;
  }

  setupUndoButton() {
    if (!this.clearCompletedButton || !this.document) {
      return;
    }
    if (this.undoButton) {
      return;
    }
    const undo = this.document.createElement('button');
    undo.type = 'button';
    undo.className = 'btn btn-ghost btn-sm ml-2 hidden';
    undo.textContent = 'Undo';
    undo.setAttribute('aria-label', 'Undo last daily task action');
    this.clearCompletedButton.insertAdjacentElement('afterend', undo);
    this.undoButton = undo;
    this.undoButton.addEventListener('click', this.boundUndoClick);
  }

  setupEventListeners() {
    this.dailyTab?.addEventListener('click', this.boundDailyTabClick);
    this.cuesTab?.addEventListener('click', this.boundCuesTabClick);
    this.clearCompletedButton?.addEventListener('click', this.boundClearCompletedClick);
    this.quickAddForm?.addEventListener('submit', this.boundQuickAddSubmit);
    this.quickAddForm?.addEventListener('submit', this.boundQuickAddFormStopVoice);
    this.quickAddVoiceButton?.addEventListener('click', this.boundVoiceButtonClick);
    this.window?.addEventListener?.('pagehide', this.boundPageHide);
    this.dailyTasksContainer?.addEventListener('change', this.boundTaskContainerChange);
    this.dailyTasksContainer?.addEventListener('click', this.boundTaskContainerClick);
  }

  cleanup() {
    this.dailyTab?.removeEventListener('click', this.boundDailyTabClick);
    this.cuesTab?.removeEventListener('click', this.boundCuesTabClick);
    this.clearCompletedButton?.removeEventListener('click', this.boundClearCompletedClick);
    this.quickAddForm?.removeEventListener('submit', this.boundQuickAddSubmit);
    this.quickAddForm?.removeEventListener('submit', this.boundQuickAddFormStopVoice);
    this.quickAddVoiceButton?.removeEventListener('click', this.boundVoiceButtonClick);
    this.window?.removeEventListener?.('pagehide', this.boundPageHide);
    this.dailyTasksContainer?.removeEventListener('change', this.boundTaskContainerChange);
    this.dailyTasksContainer?.removeEventListener('click', this.boundTaskContainerClick);
    this.undoButton?.removeEventListener('click', this.boundUndoClick);
    this.stopQuickAddVoiceRecognition();
    this.window?.clearTimeout?.(this.quickAddVoiceRestartTimer);
  }

  activateTab(tabToActivate) {
    const tabs = [this.cuesTab, this.dailyTab].filter(Boolean);
    tabs.forEach((tab) => {
      const element = tab;
      if (!element) {
        return;
      }
      const isActive = tab === tabToActivate;
      element.classList.toggle('tab-active', isActive);
      element.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  switchToDailyView() {
    if (!this.dailyView) {
      return;
    }
    this.cuesView?.classList.add('hidden');
    this.dailyView.classList.remove('hidden');
    this.activateTab(this.dailyTab ?? null);
    void this.loadDailyTasks();
  }

  switchToCuesView() {
    if (!this.cuesView || !this.dailyView) {
      return;
    }
    this.cuesView.classList.remove('hidden');
    this.dailyView.classList.add('hidden');
    this.activateTab(this.cuesTab ?? null);
  }

  /**
   * @param {boolean} isActive
   */
  setQuickAddVoiceButtonActive(isActive) {
    const button = this.quickAddVoiceButton;
    if (!button) {
      return;
    }
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    const iconSpan = button.querySelector('[aria-hidden="true"]');
    if (iconSpan) {
      iconSpan.textContent = isActive ? '👂' : '🎙️';
      return;
    }
    button.textContent = isActive ? '👂' : '🎙️';
  }

  scheduleQuickAddVoiceRestart() {
    if (!this.quickAddVoiceListening) {
      return;
    }
    this.window?.clearTimeout?.(this.quickAddVoiceRestartTimer);
    this.quickAddVoiceRestartTimer = this.window?.setTimeout?.(() => {
      this.quickAddVoiceRestartTimer = null;
      if (this.quickAddVoiceListening) {
        this.startQuickAddVoiceRecognition(true);
      }
    }, 400);
  }

  startQuickAddVoiceRecognition(forceRestart = false) {
    if (!this.quickAddVoiceRecognition) {
      return false;
    }
    if (this.quickAddVoiceListening && !forceRestart) {
      return true;
    }
    try {
      this.quickAddVoiceRecognition.start();
      this.quickAddVoiceListening = true;
      this.setQuickAddVoiceButtonActive(true);
      return true;
    } catch {
      this.quickAddVoiceListening = false;
      this.setQuickAddVoiceButtonActive(false);
      return false;
    }
  }

  stopQuickAddVoiceRecognition() {
    if (!this.quickAddVoiceRecognition) {
      return;
    }
    this.quickAddVoiceListening = false;
    this.window?.clearTimeout?.(this.quickAddVoiceRestartTimer);
    try {
      this.quickAddVoiceRecognition.stop();
    } catch {
      // ignore stop errors to keep UI responsive
    }
    this.setQuickAddVoiceButtonActive(false);
  }

  initialiseQuickAddVoiceRecognition() {
    const button = this.quickAddVoiceButton;
    if (!button || !this.window) {
      return;
    }
    try {
      const SpeechRecognitionCtor =
        this.window.SpeechRecognition ||
        this.window.webkitSpeechRecognition ||
        this.window.mozSpeechRecognition ||
        this.window.msSpeechRecognition;
      if (!SpeechRecognitionCtor) {
        button.setAttribute('disabled', 'true');
        button.setAttribute('aria-disabled', 'true');
        button.title = 'Voice input is not supported in this browser.';
        return;
      }
      this.quickAddVoiceRecognition = new SpeechRecognitionCtor();
      const lang = this.document?.documentElement?.lang || this.window.navigator?.language || 'en-AU';
      this.quickAddVoiceRecognition.lang = lang;
      this.quickAddVoiceRecognition.interimResults = false;
      if ('continuous' in this.quickAddVoiceRecognition) {
        try {
          this.quickAddVoiceRecognition.continuous = true;
        } catch {
          // ignore unsupported assignments
        }
      }
      this.quickAddVoiceRecognition.onresult = (event) => {
        const transcript = event?.results?.[0]?.[0]?.transcript || '';
        if (!transcript) {
          return;
        }
        if (this.quickAddInput) {
          this.quickAddInput.value = transcript.trim();
          try {
            this.quickAddInput.focus({ preventScroll: true });
          } catch {
            this.quickAddInput.focus();
          }
          try {
            const length = this.quickAddInput.value.length;
            this.quickAddInput.setSelectionRange(length, length);
          } catch {
            // ignore selection errors in unsupported browsers
          }
        }
      };
      this.quickAddVoiceRecognition.onend = () => {
        if (!this.quickAddVoiceListening) {
          this.setQuickAddVoiceButtonActive(false);
          return;
        }
        this.scheduleQuickAddVoiceRestart();
      };
      this.quickAddVoiceRecognition.onerror = () => {
        this.quickAddVoiceListening = false;
        this.setQuickAddVoiceButtonActive(false);
      };
    } catch {
      this.quickAddVoiceRecognition = null;
      this.setQuickAddVoiceButtonActive(false);
      button.setAttribute('disabled', 'true');
      button.setAttribute('aria-disabled', 'true');
    }
  }

  showPermissionNotice() {
    this.dailyListPermissionNotice?.classList.remove('hidden');
  }

  hidePermissionNotice() {
    this.dailyListPermissionNotice?.classList.add('hidden');
  }

  updateClearCompletedButtonState() {
    if (!this.clearCompletedButton) {
      return;
    }
    const hasCompletedTasks = this.tasks.some((task) => Boolean(task?.completed));
    this.clearCompletedButton.disabled = !hasCompletedTasks;
  }

  updateStats() {
    if (!this.statsElement) {
      return;
    }
    if (!this.tasks.length) {
      this.statsElement.textContent = 'No tasks yet';
      return;
    }
    const completed = this.tasks.filter((task) => task.completed).length;
    const remaining = this.tasks.length - completed;
    const totalTracked = this.tasks.reduce((total, task) => total + (task.timeTrackedMs || 0), 0);
    this.statsElement.textContent = `Tasks: ${this.tasks.length} • Completed: ${completed} • Remaining: ${remaining} • Tracked: ${formatDuration(totalTracked)}`;
  }

  renderDailyTasks() {
    if (!this.dailyTasksContainer) {
      return;
    }
    if (!Array.isArray(this.tasks) || this.tasks.length === 0) {
      this.dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">No tasks for today yet.</p>';
      this.updateClearCompletedButtonState();
      this.updateStats();
      return;
    }
    const sorted = [...this.tasks].sort((a, b) => {
      const priorityComparison = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (priorityComparison !== 0) {
        return priorityComparison;
      }
      return a.createdAt - b.createdAt;
    });
    const markup = sorted
      .map((task) => {
        const safeText = escapeCueText(task.text || '');
        const completed = Boolean(task.completed);
        const textClasses = ['ml-3', 'flex-1', 'text-sm', 'sm:text-base', 'text-base-content'];
        if (completed) {
          textClasses.push('line-through', 'text-opacity-50');
        }
        const priorityLabel = PRIORITY_LABELS[task.priority] ?? 'Medium';
        const metaParts = [`Priority: ${priorityLabel}`, `Category: ${escapeCueText(task.category)}`];
        if (task.completedAt) {
          const duration = Math.max(0, task.completedAt - task.createdAt);
          metaParts.push(`Time: ${formatDuration(duration)}`);
        } else if (task.estimateMs) {
          metaParts.push(`Estimate: ${formatDuration(task.estimateMs)}`);
        }
        return `
        <div class="flex flex-col gap-1 p-3 border-b border-base-200" data-task-id="${task.id}">
          <div class="flex items-center gap-3">
            <input type="checkbox" class="checkbox checkbox-sm" data-task-id="${task.id}" ${completed ? 'checked' : ''} />
            <span class="${textClasses.join(' ')}">${safeText}</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-base-content/70">
            <span>${metaParts.join(' • ')}</span>
            <button type="button" class="btn btn-ghost btn-xs" data-action="cycle-priority">Priority: ${priorityLabel}</button>
            <button type="button" class="btn btn-ghost btn-xs" data-action="delete-task">Delete</button>
          </div>
        </div>
      `;
      })
      .join('');
    this.dailyTasksContainer.innerHTML = markup;
    this.updateClearCompletedButtonState();
    this.updateStats();
  }

  async loadDailyTasks() {
    if (!this.dailyListHeader || !this.dailyTasksContainer) {
      return [];
    }
    const todayId = getTodayDateId();
    this.todayId = todayId;
    const formatted = formatDateForHeader(todayId);
    this.dailyListHeader.textContent = formatted ? `Today's List - ${formatted}` : "Today's List";

    if (this.shouldUseLocalDailyList) {
      this.showPermissionNotice();
      const localTasks = this.getLocalDailyTasks(todayId);
      this.tasks = localTasks;
      this.renderDailyTasks();
      return localTasks;
    }

    if (!this.dailyListLoadPromise) {
      this.dailyTasksContainer.innerHTML = '<p class="text-sm text-base-content/60">Loading tasks…</p>';
      this.updateClearCompletedButtonState();
      this.dailyListLoadPromise = (async () => {
        try {
          const firestore = await this.ensureDailyListFirestore();
          if (!firestore) {
            this.shouldUseLocalDailyList = true;
            this.showPermissionNotice();
            const localTasks = this.getLocalDailyTasks(todayId);
            this.tasks = localTasks;
            this.renderDailyTasks();
            return;
          }
          const ref = this.getDailyListDocRef(firestore, todayId);
          const snapshot = await firestore.getDoc(ref);
          const rawTasks = snapshot.exists() ? snapshot.data()?.tasks : [];
          this.tasks = normaliseDailyTaskArray(rawTasks);
          this.renderDailyTasks();
          this.setLocalDailyTasks(todayId, this.tasks);
          this.shouldUseLocalDailyList = false;
          this.hidePermissionNotice();
        } catch (error) {
          if (this.isPermissionDeniedError(error)) {
            console.warn('Falling back to local daily tasks due to permission issue', error);
            this.shouldUseLocalDailyList = true;
            this.showPermissionNotice();
            const localTasks = this.getLocalDailyTasks(todayId);
            this.tasks = localTasks;
            this.renderDailyTasks();
            return;
          }
          console.error('Failed to load daily list', error);
          this.dailyTasksContainer.innerHTML = '<p class="text-sm text-error">Unable to load daily tasks right now.</p>';
          this.tasks = [];
          this.updateClearCompletedButtonState();
          this.updateStats();
        }
      })().finally(() => {
        this.dailyListLoadPromise = null;
      });
    }
    await this.dailyListLoadPromise;
    return this.tasks;
  }

  async ensureDailyListFirestore() {
    if (!this.ensureCueFirestore) {
      return null;
    }
    if (this.firestoreDailyListContextPromise) {
      return this.firestoreDailyListContextPromise;
    }
    this.firestoreDailyListContextPromise = this.ensureCueFirestore()
      .then((base) => {
        const { db, getCollection } = base ?? {};
        const dailyListsCollection = typeof getCollection === 'function' && db ? getCollection(db, 'dailyLists') : null;
        return { ...base, dailyListsCollection };
      })
      .catch((error) => {
        console.error('Failed to initialise Firestore for daily lists', error);
        throw error;
      });
    return this.firestoreDailyListContextPromise;
  }

  getDailyListDocRef(firestore, dateId) {
    const { doc, dailyListsCollection, db } = firestore ?? {};
    if (typeof doc !== 'function') {
      throw new Error('Firestore document helper is unavailable');
    }
    if (dailyListsCollection) {
      return doc(dailyListsCollection, dateId);
    }
    return doc(db, 'dailyLists', dateId);
  }

  isPermissionDeniedError(error) {
    const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
    if (code) {
      return code.includes('permission-denied') || code.includes('insufficient-permission');
    }
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return Boolean(message && message.includes('permission'));
  }

  getLocalDailyTasks(dateId) {
    const map = this.readDailyTaskStorage();
    const tasks = map && typeof map === 'object' ? map[dateId] : [];
    return normaliseDailyTaskArray(tasks);
  }

  setLocalDailyTasks(dateId, tasks) {
    const map = this.readDailyTaskStorage();
    const payload = normaliseDailyTaskArray(tasks);
    map[dateId] = payload;
    this.writeDailyTaskStorage(map);
    return payload;
  }

  readDailyTaskStorage() {
    if (!this.storage || typeof this.storage.getItem !== 'function') {
      return {};
    }
    try {
      const raw = this.storage.getItem(DAILY_TASKS_STORAGE_KEY);
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

  writeDailyTaskStorage(map) {
    if (!this.storage || typeof this.storage.setItem !== 'function') {
      return;
    }
    try {
      const payload = map && typeof map === 'object' ? map : {};
      this.storage.setItem(DAILY_TASKS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to persist daily tasks locally', error);
    }
  }

  async handleQuickAdd(rawText) {
    const { text, priority, category, estimateMs } = extractQuickAddMetadata(rawText);
    if (!text) {
      this.quickAddInput?.focus();
      return;
    }
    const task = {
      text,
      completed: false,
      priority,
      category,
      estimateMs
    };
    if (this.quickAddInput) {
      this.quickAddInput.value = '';
      this.quickAddInput.focus();
    }
    try {
      await this.addDailyTask(task);
    } catch (error) {
      console.error('Failed to add task to the daily list', error);
      if (this.quickAddInput) {
        this.quickAddInput.value = rawText;
        this.quickAddInput.focus();
      }
    }
  }

  async addDailyTask(task) {
    const normalisedTask = normaliseDailyTask(task);
    const previousTasks = [...this.tasks];
    this.tasks = [...this.tasks, normalisedTask];
    this.renderDailyTasks();
    try {
      await this.saveDailyTasks(this.tasks);
      return normalisedTask;
    } catch (error) {
      console.error('Failed to persist new daily task', error);
      this.tasks = previousTasks;
      this.renderDailyTasks();
      throw error;
    }
  }

  async completeTask(taskId, completed) {
    const previousTasks = this.tasks.map((task) => ({ ...task }));
    let updated = false;
    this.tasks = this.tasks.map((task) => {
      if (task.id !== taskId) {
        return task;
      }
      updated = true;
      const completionTime = completed ? Date.now() : null;
      return {
        ...task,
        completed,
        completedAt: completionTime,
        timeTrackedMs: completed ? Math.max(0, (completionTime ?? Date.now()) - task.createdAt) : 0
      };
    });
    if (!updated) {
      return;
    }
    this.renderDailyTasks();
    try {
      await this.saveDailyTasks(this.tasks);
    } catch (error) {
      console.error('Failed to update task completion state', error);
      this.tasks = previousTasks;
      this.renderDailyTasks();
    }
  }

  async clearCompleted() {
    if (!this.tasks.length) {
      return;
    }
    const remainingTasks = this.tasks.filter((task) => !task.completed);
    if (remainingTasks.length === this.tasks.length) {
      return;
    }
    this.pushUndoState();
    const previousTasks = this.tasks;
    this.tasks = remainingTasks;
    this.renderDailyTasks();
    try {
      await this.saveDailyTasks(this.tasks);
    } catch (error) {
      console.error('Failed to clear completed tasks', error);
      this.tasks = previousTasks;
      this.renderDailyTasks();
      this.popUndoState();
    }
  }

  cycleTaskPriority(taskId) {
    const index = this.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return;
    }
    const previous = this.tasks[index];
    const currentIndex = PRIORITY_ORDER.indexOf(previous.priority);
    const nextPriority = PRIORITY_ORDER[(currentIndex + 1) % PRIORITY_ORDER.length];
    this.tasks = this.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            priority: nextPriority
          }
        : task
    );
    this.renderDailyTasks();
    void this.saveDailyTasks(this.tasks);
  }

  deleteTask(taskId) {
    const taskToDelete = this.tasks.find((task) => task.id === taskId);
    if (!taskToDelete) {
      return;
    }
    this.pushUndoState();
    this.tasks = this.tasks.filter((task) => task.id !== taskId);
    this.renderDailyTasks();
    void this.saveDailyTasks(this.tasks).catch((error) => {
      console.error('Failed to delete daily task', error);
      this.undoLastAction();
    });
  }

  pushUndoState() {
    this.undoStack.push({
      tasks: this.tasks.map((task) => ({ ...task }))
    });
    this.updateUndoButton();
  }

  popUndoState() {
    const popped = this.undoStack.pop();
    this.updateUndoButton();
    return popped;
  }

  undoLastAction() {
    const last = this.popUndoState();
    if (!last) {
      return;
    }
    this.tasks = normaliseDailyTaskArray(last.tasks);
    this.renderDailyTasks();
    void this.saveDailyTasks(this.tasks);
  }

  updateUndoButton() {
    if (!this.undoButton) {
      return;
    }
    if (this.undoStack.length) {
      this.undoButton.classList.remove('hidden');
    } else {
      this.undoButton.classList.add('hidden');
    }
  }

  readTodayId() {
    return this.todayId || getTodayDateId();
  }

  async saveDailyTasks(tasks) {
    const todayId = this.readTodayId();
    const payload = normaliseDailyTaskArray(tasks);
    if (this.shouldUseLocalDailyList) {
      this.setLocalDailyTasks(todayId, payload);
      return;
    }
    try {
      const firestore = await this.ensureDailyListFirestore();
      if (!firestore) {
        this.setLocalDailyTasks(todayId, payload);
        return;
      }
      const ref = this.getDailyListDocRef(firestore, todayId);
      if (typeof firestore.setDoc === 'function') {
        await firestore.setDoc(ref, { tasks: payload }, { merge: true });
      } else {
        await firestore.updateDoc(ref, { tasks: payload });
      }
      this.setLocalDailyTasks(todayId, payload);
    } catch (error) {
      if (this.isPermissionDeniedError(error)) {
        console.warn('Persisting daily tasks locally because cloud sync is unavailable', error);
        this.shouldUseLocalDailyList = true;
        this.showPermissionNotice();
        this.setLocalDailyTasks(todayId, payload);
        return;
      }
      throw error;
    }
  }
}

export function createDailyTasksManager(options) {
  return new DailyTasksManager(options);
}

export { formatDuration, extractQuickAddMetadata, normaliseDailyTask };
