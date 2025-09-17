// js/main.js

// Navigation helpers
const navButtons = [...document.querySelectorAll('.nav-desktop [data-route]')];

// Routing
const views = [...document.querySelectorAll('[data-view]')];
const viewMap = new Map(views.map(v => [v.dataset.view, v]));
const DEFAULT_VIEW = 'dashboard';
const ACTIVITY_EVENT_NAME = 'memoryCue:activity';
const ACTIVITY_QUEUE_LIMIT = 20;

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
    if (!targetView) return null;
  }

  views.forEach(v => {
    v.hidden = v !== targetView;
  });

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
  return view;
}

function getViewFromHash(){
  return (location.hash || `#${DEFAULT_VIEW}`).slice(1);
}

function syncViewFromHash(){
  const requestedView = getViewFromHash();
  const resolvedView = show(requestedView);
  if (!resolvedView) return;
  if (resolvedView !== requestedView) {
    history.replaceState(null, '', `#${resolvedView}`);
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
  const route = btn.dataset.route;
  if (!viewMap.has(route)) return;
  e.preventDefault();
  const targetHash = `#${route}`;
  if (location.hash === targetHash) {
    show(route);
  } else {
    location.hash = targetHash;
  }
});

window.addEventListener('hashchange', syncViewFromHash);

if (!location.hash) {
  location.hash = `#${DEFAULT_VIEW}`;
}

syncViewFromHash();

function normalizeActivityPayload(entry){
  if (!entry || typeof entry !== 'object') return null;
  const label = typeof entry.label === 'string' ? entry.label.trim() : '';
  if (!label) return null;
  const timestampSource = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const tsValid = timestampSource instanceof Date && !Number.isNaN(timestampSource.getTime());
  const timestamp = tsValid ? timestampSource : new Date();
  const payload = { ...entry };
  payload.label = label;
  payload.timestamp = timestamp.toISOString();
  if (!payload.target) {
    payload.target = { view: DEFAULT_VIEW };
  }
  if (!payload.id) {
    const seed = `${payload.type || 'activity'}-${timestamp.getTime()}-${Math.random().toString(16).slice(2, 8)}`;
    payload.id = seed;
  }
  return payload;
}

function dispatchActivityEvent(entry){
  const payload = normalizeActivityPayload(entry);
  if (!payload) return false;
  if (typeof window !== 'undefined') {
    const queue = Array.isArray(window.memoryCueActivityQueue) ? window.memoryCueActivityQueue : [];
    queue.push(payload);
    while (queue.length > ACTIVITY_QUEUE_LIMIT) queue.shift();
    window.memoryCueActivityQueue = queue;
  }
  if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function') {
    return false;
  }
  try {
    if (typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent(ACTIVITY_EVENT_NAME, { detail: payload }));
    } else if (document.createEvent) {
      const evt = document.createEvent('CustomEvent');
      if (evt && evt.initCustomEvent) {
        evt.initCustomEvent(ACTIVITY_EVENT_NAME, false, false, payload);
        document.dispatchEvent(evt);
      }
    }
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  const existing = typeof window.memoryCueActivity === 'object' && window.memoryCueActivity !== null
    ? window.memoryCueActivity
    : {};
  existing.push = dispatchActivityEvent;
  existing.eventName = ACTIVITY_EVENT_NAME;
  window.memoryCueActivity = existing;
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

