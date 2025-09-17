// js/main.js

// Navigation helpers
const navButtons = [...document.querySelectorAll('.nav-desktop [data-route]')];

// Routing
const views = [...document.querySelectorAll('[data-view]')];
const viewMap = new Map(views.map(v => [v.dataset.view, v]));
const DEFAULT_VIEW = 'dashboard';

navButtons.forEach(btn => {
  if (!viewMap.has(btn.dataset.route)) {
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('cursor-not-allowed', 'opacity-60');
    btn.disabled = true;
  }
});

function show(view){
  let targetView = viewMap.get(view);
  if (!targetView) {
    if (view !== DEFAULT_VIEW) {
      view = DEFAULT_VIEW;
      targetView = viewMap.get(view);
    }
    if (!targetView) return false;
  }

  views.forEach(v => {
    v.hidden = v !== targetView;
  });

  history.replaceState(null, '', `#${view}`);

  // Update active navigation states
  function updateNavButtons(buttons, activeView){
    buttons.forEach(btn => {
      const isActive = btn.dataset.route === activeView;
      btn.classList.remove('bg-white/20', 'text-white');
      btn.classList.add('hover:bg-white/20', 'text-white/80', 'hover:text-white');
      if (isActive) {
        btn.setAttribute('aria-current', 'page');
        btn.classList.add('bg-white/20', 'text-white');
        btn.classList.remove('hover:bg-white/20', 'text-white/80', 'hover:text-white');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
  }

  updateNavButtons(navButtons, view);
  return true;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
  const route = btn.dataset.route;
  if (!viewMap.has(route)) return;
  e.preventDefault();
  show(route);
});

window.addEventListener('hashchange', () => {
  const v = (location.hash || `#${DEFAULT_VIEW}`).slice(1);
  show(v);
});

const initialView = (location.hash || `#${DEFAULT_VIEW}`).slice(1);
if (!show(initialView)) {
  show(DEFAULT_VIEW);
}

// Firebase auth
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');

if (typeof firebase !== 'undefined' && firebase.auth) {
  const auth = firebase.auth();

  signInBtn?.addEventListener('click', async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (err) {
      alert(err.message);
    }
  });

  signOutBtn?.addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged((user) => {
    if (user) {
      signInBtn.hidden = true;
      signOutBtn.hidden = false;
    } else {
      signInBtn.hidden = false;
      signOutBtn.hidden = true;
    }
  });
}

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');

function updateThemeToggleState(isDark){
  if (!themeToggle) return;
  const iconDark = themeToggle.dataset.iconDark || '🌙';
  const iconLight = themeToggle.dataset.iconLight || '☀️';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.textContent = isDark ? iconLight : iconDark;
  themeToggle.setAttribute('aria-label', isDark ? 'Activate light mode' : 'Activate dark mode');
}

function setTheme(t){
  document.documentElement.classList.toggle('dark', t === 'dark');
  localStorage.setItem('theme', t);
}

function toggleTheme(){
  const isPressed = themeToggle?.getAttribute('aria-pressed') === 'true';
  const isDark = themeToggle ? isPressed : document.documentElement.classList.contains('dark');
  const nextIsDark = !isDark;
  setTheme(nextIsDark ? 'dark' : 'light');
  updateThemeToggleState(nextIsDark);
}

themeToggle?.addEventListener('click', toggleTheme);
const preferred = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
setTheme(preferred);
updateThemeToggleState(preferred === 'dark');

// Reminders
const reminderInputs = {
  title: document.getElementById('title'),
  date: document.getElementById('date'),
  time: document.getElementById('time'),
  priority: document.getElementById('priority'),
};
const saveReminderBtn = document.getElementById('saveBtn');
const cancelEditReminderBtn = document.getElementById('cancelEditBtn');
const reminderStatus = document.getElementById('status');
const dateFeedback = document.getElementById('dateFeedback');
const reminderList = document.getElementById('reminderList');
const emptyState = document.getElementById('emptyState');
const filterButtons = [...document.querySelectorAll('[data-filter]')];
const sortSelect = document.getElementById('sort');
const reminderCounts = {
  today: document.getElementById('inlineTodayCount'),
  overdue: document.getElementById('inlineOverdueCount'),
  total: document.getElementById('inlineTotalCount'),
  completed: document.getElementById('inlineCompletedCount'),
};

const REMINDER_STORAGE_KEY = 'memoryCue.desktopReminders';
let reminders = loadStoredReminders();
let activeFilter = 'all';
let sortMode = sortSelect?.value || 'smart';
let editingReminderId = null;
const priorityRank = { High: 3, Medium: 2, Low: 1 };
const dayLabelFormatter = new Intl.DateTimeFormat('en-AU', { weekday: 'long' });
const shortDateFormatter = new Intl.DateTimeFormat('en-AU', { month: 'short', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });
const MS_IN_DAY = 86400000;

function loadStoredReminders(){
  try {
    const raw = localStorage.getItem(REMINDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        id: item.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        title: item.title || '',
        date: item.date || '',
        time: item.time || '',
        priority: item.priority || 'Medium',
        completed: Boolean(item.completed),
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
      }));
    }
  } catch (err) {
    console.warn('Unable to load reminders', err);
  }
  return [];
}

