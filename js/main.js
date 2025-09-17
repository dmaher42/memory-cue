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