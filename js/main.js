// js/main.js

// Mobile menu functionality
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

function toggleMobileMenu() {
  if (!mobileMenu) return;
  const isOpen = mobileMenu.classList.toggle('open');
  mobileMenu.hidden = !isOpen;
  if (mobileMenuBtn) {
    mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
  }
}

function closeMobileMenu() {
  if (!mobileMenu) return;
  mobileMenu.classList.remove('open');
  mobileMenu.hidden = true;
  mobileMenuBtn?.setAttribute('aria-expanded', 'false');
}

mobileMenuBtn?.addEventListener('click', toggleMobileMenu);
if (mobileMenu) {
  closeMobileMenu();
}

// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
  if (!mobileMenuBtn?.contains(e.target) && !mobileMenu?.contains(e.target)) {
    closeMobileMenu();
  }
});

// Routing
const views = [...document.querySelectorAll('[data-view]')];
function show(view){
  views.forEach(v => v.hidden = v.dataset.view !== view);
  history.replaceState(null, '', `#${view}`);
  
  // Update active navigation states
  function updateNavButtons(buttons, isActiveNav){
    buttons.forEach(btn => {
      const isActive = isActiveNav && btn.dataset.route === view;
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

  const isMobileNav = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 768px)').matches
    : false;

  updateNavButtons(document.querySelectorAll('.nav-desktop [data-route]'), !isMobileNav);
  updateNavButtons(document.querySelectorAll('#mobile-menu [data-route]'), isMobileNav);
  
  // Close mobile menu after navigation
  closeMobileMenu();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn) return;
  e.preventDefault();
  show(btn.dataset.route);
});

document.getElementById('get-started-btn')?.addEventListener('click', () => {
  show('reminders');
});

window.addEventListener('hashchange', () => {
  const v = (location.hash || '#dashboard').slice(1);
  if (views.some(x => x.dataset.view === v)) show(v);
});

show((location.hash || '#dashboard').slice(1));

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
function onAddReminder(e){
  e.preventDefault();
  const input = e.target.elements['reminder'];
  const text = input.value.trim();
  if(!text) return;
  const li = document.createElement('li');
  li.textContent = text;
  document.getElementById('reminders-list').appendChild(li);
  input.value = '';
}
document.getElementById('add-reminder-form')?.addEventListener('submit', onAddReminder);

// Planner
let week = 0;
function renderWeek(){
  const el = document.getElementById('planner-week');
  if(el) el.textContent = `Week offset: ${week}`;
}
function moveWeek(delta){
  week = delta === 0 ? 0 : week + delta;
  renderWeek();
}
document.getElementById('planner-prev')?.addEventListener('click', () => moveWeek(-1));
document.getElementById('planner-today')?.addEventListener('click', () => moveWeek(0));
document.getElementById('planner-next')?.addEventListener('click', () => moveWeek(1));
renderWeek();

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