function persistReminders(){
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(reminders));
  } catch (err) {
    console.warn('Unable to save reminders', err);
  }
}

function toDateKey(date){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayKey(){
  return toDateKey(new Date());
}

function reminderDueDate(rem){
  if (!rem?.date) return null;
  const time = rem.time && rem.time.includes(':') ? rem.time : '00:00';
  const iso = `${rem.date}T${time}`;
  const due = new Date(iso);
  return Number.isNaN(due.getTime()) ? null : due;
}

function isReminderToday(rem){
  const due = reminderDueDate(rem);
  if (!due) return false;
  return toDateKey(due) === getTodayKey();
}

function isReminderOverdue(rem){
  const due = reminderDueDate(rem);
  if (!due) return false;
  return due < new Date() && !rem.completed;
}

function priorityValue(priority){
  return priorityRank[priority] ?? 0;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function formatDue(rem){
  const due = reminderDueDate(rem);
  if (!due) return 'No due date';
  const dayLabel = dayLabelFormatter.format(due);
  const dateLabel = shortDateFormatter.format(due);
  if (rem.time) {
    return `${dayLabel}, ${dateLabel} at ${timeFormatter.format(due)}`;
  }
  return `${dayLabel}, ${dateLabel}`;
}

function filterReminders(list){
  const todayKey = getTodayKey();
  return list.filter((rem) => {
    const due = reminderDueDate(rem);
    switch (activeFilter) {
      case 'today':
        return Boolean(due) && toDateKey(due) === todayKey;
      case 'overdue':
        return Boolean(due) && due < new Date() && !rem.completed;
      case 'done':
        return rem.completed;
      default:
        return true;
    }
  });
}

function sortReminders(list){
  const arr = [...list];
  arr.sort((a, b) => {
    const aDue = reminderDueDate(a);
    const bDue = reminderDueDate(b);
    const aTime = aDue ? aDue.getTime() : Number.POSITIVE_INFINITY;
    const bTime = bDue ? bDue.getTime() : Number.POSITIVE_INFINITY;

    if (sortMode === 'priority') {
      return priorityValue(b.priority) - priorityValue(a.priority);
    }

    if (sortMode === 'time') {
      return aTime - bTime;
    }

    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    const overdueDiff = (isReminderOverdue(b) ? 1 : 0) - (isReminderOverdue(a) ? 1 : 0);
    if (overdueDiff !== 0) {
      return overdueDiff;
    }

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    const priorityDiff = priorityValue(b.priority) - priorityValue(a.priority);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return arr;
}

function updateCounts(){
  const total = reminders.length;
  const todayCount = reminders.filter(isReminderToday).length;
  const overdueCount = reminders.filter(isReminderOverdue).length;
  const completedCount = reminders.filter((rem) => rem.completed).length;

  if (reminderCounts.today) reminderCounts.today.textContent = String(todayCount);
  if (reminderCounts.overdue) reminderCounts.overdue.textContent = String(overdueCount);
  if (reminderCounts.total) reminderCounts.total.textContent = String(total);
  if (reminderCounts.completed) reminderCounts.completed.textContent = String(completedCount);
}

function updateEmptyState(hasItems, hasAny){
  if (emptyState) {
    if (!hasAny) {
      emptyState.textContent = 'Add your first reminder to see it here.';
      emptyState.classList.remove('hidden');
    } else if (!hasItems) {
      emptyState.textContent = 'No reminders match this filter yet.';
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
    }
  }
  if (reminderList) {
    reminderList.classList.toggle('hidden', !hasItems);
  }
}

function createReminderElement(rem){
  const li = document.createElement('li');
  li.dataset.id = rem.id;
  li.className = 'p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm';
  const dueLabel = formatDue(rem);
  const priorityClasses = rem.priority === 'High'
    ? 'border-red-200 text-red-600 bg-red-100/70 dark:border-red-400/30 dark:text-red-300 dark:bg-red-500/10'
    : rem.priority === 'Medium'
      ? 'border-amber-200 text-amber-600 bg-amber-100/70 dark:border-amber-400/30 dark:text-amber-300 dark:bg-amber-500/10'
      : 'border-emerald-200 text-emerald-600 bg-emerald-100/70 dark:border-emerald-400/30 dark:text-emerald-300 dark:bg-emerald-500/10';
  const titleClasses = rem.completed
    ? 'line-through text-slate-400 dark:text-slate-500'
    : 'text-slate-900 dark:text-slate-100';
  const statusLabel = rem.completed ? 'Completed' : 'Active';
  const statusClasses = rem.completed ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400';

  li.innerHTML = `
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p class="text-lg font-semibold ${titleClasses}">${escapeHtml(rem.title)}</p>
        <div class="mt-2 flex flex-wrap gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span class="inline-flex items-center gap-2">
            <span class="inline-flex h-2 w-2 rounded-full bg-blue-400"></span>
            ${escapeHtml(dueLabel)}
          </span>
          <span class="inline-flex items-center gap-2 px-2 py-1 rounded-full border ${priorityClasses}">
            ${escapeHtml(rem.priority)} priority
          </span>
          <span class="${statusClasses}">${statusLabel}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 text-sm font-medium">
        <button data-action="toggle" class="px-3 py-2 rounded-lg ${rem.completed ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-500 text-white hover:bg-emerald-600'}">
          ${rem.completed ? 'Mark active' : 'Mark done'}
        </button>
        <button data-action="edit" class="px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600">Edit</button>
        <button data-action="delete" class="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600">Delete</button>
      </div>
    </div>
  `;
  return li;
}

function clearStatus(){
  if (!reminderStatus) return;
  reminderStatus.textContent = '';
  reminderStatus.className = 'text-sm';
}

function setStatus(message, tone = 'info'){
  if (!reminderStatus) return;
  reminderStatus.textContent = message;
  reminderStatus.className = 'text-sm mt-2';
  if (tone === 'error') {
    reminderStatus.classList.add('text-rose-500');
  } else if (tone === 'success') {
    reminderStatus.classList.add('text-emerald-500');
  } else {
    reminderStatus.classList.add('text-slate-500');
  }
}

function populateForm(rem){
  if (reminderInputs.title) reminderInputs.title.value = rem.title || '';
  if (reminderInputs.date) reminderInputs.date.value = rem.date || '';
  if (reminderInputs.time) reminderInputs.time.value = rem.time || '';
  if (reminderInputs.priority) reminderInputs.priority.value = rem.priority || 'Medium';
}

function resetForm(){
  if (reminderInputs.title) reminderInputs.title.value = '';
  if (reminderInputs.date) reminderInputs.date.value = '';
  if (reminderInputs.time) reminderInputs.time.value = '';
  if (reminderInputs.priority) reminderInputs.priority.value = 'Medium';
  editingReminderId = null;
  if (saveReminderBtn) saveReminderBtn.textContent = 'Save Reminder';
  cancelEditReminderBtn?.classList.add('hidden');
  updateDateFeedback();
}

function renderReminders(){
  const filtered = sortReminders(filterReminders(reminders));
  updateCounts();

  if (reminderList) {
    reminderList.innerHTML = '';
    filtered.forEach((rem) => {
      reminderList.appendChild(createReminderElement(rem));
    });
  }

  updateEmptyState(filtered.length > 0, reminders.length > 0);
}

function saveReminder(){
  const titleValue = reminderInputs.title?.value.trim() || '';
  if (!titleValue) {
    setStatus('Please enter a reminder title.', 'error');
    reminderInputs.title?.focus();
    return;
  }

  const reminderData = {
    title: titleValue,
    date: reminderInputs.date?.value || '',
    time: reminderInputs.time?.value || '',
    priority: reminderInputs.priority?.value || 'Medium',
  };

  if (editingReminderId) {
    const existing = reminders.find((rem) => rem.id === editingReminderId);
    if (existing) {
      Object.assign(existing, reminderData, { updatedAt: Date.now() });
      setStatus('Reminder updated.', 'success');
    }
  } else {
    reminders.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ...reminderData,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setStatus('Reminder saved.', 'success');
  }

  persistReminders();
  renderReminders();
  resetForm();
}

function enterEditMode(rem){
  editingReminderId = rem.id;
  populateForm(rem);
  if (saveReminderBtn) saveReminderBtn.textContent = 'Update Reminder';
  cancelEditReminderBtn?.classList.remove('hidden');
  setStatus('Editing reminder…', 'info');
  reminderInputs.title?.focus();
  updateDateFeedback();
}

function handleListClick(event){
  const actionBtn = event.target.closest('[data-action]');
  if (!actionBtn) return;
  const item = actionBtn.closest('li[data-id]');
  if (!item) return;
  const reminder = reminders.find((rem) => rem.id === item.dataset.id);
  if (!reminder) return;

  switch (actionBtn.dataset.action) {
    case 'toggle':
      reminder.completed = !reminder.completed;
      reminder.updatedAt = Date.now();
      persistReminders();
      renderReminders();
      setStatus(reminder.completed ? 'Reminder marked as done.' : 'Reminder marked as active.', 'success');
      break;
    case 'edit':
      enterEditMode(reminder);
      break;
    case 'delete':
      reminders = reminders.filter((rem) => rem.id !== reminder.id);
      persistReminders();
      renderReminders();
      setStatus('Reminder removed.', 'info');
      break;
    default:
      break;
  }
}

function updateActiveFilter(){
  filterButtons.forEach((btn) => {
    const isActive = btn.dataset.filter === activeFilter;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.classList.toggle('ring-2', isActive);
    btn.classList.toggle('ring-offset-2', isActive);
    btn.classList.toggle('ring-purple-400', isActive);
  });
}

function updateDateFeedback(){
  if (!dateFeedback) return;
  const dateValue = reminderInputs.date?.value;
  if (!dateValue) {
    dateFeedback.textContent = '';
    dateFeedback.classList.add('hidden');
    dateFeedback.classList.remove('text-emerald-500', 'text-amber-500', 'text-rose-500');
    dateFeedback.classList.add('text-slate-500');
    return;
  }

  const due = reminderDueDate({ date: dateValue, time: reminderInputs.time?.value || '' });
  if (!due) {
    dateFeedback.textContent = 'Enter a valid date to track your reminder.';
    dateFeedback.classList.remove('hidden', 'text-emerald-500', 'text-amber-500', 'text-rose-500');
    dateFeedback.classList.add('text-slate-500');
    return;
  }

  const today = new Date();
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueMidnight.getTime() - todayMidnight.getTime()) / MS_IN_DAY);

  let message;
  if (diffDays === 0) {
    message = 'Due today';
  } else if (diffDays === 1) {
    message = 'Due tomorrow';
  } else if (diffDays > 1) {
    message = `Due in ${diffDays} days`;
  } else if (diffDays === -1) {
    message = 'Was due yesterday';
  } else {
    message = `Overdue by ${Math.abs(diffDays)} days`;
  }

  const timePart = reminderInputs.time?.value ? ` • ${timeFormatter.format(due)}` : '';
  const detail = `${dayLabelFormatter.format(due)}, ${shortDateFormatter.format(due)}${timePart}`;
  dateFeedback.textContent = `${message} (${detail})`;
  dateFeedback.classList.remove('hidden', 'text-emerald-500', 'text-amber-500', 'text-rose-500', 'text-slate-500');
  if (diffDays < 0) {
    dateFeedback.classList.add('text-rose-500');
  } else if (diffDays === 0) {
    dateFeedback.classList.add('text-emerald-500');
  } else if (diffDays === 1) {
    dateFeedback.classList.add('text-amber-500');
  } else {
    dateFeedback.classList.add('text-slate-500');
  }
}

saveReminderBtn?.addEventListener('click', (event) => {
  event.preventDefault();
  saveReminder();
});

cancelEditReminderBtn?.addEventListener('click', () => {
  resetForm();
  setStatus('Edit cancelled.', 'info');
});

reminderInputs.date?.addEventListener('input', () => {
  clearStatus();
  updateDateFeedback();
});
reminderInputs.time?.addEventListener('input', () => {
  clearStatus();
  updateDateFeedback();
});

reminderList?.addEventListener('click', handleListClick);

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter || 'all';
    updateActiveFilter();
    renderReminders();
  });
});