// Date utilities shared across planner and notes
function toDateKey(date){
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Dashboard overview controller
const dashboardController = (() => {
  const lessonListEl = document.getElementById('dashboard-lessons-list');
  const deadlinesListEl = document.getElementById('dashboard-deadlines-list');
  const remindersListEl = document.getElementById('dashboard-reminders-list');
  const weatherStatusEl = document.getElementById('weather-status');
  const activityContainerEl = document.getElementById('dashboard-activity-container');
  const activityListEl = document.getElementById('dashboard-activity-list');
  const activityLoadingEl = document.getElementById('dashboard-activity-loading');
  const activityEmptyEl = document.getElementById('dashboard-activity-empty');

  const hasDashboard = lessonListEl
    || deadlinesListEl
    || remindersListEl
    || weatherStatusEl
    || activityContainerEl
    || activityListEl
    || activityLoadingEl
    || activityEmptyEl;
  const locale = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-AU';

  const headlineFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeFormatter = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const longTimeFormatter = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const activityTimestampFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const hasActivityFeed = Boolean(activityContainerEl || activityListEl || activityLoadingEl || activityEmptyEl);
  const ACTIVITY_MAX_ITEMS = 7;
  const activityState = { ready: false, items: [] };
  const activityIconMap = {
    lesson: '📚',
    deadline: '⏰',
    reminder: '🔔',
    planner: '🗓️',
    note: '📝',
    weather: '🌦️',
    general: '✨',
  };
  const activityViewLabels = {
    dashboard: 'Dashboard',
    reminders: 'Reminders',
    planner: 'Planner',
    notes: 'Notes',
    resources: 'Resources',
    templates: 'Templates',
    settings: 'Settings',
  };
  const dayLabelFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const dateEl = document.getElementById('dashboard-date');
  if (dateEl) {
    dateEl.textContent = headlineFormatter.format(new Date());
  }

  if (!hasDashboard) {
    return null;
  }

  const LESSON_STORAGE_KEY = 'memoryCue.dashboardLessons.v1';
  const DEADLINE_STORAGE_KEY = 'memoryCue.dashboardDeadlines.v1';
  const DEFAULT_WEATHER_LOCATION = { latitude: -33.8688, longitude: 151.2093, label: 'Sydney, AU' };
  const WEATHER_CODE_MAP = {
    0: { icon: '☀️', label: 'Clear sky' },
    1: { icon: '🌤️', label: 'Mostly clear' },
    2: { icon: '⛅️', label: 'Partly cloudy' },
    3: { icon: '☁️', label: 'Overcast' },
    45: { icon: '🌫️', label: 'Foggy' },
    48: { icon: '🌫️', label: 'Ice fog' },
    51: { icon: '🌦️', label: 'Light drizzle' },
    53: { icon: '🌦️', label: 'Drizzle' },
    55: { icon: '🌧️', label: 'Heavy drizzle' },
    56: { icon: '🌧️', label: 'Freezing drizzle' },
    57: { icon: '🌧️', label: 'Freezing drizzle' },
    61: { icon: '🌧️', label: 'Light rain' },
    63: { icon: '🌧️', label: 'Rain showers' },
    65: { icon: '🌧️', label: 'Heavy rain' },
    66: { icon: '🌧️', label: 'Freezing rain' },
    67: { icon: '🌧️', label: 'Freezing rain' },
    71: { icon: '🌨️', label: 'Light snow' },
    73: { icon: '🌨️', label: 'Snow' },
    75: { icon: '❄️', label: 'Heavy snow' },
    77: { icon: '❄️', label: 'Snow grains' },
    80: { icon: '🌦️', label: 'Light showers' },
    81: { icon: '🌧️', label: 'Showers' },
    82: { icon: '⛈️', label: 'Heavy showers' },
    85: { icon: '🌨️', label: 'Snow showers' },
    86: { icon: '🌨️', label: 'Heavy snow showers' },
    95: { icon: '⛈️', label: 'Thunderstorm' },
    96: { icon: '⛈️', label: 'Thunderstorm & hail' },
    99: { icon: '⛈️', label: 'Thunderstorm & hail' },
    default: { icon: 'ℹ️', label: 'Weather update' },
  };

  const overviewLessonCountEl = document.getElementById('dashboard-lesson-count');
  const overviewDeadlineCountEl = document.getElementById('dashboard-deadline-count');
  const overviewReminderCountEl = document.getElementById('dashboard-reminder-count');
  const nextLessonEl = document.getElementById('dashboard-next-lesson');
  const lessonStatusEl = document.getElementById('dashboard-lesson-status');
  const lessonsEmptyEl = document.getElementById('dashboard-lessons-empty');
  const lessonFeedbackEl = document.getElementById('lesson-feedback');
  const deadlinesEmptyEl = document.getElementById('dashboard-deadlines-empty');
  const deadlineFeedbackEl = document.getElementById('deadline-feedback');
  const remindersEmptyEl = document.getElementById('dashboard-reminders-empty');
  const weatherSummaryEl = document.getElementById('weather-summary');
  const weatherIconEl = document.getElementById('weather-icon');
  const weatherTempEl = document.getElementById('weather-temperature');
  const weatherDescEl = document.getElementById('weather-description');
  const weatherLocationEl = document.getElementById('weather-location');
  const weatherWindEl = document.getElementById('weather-wind');
  const weatherRainEl = document.getElementById('weather-rain');
  const weatherSunsetEl = document.getElementById('weather-sunset');
  const weatherFootnoteEl = document.getElementById('weather-footnote');
  const weatherRefreshBtn = document.getElementById('weather-refresh');

  const lessonForm = document.getElementById('lesson-form');
  const lessonSubjectInput = document.getElementById('lesson-subject');
  const lessonStartInput = document.getElementById('lesson-start');
  const lessonEndInput = document.getElementById('lesson-end');
  const lessonLocationInput = document.getElementById('lesson-location');

  const deadlineForm = document.getElementById('deadline-form');
  const deadlineTitleInput = document.getElementById('deadline-title');
  const deadlineDueInput = document.getElementById('deadline-due');
  const deadlineCourseInput = document.getElementById('deadline-course');

  const counts = { lessons: 0, deadlines: 0, reminders: 0 };
  let lessonFeedbackTimer = null;
  let deadlineFeedbackTimer = null;
  let isFetchingWeather = false;

  function randomId(prefix = 'id'){
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function safeRead(key){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function safeWrite(key, value){
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage write failures (private browsing, etc.)
    }
  }

  function createLesson(start, end, subject, location, focus = ''){
    return { id: randomId('lesson'), start, end, subject, location: location || '', focus };
  }

  function createDeadline(baseDate, offsetDays, hour, minute, title, course, notes = ''){
    const due = new Date(baseDate);
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + offsetDays);
    due.setHours(hour, minute, 0, 0);
    return {
      id: randomId('deadline'),
      title,
      due: due.toISOString(),
      course: course || '',
      notes,
      done: false,
    };
  }

  function seedLessons(){
    const today = new Date();
    const key = toDateKey(today);
    return {
      [key]: [
        createLesson('08:45', '09:30', 'Year 8 Science', 'Lab 2', 'Energy transfer experiment'),
        createLesson('10:15', '11:00', 'Year 10 English', 'Room 14', 'Draft persuasive speech feedback'),
        createLesson('11:45', '12:30', 'Year 7 Pastoral Care', 'Outdoor court', 'Team-building circuits'),
        createLesson('14:15', '15:00', 'Faculty collaboration', 'Library hub', 'Moderate assessment rubrics'),
      ],
    };
  }

  function seedDeadlines(){
    const now = new Date();
    return [
      createDeadline(now, 1, 15, 30, 'Year 9 research outlines', '9A Humanities', 'Collect drafts and provide quick feedback.'),
      createDeadline(now, 3, 9, 0, 'Staff PD reflection summary', 'Faculty', 'Submit summary to head of department.'),
      createDeadline(now, 6, 12, 0, 'Newsletter highlights due', 'Whole school', 'Share classroom wins and reminders.'),
    ];
  }

  function loadLessons(){
    const stored = safeRead(LESSON_STORAGE_KEY);
    if (stored && typeof stored === 'object' && stored.byDate) {
      return stored;
    }
    const seeded = { version: 1, byDate: seedLessons() };
    safeWrite(LESSON_STORAGE_KEY, seeded);
    return seeded;
  }

  function loadDeadlines(){
    const stored = safeRead(DEADLINE_STORAGE_KEY);
    if (stored && Array.isArray(stored.items)) {
      return stored;
    }
    const seeded = { version: 1, items: seedDeadlines() };
    safeWrite(DEADLINE_STORAGE_KEY, seeded);
    return seeded;
  }

  let lessonsState = loadLessons();
  let deadlinesState = loadDeadlines();
  let remindersState = [];

  function saveLessons(){
    safeWrite(LESSON_STORAGE_KEY, lessonsState);
  }

  function saveDeadlines(){
    safeWrite(DEADLINE_STORAGE_KEY, deadlinesState);
  }

  function setFeedbackMessage(el, text, variant = 'info'){
    if (!el) return;
    const colorClasses = ['text-emerald-600', 'text-rose-600', 'text-slate-500'];
    colorClasses.forEach(cls => el.classList.remove(cls));
    if (!text){
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    const variantClass = variant === 'success'
      ? 'text-emerald-600'
      : variant === 'error'
        ? 'text-rose-600'
        : 'text-slate-500';
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.add(variantClass);
  }

  function showLessonFeedback(message, variant){
    if (!lessonFeedbackEl) return;
    if (lessonFeedbackTimer) clearTimeout(lessonFeedbackTimer);
    setFeedbackMessage(lessonFeedbackEl, message, variant);
    if (message){
      lessonFeedbackTimer = setTimeout(() => {
        setFeedbackMessage(lessonFeedbackEl, '');
      }, 4000);
    }
  }

  function showDeadlineFeedback(message, variant){
    if (!deadlineFeedbackEl) return;
    if (deadlineFeedbackTimer) clearTimeout(deadlineFeedbackTimer);
    setFeedbackMessage(deadlineFeedbackEl, message, variant);
    if (message){
      deadlineFeedbackTimer = setTimeout(() => {
        setFeedbackMessage(deadlineFeedbackEl, '');
      }, 4000);
    }
  }

  function applyOverviewCounts(){
    if (overviewLessonCountEl) overviewLessonCountEl.textContent = String(counts.lessons);
    if (overviewDeadlineCountEl) overviewDeadlineCountEl.textContent = String(counts.deadlines);
    if (overviewReminderCountEl) overviewReminderCountEl.textContent = String(counts.reminders);
  }

  function parseTimeToDate(baseDate, timeString){
    if (!timeString) return null;
    const [hourPart, minutePart] = timeString.split(':');
    const hour = Number.parseInt(hourPart, 10);
    const minute = Number.parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const dt = new Date(baseDate);
    dt.setHours(hour, minute, 0, 0);
    return dt;
  }

  function minutesFromTimeString(timeString){
    if (!timeString) return Number.POSITIVE_INFINITY;
    const [hourPart, minutePart] = timeString.split(':');
    const hour = Number.parseInt(hourPart, 10);
    const minute = Number.parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return Number.POSITIVE_INFINITY;
    return hour * 60 + minute;
  }

  function formatDuration(ms){
    const abs = Math.abs(ms);
    const totalMinutes = Math.round(abs / 60000);
    if (totalMinutes < 1) return 'moments';
    if (totalMinutes < 60) return `${totalMinutes} min${totalMinutes === 1 ? '' : 's'}`;
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    if (totalHours >= 24){
      const days = Math.floor(totalHours / 24);
      const remainingHours = totalHours % 24;
      const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
      if (days >= 7 || remainingHours === 0) return dayLabel;
      return `${dayLabel} ${remainingHours} hr${remainingHours === 1 ? '' : 's'}`;
    }
    const hourLabel = `${totalHours} hr${totalHours === 1 ? '' : 's'}`;
    if (!remainingMinutes) return hourLabel;
    return `${hourLabel} ${remainingMinutes} min`;
  }

  function buildLessonTimeLabel(dayDate, start, end){
    const startDate = parseTimeToDate(dayDate, start);
    const endDate = parseTimeToDate(dayDate, end);
    if (startDate && endDate){
      return `${longTimeFormatter.format(startDate)} – ${longTimeFormatter.format(endDate)}`;
    }
    if (startDate){
      return longTimeFormatter.format(startDate);
    }
    return '';
  }

  function badgeClassForTone(tone){
    switch (tone){
      case 'active':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200';
      case 'soon':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200';
      case 'future':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      case 'past':
        return 'bg-slate-100 text-slate-500 dark:bg-slate-800/70 dark:text-slate-300';
      default:
        return 'bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300';
    }
  }

  function formatLessonStatus(start, end, now){
    if (!start){
      return { label: 'Time to confirm', tone: 'neutral' };
    }
    if (now < start){
      const diff = start - now;
      return {
        label: `Starts in ${formatDuration(diff)}`,
        tone: diff <= 60 * 60 * 1000 ? 'soon' : 'future',
      };
    }
    if (end && now <= end){
      return { label: `In progress · ends ${longTimeFormatter.format(end)}`, tone: 'active' };
    }
    if (end){
      return { label: `Finished ${formatDuration(now - end)} ago`, tone: 'past' };
    }
    return { label: 'Completed', tone: 'past' };
  }

  function iconForActivity(type){
    return activityIconMap[type] || activityIconMap.general;
  }

  function viewLabel(view){
    if (!view) return '';
    if (activityViewLabels[view]) return activityViewLabels[view];
    if (typeof view === 'string' && view.length){
      return view.charAt(0).toUpperCase() + view.slice(1);
    }
    return '';
  }

  function normaliseActivityTarget(target){
    if (!target) return { view: DEFAULT_VIEW, anchor: null, selector: null };
    if (typeof target === 'string'){
      const trimmed = target.trim();
      if (!trimmed) return { view: DEFAULT_VIEW, anchor: null, selector: null };
      if (trimmed.startsWith('#')){
        return { view: DEFAULT_VIEW, anchor: trimmed, selector: trimmed };
      }
      if (trimmed.includes('#')){
        const [viewPart, anchorPart] = trimmed.split('#');
        const viewName = viewMap.has(viewPart) ? viewPart : DEFAULT_VIEW;
        const anchor = anchorPart ? `#${anchorPart}` : null;
        return { view: viewName, anchor, selector: anchor };
      }
      if (viewMap.has(trimmed)){
        return { view: trimmed, anchor: null, selector: null };
      }
      const selector = trimmed.startsWith('.') || trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      const anchor = selector.startsWith('#') ? selector : null;
      return { view: DEFAULT_VIEW, anchor, selector };
    }
    if (typeof target === 'object'){
      let viewName = null;
      if (typeof target.view === 'string' && viewMap.has(target.view)){
        viewName = target.view;
      } else if (typeof target.route === 'string' && viewMap.has(target.route)){
        viewName = target.route;
      } else if (typeof target.name === 'string' && viewMap.has(target.name)){
        viewName = target.name;
      } else if (typeof target.hash === 'string'){
        const candidate = target.hash.replace(/^#/, '');
        if (viewMap.has(candidate)) viewName = candidate;
      } else if (typeof target.href === 'string'){
        const candidate = target.href.replace(/^#/, '');
        if (viewMap.has(candidate)) viewName = candidate;
      }
      const finalView = viewName || DEFAULT_VIEW;
      const anchor = typeof target.anchor === 'string' ? target.anchor : (typeof target.hash === 'string' ? target.hash : null);
      const selector = typeof target.selector === 'string' ? target.selector : anchor;
      return { view: finalView, anchor: anchor || null, selector: selector || null };
    }
    return { view: DEFAULT_VIEW, anchor: null, selector: null };
  }

  function relativeActivityLabel(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now - date;
    if (Number.isNaN(diff)) return '';
    if (diff < 0) return 'Upcoming';
    if (diff < 45 * 1000) return 'Just now';
    return `${formatDuration(diff)} ago`;
  }

  function updateActivityEmptyState(){
    if (!hasActivityFeed) return;
    const hasItems = activityState.items.length > 0;
    if (activityListEl){
      activityListEl.classList.toggle('hidden', !hasItems);
    }
    if (activityEmptyEl){
      if (activityState.ready && !hasItems){
        activityEmptyEl.classList.remove('hidden');
      } else {
        activityEmptyEl.classList.add('hidden');
      }
    }
  }

  function ensureActivityReady(){
    if (!hasActivityFeed || activityState.ready) return;
    activityState.ready = true;
    if (activityLoadingEl) activityLoadingEl.classList.add('hidden');
    if (activityListEl) activityListEl.setAttribute('aria-busy', 'false');
    updateActivityEmptyState();
  }

  function updateActivityRelativeTimes(){
    if (!activityListEl) return;
    const nodes = activityListEl.querySelectorAll('[data-activity-relative-timestamp]');
    nodes.forEach((node) => {
      const iso = node.getAttribute('data-activity-relative-timestamp');
      if (!iso) return;
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) return;
      node.textContent = relativeActivityLabel(dt);
    });
  }

  function navigateToTarget(target){
    const normalized = normaliseActivityTarget(target);
    const viewName = normalized.view && viewMap.has(normalized.view) ? normalized.view : DEFAULT_VIEW;
    const selector = normalized.selector || normalized.anchor;
    const applyAnchor = () => {
      if (!selector) return;
      requestAnimationFrame(() => {
        const el = document.querySelector(selector);
        if (el && typeof el.scrollIntoView === 'function'){
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    };
    if (location.hash === `#${viewName}`){
      show(viewName);
      applyAnchor();
      return;
    }
    const onHashChange = () => {
      window.removeEventListener('hashchange', onHashChange);
      applyAnchor();
    };
    window.addEventListener('hashchange', onHashChange, { once: true });
    location.hash = `#${viewName}`;
  }

  function renderActivityList(){
    if (!activityListEl) return;
    const fragment = document.createDocumentFragment();
    activityState.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'list-none';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'flex w-full items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 px-4 py-3 text-left transition hover:border-blue-300 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
      button.dataset.activityId = item.id;
      button.addEventListener('click', () => navigateToTarget(item.target));

      const iconEl = document.createElement('span');
      iconEl.className = 'text-xl leading-none';
      iconEl.textContent = item.icon;

      const content = document.createElement('div');
      content.className = 'flex-1 space-y-1';

      const labelEl = document.createElement('p');
      labelEl.className = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
      labelEl.textContent = item.label;
      content.appendChild(labelEl);

      if (item.target && item.target.view){
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300';
        badge.textContent = viewLabel(item.target.view);
        content.appendChild(badge);
      }

      const meta = document.createElement('p');
      meta.className = 'text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1';

      const relativeEl = document.createElement('span');
      relativeEl.dataset.activityRelativeTimestamp = item.timestamp;
      relativeEl.textContent = relativeActivityLabel(item.date);
      meta.appendChild(relativeEl);

      const timeEl = document.createElement('time');
      timeEl.dateTime = item.timestamp;
      timeEl.textContent = activityTimestampFormatter.format(item.date);

      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '•';
      meta.append(dot, timeEl);

      content.appendChild(meta);

      button.append(iconEl, content);
      li.appendChild(button);
      fragment.appendChild(li);
    });
    activityListEl.replaceChildren(fragment);
    updateActivityEmptyState();
    updateActivityRelativeTimes();
  }

  function addActivityEntry(detail){
    if (!hasActivityFeed) return;
    const payload = normalizeActivityPayload(detail);
    if (!payload) return;
    ensureActivityReady();
    const entryDate = new Date(payload.timestamp);
    const entry = {
      id: payload.id,
      label: payload.label,
      type: payload.type || 'general',
      action: payload.action || 'update',
      timestamp: payload.timestamp,
      date: entryDate,
      icon: payload.icon || iconForActivity(payload.type),
      target: normaliseActivityTarget(payload.target),
    };
    const existingIndex = activityState.items.findIndex(item => item.id === entry.id);
    if (existingIndex !== -1){
      activityState.items.splice(existingIndex, 1);
    }
    activityState.items.unshift(entry);
    if (activityState.items.length > ACTIVITY_MAX_ITEMS){
      activityState.items.length = ACTIVITY_MAX_ITEMS;
    }
    renderActivityList();
  }

  if (hasActivityFeed){
    if (activityListEl) activityListEl.setAttribute('aria-busy', 'true');
    const pending = (typeof window !== 'undefined' && Array.isArray(window.memoryCueActivityQueue))
      ? window.memoryCueActivityQueue.slice(-ACTIVITY_MAX_ITEMS)
      : [];
    pending.forEach(addActivityEntry);
    if (!activityState.ready){
      setTimeout(() => { ensureActivityReady(); }, 1200);
    } else {
      ensureActivityReady();
    }
    document.addEventListener(ACTIVITY_EVENT_NAME, (event) => {
      addActivityEntry(event?.detail);
    });
  }

  function renderLessons(){
    if (!lessonListEl) return;
    const today = new Date();
    const todayKey = toDateKey(today);
    const lessonArray = Array.isArray(lessonsState.byDate?.[todayKey]) ? lessonsState.byDate[todayKey].slice() : [];
    lessonArray.sort((a, b) => minutesFromTimeString(a.start) - minutesFromTimeString(b.start));

    lessonListEl.replaceChildren();
    counts.lessons = lessonArray.length;
    applyOverviewCounts();

    if (lessonArray.length === 0){
      if (lessonsEmptyEl) lessonsEmptyEl.classList.remove('hidden');
      if (lessonStatusEl) lessonStatusEl.classList.add('hidden');
      if (nextLessonEl) nextLessonEl.textContent = '';
      return;
    }

    if (lessonsEmptyEl) lessonsEmptyEl.classList.add('hidden');

    const now = new Date();
    const fragment = document.createDocumentFragment();
    let completed = 0;
    let activeLesson = null;
    let upcomingLesson = null;

    lessonArray.forEach((lesson) => {
      const start = parseTimeToDate(today, lesson.start);
      const end = parseTimeToDate(today, lesson.end);

      if (end && now > end) {
        completed += 1;
      }

      if (start && end && start <= now && now <= end){
        if (!activeLesson || (start < activeLesson.start)){
          activeLesson = { lesson, start, end };
        }
      } else if (start && start > now){
        if (!upcomingLesson || start < upcomingLesson.start){
          upcomingLesson = { lesson, start, end };
        }
      }

      const status = formatLessonStatus(start, end, now);
      const li = document.createElement('li');
      li.className = 'flex flex-col gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4 md:flex-row md:items-center md:justify-between';

      const details = document.createElement('div');
      details.className = 'space-y-1';
      const heading = document.createElement('p');
      heading.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      heading.textContent = lesson.subject || 'Lesson';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const timeLabel = buildLessonTimeLabel(today, lesson.start, lesson.end);
      const metaParts = [];
      if (timeLabel) metaParts.push(timeLabel);
      if (lesson.location) metaParts.push(lesson.location);
      meta.textContent = metaParts.join(' • ');
      details.append(heading, meta);
      if (lesson.focus){
        const focus = document.createElement('p');
        focus.className = 'text-sm text-slate-500 dark:text-slate-400';
        focus.textContent = lesson.focus;
        details.appendChild(focus);
      }

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-3 self-start md:self-auto';
      const statusBadge = document.createElement('span');
      statusBadge.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${badgeClassForTone(status.tone)}`;
      statusBadge.textContent = status.label;
      actions.appendChild(statusBadge);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'text-sm font-semibold text-rose-600 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        const current = lessonsState.byDate?.[todayKey];
        if (!Array.isArray(current)) return;
        lessonsState.byDate[todayKey] = current.filter(item => item.id !== lesson.id);
        saveLessons();
        const timeLabel = buildLessonTimeLabel(today, lesson.start, lesson.end);
        const removalParts = [lesson.subject || 'Lesson'];
        if (timeLabel) removalParts.push(timeLabel);
        if (lesson.location) removalParts.push(lesson.location);
        dispatchActivityEvent({
          type: 'lesson',
          action: 'deleted',
          label: `Lesson removed · ${removalParts.join(' • ')}`,
          target: { view: 'dashboard', anchor: '#lessons-heading' },
        });
        showLessonFeedback('Lesson removed from today.', 'success');
        renderLessons();
      });
      actions.appendChild(removeBtn);

      li.append(details, actions);
      fragment.appendChild(li);
    });

    lessonListEl.appendChild(fragment);

    if (lessonStatusEl){
      lessonStatusEl.classList.remove('hidden');
      const finished = Math.min(completed, lessonArray.length);
      lessonStatusEl.textContent = `${finished} of ${lessonArray.length} complete`;
    }

    if (nextLessonEl){
      if (activeLesson){
        const untilLabel = activeLesson.end ? longTimeFormatter.format(activeLesson.end) : longTimeFormatter.format(activeLesson.start);
        nextLessonEl.textContent = `Now: ${activeLesson.lesson.subject} until ${untilLabel}`;
      } else if (upcomingLesson){
        nextLessonEl.textContent = `Next: ${upcomingLesson.lesson.subject} at ${longTimeFormatter.format(upcomingLesson.start)}`;
      } else {
        nextLessonEl.textContent = 'All lessons are wrapped up for today.';
      }
    }
  }

  function renderDeadlines(){
    if (!deadlinesListEl) return;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + 7);
    windowEnd.setHours(23, 59, 59, 999);

    const all = Array.isArray(deadlinesState.items) ? deadlinesState.items : [];
    const upcoming = all.filter(item => !item.done && item.due).filter(item => {
      try {
        const dueDate = new Date(item.due);
        if (Number.isNaN(dueDate.getTime())) return false;
        return dueDate >= windowStart && dueDate <= windowEnd;
      } catch {
        return false;
      }
    });
    upcoming.sort((a, b) => new Date(a.due) - new Date(b.due));

    deadlinesListEl.replaceChildren();
    counts.deadlines = upcoming.length;
    applyOverviewCounts();

    if (!upcoming.length){
      if (deadlinesEmptyEl) deadlinesEmptyEl.classList.remove('hidden');
      return;
    }

    if (deadlinesEmptyEl) deadlinesEmptyEl.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    upcoming.forEach((deadline) => {
      const due = new Date(deadline.due);
      const diff = due - now;
      const overdue = diff < 0;
      const highlightClass = overdue
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
        : diff <= 24 * 60 * 60 * 1000
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      const statusLabel = overdue ? `Overdue by ${formatDuration(diff)}` : `Due in ${formatDuration(diff)}`;

      const li = document.createElement('li');
      li.className = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4';

      const top = document.createElement('div');
      top.className = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';

      const info = document.createElement('div');
      info.className = 'space-y-1';
      const title = document.createElement('p');
      title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      title.textContent = deadline.title || 'Deadline';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const dueLabel = overdue ? `Was due ${dateTimeFormatter.format(due)}` : `Due ${dateTimeFormatter.format(due)}`;
      const metaPieces = [dueLabel];
      if (deadline.course) metaPieces.push(deadline.course);
      meta.textContent = metaPieces.join(' • ');
      info.append(title, meta);
      if (deadline.notes){
        const note = document.createElement('p');
        note.className = 'text-sm text-slate-500 dark:text-slate-400';
        note.textContent = deadline.notes;
        info.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'flex flex-col items-start sm:items-end gap-3';
      const status = document.createElement('span');
      status.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${highlightClass}`;
      status.textContent = statusLabel;
      const completeBtn = document.createElement('button');
      completeBtn.type = 'button';
      completeBtn.className = 'text-sm font-semibold text-emerald-600 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500';
      completeBtn.textContent = 'Mark done';
      completeBtn.addEventListener('click', () => {
        const index = deadlinesState.items.findIndex(item => item.id === deadline.id);
        if (index === -1) return;
        deadlinesState.items[index].done = true;
        saveDeadlines();
        dispatchActivityEvent({
          type: 'deadline',
          action: 'completed',
          label: `Deadline completed · ${deadline.title || 'Deadline'}`,
          target: { view: 'dashboard', anchor: '#deadlines-heading' },
        });
        showDeadlineFeedback('Deadline marked as complete.', 'success');
        renderDeadlines();
      });
      actions.append(status, completeBtn);

      top.append(info, actions);
      li.appendChild(top);
      fragment.appendChild(li);
    });

    deadlinesListEl.appendChild(fragment);
  }

  function renderReminders(){
    if (!remindersListEl) return;
    remindersListEl.replaceChildren();
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const filtered = remindersState
      .filter(item => item && !item.done && item.due)
      .filter(item => {
        try {
          const dueDate = new Date(item.due);
          if (Number.isNaN(dueDate.getTime())) return false;
          return dueDate <= endOfDay;
        } catch {
          return false;
        }
      });

    filtered.sort((a, b) => new Date(a.due) - new Date(b.due));

    counts.reminders = filtered.length;
    applyOverviewCounts();

    if (!filtered.length){
      if (remindersEmptyEl) remindersEmptyEl.classList.remove('hidden');
      return;
    }

    if (remindersEmptyEl) remindersEmptyEl.classList.add('hidden');

    const fragment = document.createDocumentFragment();
    filtered.slice(0, 6).forEach((reminder) => {
      const due = new Date(reminder.due);
      const diff = due - now;
      const overdue = diff < 0;
      const soon = !overdue && diff <= 60 * 60 * 1000;
      const highlightClass = overdue
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200'
        : soon
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200';
      let statusLabel = '';
      if (overdue){
        statusLabel = `Overdue by ${formatDuration(diff)}`;
      } else if (soon){
        statusLabel = `Due in ${formatDuration(diff)}`;
      } else {
        statusLabel = `Due today · ${timeFormatter.format(due)}`;
      }

      const li = document.createElement('li');
      li.className = 'rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/40 p-4';

      const header = document.createElement('div');
      header.className = 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between';

      const content = document.createElement('div');
      content.className = 'space-y-1';
      const title = document.createElement('p');
      title.className = 'text-lg font-semibold text-slate-900 dark:text-slate-100';
      title.textContent = reminder.title || 'Reminder';
      const meta = document.createElement('p');
      meta.className = 'text-sm text-slate-500 dark:text-slate-400';
      const dueLabel = overdue
        ? `Was due ${dateTimeFormatter.format(due)}`
        : `Due ${timeFormatter.format(due)} (${dayLabelFormatter.format(due)})`;
      const metaParts = [dueLabel];
      if (reminder.priority) metaParts.push(`${reminder.priority} priority`);
      meta.textContent = metaParts.join(' • ');
      content.append(title, meta);
      if (reminder.notes){
        const [firstLine] = String(reminder.notes).split('\n');
        if (firstLine){
          const note = document.createElement('p');
          note.className = 'text-sm text-slate-500 dark:text-slate-400';
          note.textContent = firstLine;
          content.appendChild(note);
        }
      }

      const status = document.createElement('span');
      status.className = `inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${highlightClass}`;
      status.textContent = statusLabel;

      header.append(content, status);
      li.appendChild(header);
      fragment.appendChild(li);
    });

    remindersListEl.appendChild(fragment);
  }

  function handleLessonSubmit(event){
    event.preventDefault();
    if (!lessonSubjectInput || !lessonStartInput || !lessonEndInput) return;
    const subject = lessonSubjectInput.value.trim();
    const start = lessonStartInput.value;
    const end = lessonEndInput.value;
    if (!subject){
      showLessonFeedback('Add a lesson or group name first.', 'error');
      lessonSubjectInput.focus();
      return;
    }
    const startDate = parseTimeToDate(new Date(), start);
    const endDate = parseTimeToDate(new Date(), end);
    if (startDate && endDate && endDate <= startDate){
      showLessonFeedback('Finish time must be after the start time.', 'error');
      lessonEndInput.focus();
      return;
    }
    const todayKey = toDateKey(new Date());
    if (!Array.isArray(lessonsState.byDate?.[todayKey])){
      if (!lessonsState.byDate) lessonsState.byDate = {};
      lessonsState.byDate[todayKey] = [];
    }
    const locationValue = lessonLocationInput?.value.trim() || '';
    const newLesson = createLesson(start, end, subject, locationValue);
    lessonsState.byDate[todayKey].push(newLesson);
    saveLessons();
    const timeLabel = buildLessonTimeLabel(new Date(), start, end);
    const lessonParts = [subject];
    if (timeLabel) lessonParts.push(timeLabel);
    if (locationValue) lessonParts.push(locationValue);
    dispatchActivityEvent({
      type: 'lesson',
      action: 'created',
      label: `Lesson added · ${lessonParts.join(' • ')}`,
      target: { view: 'dashboard', anchor: '#lessons-heading' },
    });
    lessonForm?.reset();
    lessonSubjectInput.focus();
    showLessonFeedback('Lesson added to today.', 'success');
    renderLessons();
  }

  function handleDeadlineSubmit(event){
    event.preventDefault();
    if (!deadlineTitleInput || !deadlineDueInput) return;
    const title = deadlineTitleInput.value.trim();
    const dueValue = deadlineDueInput.value;
    if (!title){
      showDeadlineFeedback('Add a deadline title.', 'error');
      deadlineTitleInput.focus();
      return;
    }
    if (!dueValue){
      showDeadlineFeedback('Choose when this is due.', 'error');
      deadlineDueInput.focus();
      return;
    }
    const dueDate = new Date(dueValue);
    if (Number.isNaN(dueDate.getTime())){
      showDeadlineFeedback('Enter a valid due date and time.', 'error');
      deadlineDueInput.focus();
      return;
    }
    if (!Array.isArray(deadlinesState.items)){
      deadlinesState.items = [];
    }
    const courseValue = deadlineCourseInput?.value.trim() || '';
    const newDeadline = {
      id: randomId('deadline'),
      title,
      due: dueDate.toISOString(),
      course: courseValue,
      notes: '',
      done: false,
    };
    deadlinesState.items.push(newDeadline);
    saveDeadlines();
    dispatchActivityEvent({
      type: 'deadline',
      action: 'created',
      label: `Deadline added · ${title} (${dateTimeFormatter.format(dueDate)})`,
      target: { view: 'dashboard', anchor: '#deadlines-heading' },
    });
    deadlineForm?.reset();
    showDeadlineFeedback('Deadline saved for this week.', 'success');
    renderDeadlines();
  }

  function setWeatherStatus(text, variant = 'info'){
    if (!weatherStatusEl) return;
    weatherStatusEl.textContent = text;
    weatherStatusEl.classList.remove('text-rose-200', 'text-white/90', 'text-white/70', 'text-white/80');
    if (variant === 'error'){
      weatherStatusEl.classList.add('text-rose-200');
    } else if (variant === 'success'){
      weatherStatusEl.classList.add('text-white/90');
    } else {
      weatherStatusEl.classList.add('text-white/80');
    }
  }

  async function fetchWeather(lat, lon){
    const params = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      current_weather: 'true',
      daily: 'precipitation_probability_max,sunrise,sunset',
      timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok){
      throw new Error('Weather fetch failed');
    }
    return res.json();
  }

  async function resolveLocationLabel(lat, lon, fallbackLabel){
    try {
      const params = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), count: '1', language: 'en' });
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?${params.toString()}`);
      if (!res.ok) throw new Error('Reverse geocode failed');
      const data = await res.json();
      const result = data?.results?.[0];
      if (result){
        const pieces = [result.name, result.admin1, result.country_code].filter(Boolean);
        const unique = [];
        pieces.forEach((piece) => {
          if (!unique.includes(piece)) unique.push(piece);
        });
        return unique.join(', ');
      }
    } catch {
      // ignore, fallback below
    }
    return fallbackLabel || `Lat ${lat.toFixed(2)}, Lon ${lon.toFixed(2)}`;
  }

  function renderWeather(data, locationLabel, { fallback } = {}){
    if (!weatherSummaryEl) return;
    const current = data?.current_weather;
    if (!current) throw new Error('Weather data missing');
    weatherSummaryEl.classList.remove('hidden');
    const code = WEATHER_CODE_MAP[current.weathercode] || WEATHER_CODE_MAP.default;
    if (weatherIconEl) weatherIconEl.textContent = code.icon;
    if (weatherDescEl) weatherDescEl.textContent = code.label;
    if (weatherTempEl) weatherTempEl.textContent = `${Math.round(current.temperature)}°C`;
    if (weatherLocationEl) weatherLocationEl.textContent = locationLabel;
    if (weatherWindEl) weatherWindEl.textContent = `${Math.round(current.windspeed)} km/h`;
    if (weatherRainEl){
      const rain = data?.daily?.precipitation_probability_max?.[0];
      weatherRainEl.textContent = typeof rain === 'number' ? `${Math.round(rain)}%` : '—';
    }
    if (weatherSunsetEl){
      const sunsetIso = data?.daily?.sunset?.[0];
      weatherSunsetEl.textContent = sunsetIso ? longTimeFormatter.format(new Date(sunsetIso)) : '—';
    }
    if (weatherFootnoteEl){
      const updatedAt = current.time ? longTimeFormatter.format(new Date(current.time)) : longTimeFormatter.format(new Date());
      const notes = [`Updated ${updatedAt}`];
      if (fallback) notes.push('Default location');
      notes.push('Source: Open‑Meteo');
      weatherFootnoteEl.textContent = notes.join(' • ');
    }
  }

  async function loadWeatherFor(lat, lon, { fallback }){
    try {
      const data = await fetchWeather(lat, lon);
      const label = await resolveLocationLabel(lat, lon, fallback ? DEFAULT_WEATHER_LOCATION.label : '');
      renderWeather(data, label || DEFAULT_WEATHER_LOCATION.label, { fallback });
      setWeatherStatus(fallback ? 'Showing default location forecast.' : 'Forecast updated just now.', 'success');
    } catch (error) {
      console.error('Weather load failed', error);
      setWeatherStatus('Unable to load weather right now.', 'error');
    }
  }

  function requestWeather({ preferGeolocation = true, message } = {}){
    if (!weatherStatusEl) return;
    if (isFetchingWeather) return;
    isFetchingWeather = true;
    setWeatherStatus(message || 'Fetching latest forecast…', 'info');
    weatherSummaryEl?.classList.add('hidden');

    const finish = () => {
      isFetchingWeather = false;
    };

    if (preferGeolocation && navigator?.geolocation){
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          loadWeatherFor(pos.coords.latitude, pos.coords.longitude, { fallback: false }).finally(finish);
        },
        () => {
          loadWeatherFor(DEFAULT_WEATHER_LOCATION.latitude, DEFAULT_WEATHER_LOCATION.longitude, { fallback: true }).finally(finish);
        },
        { maximumAge: 15 * 60 * 1000, timeout: 8000 }
      );
      return;
    }

    loadWeatherFor(DEFAULT_WEATHER_LOCATION.latitude, DEFAULT_WEATHER_LOCATION.longitude, { fallback: true }).finally(finish);
  }

  if (lessonForm){
    lessonForm.addEventListener('submit', handleLessonSubmit);
  }

  if (deadlineForm){
    deadlineForm.addEventListener('submit', handleDeadlineSubmit);
  }

  if (weatherRefreshBtn){
    weatherRefreshBtn.addEventListener('click', () => {
      requestWeather({ preferGeolocation: true, message: 'Refreshing forecast…' });
    });
  }

  renderLessons();
  renderDeadlines();
  renderReminders();
  requestWeather({ preferGeolocation: true });

  setInterval(() => {
    renderLessons();
    renderDeadlines();
    renderReminders();
    updateActivityRelativeTimes();
  }, 60 * 1000);

  setInterval(() => {
    requestWeather({ preferGeolocation: false, message: 'Updating forecast…' });
  }, 30 * 60 * 1000);

  return {
    setReminders(items){
      remindersState = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
      renderReminders();
    },
  };
})();

if (dashboardController) {
  document.addEventListener('memoryCue:remindersUpdated', (event) => {
    const detail = event?.detail;
    const items = Array.isArray(detail?.items) ? detail.items : [];
    dashboardController.setReminders(items);
  });
}

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

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

// Notes
const noteEl = document.getElementById('quick-note');
const savedSelect = document.getElementById('saved-notes');
let activeNoteIndex = null;

function getNotes(){
  return JSON.parse(localStorage.getItem('saved-notes') || '[]');
}

function saveNotes(notes){
  localStorage.setItem('saved-notes', JSON.stringify(notes));
}

function refreshSelect(selectedValue = ''){
  if(!savedSelect) return;
  const notes = getNotes();
  savedSelect.innerHTML = '<option value="">Select a note</option>' +
    notes.map((n, i) => `<option value="${i}">${escapeHtml(n.title)}</option>`).join('');

  if(selectedValue !== ''){
    const parsed = Number.parseInt(selectedValue, 10);
    if(!Number.isNaN(parsed) && notes[parsed]){
      savedSelect.value = String(parsed);
      return;
    }
  }
  savedSelect.value = '';
}

if(noteEl){
  refreshSelect();

  document.getElementById('save-note')?.addEventListener('click', () => {
    const content = noteEl.innerHTML;
    const title = content.replace(/<[^>]+>/g, '').slice(0, 20) || 'Untitled';
    const notes = getNotes();
    notes.push({ title, content });
    saveNotes(notes);
    const newIndex = notes.length - 1;
    refreshSelect(String(newIndex));
    activeNoteIndex = newIndex;
  });

  document.getElementById('load-note')?.addEventListener('click', () => {
    const idx = savedSelect?.value;
    if(idx === '' || idx == null) return;
    const parsedIndex = Number.parseInt(idx, 10);
    if(Number.isNaN(parsedIndex)) return;
    const notes = getNotes();
    if(notes[parsedIndex]){
      noteEl.innerHTML = notes[parsedIndex].content;
      activeNoteIndex = parsedIndex;
    }
  });

  document.getElementById('delete-note')?.addEventListener('click', () => {
    const idx = savedSelect?.value;
    if(idx === '' || idx == null) return;
    const indexNum = Number.parseInt(idx, 10);
    if(Number.isNaN(indexNum)) return;
    const notes = getNotes();
    if(!notes[indexNum]) return;
    notes.splice(indexNum, 1);
    saveNotes(notes);
    refreshSelect();
    if(activeNoteIndex === indexNum){
      noteEl.innerHTML = '';
      activeNoteIndex = null;
    } else if(activeNoteIndex !== null && activeNoteIndex > indexNum){
      activeNoteIndex -= 1;
    }
  });

  document.getElementById('clear-note')?.addEventListener('click', () => {
    noteEl.innerHTML = '';
    activeNoteIndex = null;
  });

  document.getElementById('bullet-btn')?.addEventListener('click', () => {
    document.execCommand('insertUnorderedList');
  });

  document.getElementById('number-btn')?.addEventListener('click', () => {
    document.execCommand('insertOrderedList');
  });
}