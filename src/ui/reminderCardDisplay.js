// Device display preferences only; reminder records and sync remain unchanged.
const KEY = 'memoryCue:reminderCardDisplay';
let preferences;
function read() {
  try { const value = JSON.parse(localStorage.getItem(KEY) || '{}'); return { enabled: value.enabled === true, heights: value.heights && typeof value.heights === 'object' ? value.heights : {} }; }
  catch { return { enabled: false, heights: {} }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* Still usable for this visit. */ } }
function height(value) { return Math.max(96, Math.min(480, Number(value) || 120)); }
function apply(card) {
  card.classList.toggle('reminder-resizable', preferences.enabled);
  if (preferences.enabled) card.style.setProperty('--reminder-card-height', `${height(preferences.heights[card.dataset.id])}px`);
  else card.style.removeProperty('--reminder-card-height');
}
function refresh() {
  document.querySelectorAll('[data-reminder-item]').forEach(apply);
  const toggle = document.getElementById('reminderResizableCards');
  if (toggle) toggle.checked = preferences.enabled;
  const reset = document.getElementById('resetReminderCardSizes');
  if (reset) reset.disabled = !preferences.enabled;
}
export function initReminderCardDisplay() {
  preferences = read();
  const toggle = document.getElementById('reminderResizableCards');
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = 'true';
    toggle.addEventListener('change', () => { preferences.enabled = toggle.checked; save(); refresh(); });
    document.getElementById('resetReminderCardSizes')?.addEventListener('click', () => { preferences.heights = {}; save(); refresh(); });
    window.addEventListener('storage', (event) => { if (event.key === KEY || event.key === null) { preferences = read(); refresh(); } });
  }
  refresh();
}
export function attachReminderCardResize(card, reminder) {
  preferences ||= read();
  const main = card.querySelector('.reminder-row-main');
  if (reminder.notes && main) {
    const details = document.createElement('p');
    details.className = 'reminder-resize-details';
    details.textContent = reminder.notes;
    main.append(details);
  }
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'reminder-resize-handle';
  handle.dataset.reminderControl = 'resize';
  handle.dataset.noSwipe = 'true';
  handle.draggable = false;
  handle.setAttribute('aria-label', `Resize reminder: ${card.dataset.title}`);
  handle.title = 'Drag to resize; use Up and Down arrows';
  handle.textContent = '━';
  let gesture;
  function update(value) {
    const next = height(value);
    card.style.setProperty('--reminder-card-height', `${next}px`);
    return next;
  }
  handle.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    gesture = { id: event.pointerId, y: event.clientY, height: card.getBoundingClientRect().height, original: card.style.getPropertyValue('--reminder-card-height') };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.stopPropagation(); update(gesture.height + event.clientY - gesture.y);
  });
  handle.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    event.stopPropagation(); preferences.heights[card.dataset.id] = height(parseFloat(card.style.getPropertyValue('--reminder-card-height'))); save(); gesture = null;
  });
  const cancel = () => { if (gesture) card.style.setProperty('--reminder-card-height', gesture.original); gesture = null; };
  handle.addEventListener('pointercancel', cancel);
  handle.addEventListener('lostpointercapture', cancel);
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    preferences.heights[card.dataset.id] = update(event.key === 'Home' ? 120 : card.getBoundingClientRect().height + (event.key === 'ArrowDown' ? 24 : -24)); save();
  });
  card.append(handle); apply(card);
}
