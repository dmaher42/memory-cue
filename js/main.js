// js/main.js

// Routing
const views = [...document.querySelectorAll('[data-view]')];
function show(view){
  views.forEach(v => v.hidden = v.dataset.view !== view);
  history.replaceState(null, '', `#${view}`);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-route]');
  if (!btn) return;
  e.preventDefault();
  show(btn.dataset.route);
});

window.addEventListener('hashchange', () => {
  const v = (location.hash || '#dashboard').slice(1);
  if (views.some(x => x.dataset.view === v)) show(v);
});

show((location.hash || '#dashboard').slice(1));

// Firebase auth
const auth = firebase.auth();
const signInBtn = document.getElementById('sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');

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

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
function setTheme(t){
  document.documentElement.classList.toggle('dark', t === 'dark');
  localStorage.setItem('theme', t);
}
function toggleTheme(){
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}
themeToggle?.addEventListener('click', toggleTheme);
const preferred = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
setTheme(preferred);

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
if(noteEl){
  noteEl.value = localStorage.getItem('quick-note') || '';
  document.getElementById('save-note')?.addEventListener('click', () => {
    localStorage.setItem('quick-note', noteEl.value);
  });
  document.getElementById('clear-note')?.addEventListener('click', () => {
    noteEl.value = '';
    localStorage.removeItem('quick-note');
  });
}