sortSelect?.addEventListener('change', () => {
  sortMode = sortSelect.value;
  renderReminders();
});

updateActiveFilter();
renderReminders();
updateDateFeedback();

// Planner
const plannerWeekEl = document.getElementById('planner-week');
const plannerGrid = document.getElementById('planner-grid');
const plannerPrevBtn = document.getElementById('planner-prev');
const plannerTodayBtn = document.getElementById('planner-today');
const plannerNextBtn = document.getElementById('planner-next');
const PLANNER_STORAGE_KEY = 'memoryCue.desktopPlanner';
let plannerWeekOffset = 0;
let plannerNotes = loadPlannerNotes();

const plannerRangeFormatter = new Intl.DateTimeFormat('en-AU', { month: 'long', day: 'numeric' });
const plannerDayFormatter = new Intl.DateTimeFormat('en-AU', { weekday: 'long' });

function loadPlannerNotes(){
  try {
    const raw = localStorage.getItem(PLANNER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('Unable to load planner notes', err);
    return {};
  }
}

function persistPlannerNotes(){
  try {
    localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(plannerNotes));
  } catch (err) {
    console.warn('Unable to save planner notes', err);
  }
}

function getWeekStart(offset = 0){
  const now = new Date();
  const start = new Date(now);
  const day = start.getDay();
  const diff = (day + 6) % 7;
  start.setDate(start.getDate() - diff + offset * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

function buildPlannerDay(date){
  const dayName = plannerDayFormatter.format(date);
  const rangeLabel = plannerRangeFormatter.format(date);
  const key = toDateKey(date);
  const column = document.createElement('div');
  column.className = 'p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 shadow-sm flex flex-col';
  const heading = document.createElement('h4');
  heading.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
  heading.textContent = dayName;
  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-slate-500 dark:text-slate-400';
  subtitle.textContent = rangeLabel;
  const noteArea = document.createElement('textarea');
  noteArea.className = 'mt-4 min-h-[120px] w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white/70 dark:bg-slate-900/50 p-3 text-sm text-slate-700 dark:text-slate-200';
  noteArea.placeholder = 'Capture lesson focuses, to-dos or reminders…';
  noteArea.value = plannerNotes[key] || '';
  noteArea.dataset.date = key;
  noteArea.addEventListener('input', () => {
    plannerNotes[key] = noteArea.value;
    persistPlannerNotes();
  });
  column.append(heading, subtitle, noteArea);
  return column;
}

function renderPlanner(){
  if (!plannerWeekEl || !plannerGrid) return;
  const start = getWeekStart(plannerWeekOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  plannerWeekEl.textContent = `Week of ${plannerRangeFormatter.format(start)} – ${plannerRangeFormatter.format(end)}`;
  plannerGrid.innerHTML = '';
  for (let i = 0; i < 7; i += 1) {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + i);
    plannerGrid.appendChild(buildPlannerDay(dayDate));
  }
}

function changePlannerWeek(delta){
  if (delta === 0) {
    plannerWeekOffset = 0;
  } else {
    plannerWeekOffset += delta;
  }
  renderPlanner();
}

plannerPrevBtn?.addEventListener('click', () => changePlannerWeek(-1));
plannerTodayBtn?.addEventListener('click', () => changePlannerWeek(0));
plannerNextBtn?.addEventListener('click', () => changePlannerWeek(1));

if (plannerWeekEl && plannerGrid) {
  renderPlanner();
}

// Notes
const noteEl = document.getElementById('quick-note');
const savedSelect = document.getElementById('saved-notes');

function getNotes(){
  return JSON.parse(localStorage.getItem('saved-notes') || '[]');
}

function saveNotes(notes){
  localStorage.setItem('saved-notes', JSON.stringify(notes));
}

function refreshSelect(){
  if(!savedSelect) return;
  const notes = getNotes();
  savedSelect.innerHTML = '<option value="">Select a note</option>' +
    notes.map((n, i) => `<option value="${i}">${n.title}</option>`).join('');
}

if(noteEl){
  refreshSelect();

  document.getElementById('save-note')?.addEventListener('click', () => {
    const content = noteEl.innerHTML;
    const title = content.replace(/<[^>]+>/g, '').slice(0, 20) || 'Untitled';
    const notes = getNotes();
    notes.push({ title, content });
    saveNotes(notes);
    refreshSelect();
  });

  document.getElementById('load-note')?.addEventListener('click', () => {
    const idx = savedSelect?.value;
    const notes = getNotes();
    if(idx !== '' && notes[idx]){
      noteEl.innerHTML = notes[idx].content;
    }
  });

  document.getElementById('clear-note')?.addEventListener('click', () => {
    noteEl.innerHTML = '';
  });

  document.getElementById('bullet-btn')?.addEventListener('click', () => {
    document.execCommand('insertUnorderedList');
  });

  document.getElementById('number-btn')?.addEventListener('click', () => {
    document.execCommand('insertOrderedList');
  });
}