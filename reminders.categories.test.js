/** @jest-environment jsdom */

const { beforeAll, beforeEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./js/__tests__/helpers/load-reminder-controller');

let initReminders;

function createFirebaseStubs() {
  return {
    initializeApp: () => ({}),
    initializeFirestore: () => ({}),
    getFirestore: () => ({}),
    enableMultiTabIndexedDbPersistence: () => Promise.resolve(),
    enableIndexedDbPersistence: () => Promise.resolve(),
    doc: () => ({}),
    setDoc: () => Promise.resolve(),
    deleteDoc: () => Promise.resolve(),
    onSnapshot: () => () => {},
    collection: () => ({}),
    query: () => ({}),
    orderBy: () => ({}),
    persistentLocalCache: () => ({}),
    serverTimestamp: () => ({}),
    getAuth: () => ({}),
    onAuthStateChanged: (_auth, callback) => { callback(null); },
    GoogleAuthProvider: function GoogleAuthProviderStub() {},
    signInWithPopup: () => Promise.resolve(),
    signInWithRedirect: () => Promise.resolve(),
    getRedirectResult: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  };
}

beforeAll(() => {
  ({ initReminders } = loadReminderController());
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

test('desktop reminders keep rendered row category metadata', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option>High</option></select>
    <input id="category" list="categorySuggestions" />
    <datalist id="categorySuggestions"></datalist>
    <button id="saveBtn" type="button"></button>
    <button id="cancelEditBtn" type="button"></button>
    <div id="remindersWrapper"><p id="emptyState"></p><ul id="reminderList"></ul></div>
    <div id="status"></div>
    <div id="syncStatus"></div>
    <select id="categoryFilter"><option value="all" selected>All</option></select>
  `;

  const controller = await initReminders({
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
    emptyStateSel: '#emptyState',
    listWrapperSel: '#remindersWrapper',
    categoryOptionsSel: '#categorySuggestions',
    variant: 'desktop',
    firebaseDeps: createFirebaseStubs(),
  });

  const now = Date.now();
  controller.__testing.setItems([
    { id: 'a', title: 'Send excursion forms', priority: 'High', category: 'Admin', done: false, due: new Date(now + 3600e3).toISOString() },
    { id: 'b', title: 'Call families', priority: 'Medium', category: 'Communication', done: false, due: new Date(now + 7200e3).toISOString() },
    { id: 'c', title: 'Print rubrics', priority: 'Low', category: 'Admin', done: false, due: new Date(now + 10800e3).toISOString() },
  ]);
  controller.__testing.render();

  const rows = Array.from(document.querySelectorAll('[data-reminder-item="true"]'));
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.dataset.category)).toEqual(['Admin', 'Communication', 'Admin']);
});

test('mobile reminders normalise uncategorised rows to General', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option>High</option></select>
    <input id="category" list="categorySuggestions" />
    <datalist id="categorySuggestions"></datalist>
    <button id="saveBtn" type="button"></button>
    <button id="cancelEditBtn" type="button"></button>
    <div id="wrapper"><div id="list"></div></div>
    <div id="reminderCategoryFilters"></div>
    <div id="status"></div>
    <div id="syncStatus"></div>
    <select id="categoryFilter"><option value="all" selected>All</option></select>
  `;

  const controller = await initReminders({
    titleSel: '#title',
    dateSel: '#date',
    timeSel: '#time',
    detailsSel: '#details',
    prioritySel: '#priority',
    categorySel: '#category',
    saveBtnSel: '#saveBtn',
    cancelEditBtnSel: '#cancelEditBtn',
    listSel: '#list',
    statusSel: '#status',
    syncStatusSel: '#syncStatus',
    listWrapperSel: '#wrapper',
    categoryOptionsSel: '#categorySuggestions',
    variant: 'mobile',
    firebaseDeps: createFirebaseStubs(),
  });

  const now = Date.now();
  controller.__testing.setItems([
    { id: 'a', title: 'Pack equipment', priority: 'High', done: false, category: '', due: new Date(now + 3600e3).toISOString() },
    { id: 'b', title: 'Book bus', priority: 'Medium', category: 'Excursion', done: false, due: new Date(now + 5400e3).toISOString() },
  ]);
  controller.__testing.render();

  const generalItems = document.querySelectorAll('[data-category="General"]');
  expect(generalItems).toHaveLength(1);

  const excursionItems = document.querySelectorAll('[data-category="Excursion"]');
  expect(excursionItems).toHaveLength(1);
});

test('mobile reminders render one due-time stream with completed reminders collapsed', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option>High</option><option selected>Medium</option></select>
    <input id="category" list="categorySuggestions" />
    <datalist id="categorySuggestions"></datalist>
    <button id="saveBtn" type="button"></button>
    <button id="cancelEditBtn" type="button"></button>
    <div id="wrapper"><ul id="list"></ul></div>
    <div id="status"></div>
    <div id="syncStatus"></div>
  `;

  const controller = await initReminders({
    titleSel: '#title',
    dateSel: '#date',
    timeSel: '#time',
    detailsSel: '#details',
    prioritySel: '#priority',
    categorySel: '#category',
    saveBtnSel: '#saveBtn',
    cancelEditBtnSel: '#cancelEditBtn',
    listSel: '#list',
    statusSel: '#status',
    syncStatusSel: '#syncStatus',
    listWrapperSel: '#wrapper',
    categoryOptionsSel: '#categorySuggestions',
    variant: 'mobile',
    firebaseDeps: createFirebaseStubs(),
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dueAt = (dayOffset, hour) => {
    const value = new Date(todayStart);
    value.setDate(value.getDate() + dayOffset);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };

  controller.__testing.setItems([
    { id: 'upcoming-late', title: 'Reports', priority: 'Medium', category: 'School', done: false, due: dueAt(2, 15) },
    { id: 'no-date', title: 'Bowies Adoption', priority: 'Medium', category: 'Home & Personal', done: false, due: null },
    { id: 'today-due', title: 'Paneer', priority: 'High', category: 'General', done: false, due: dueAt(0, 18) },
    { id: 'overdue', title: 'Passports', priority: 'Medium', category: 'School', done: false, due: dueAt(-1, 9) },
    { id: 'today-pinned', title: 'Netball', priority: 'Medium', category: 'Wellbeing & Support', done: false, due: null, pinToToday: true },
    { id: 'upcoming-early', title: 'Saag for Tea', priority: 'Medium', category: 'General', done: false, due: dueAt(1, 8) },
    { id: 'completed', title: 'Finished task', priority: 'Low', category: 'General', done: true, due: dueAt(0, 10) },
  ]);
  controller.__testing.render();

  const groupOrder = Array.from(document.querySelectorAll('.reminder-stream-section'))
    .map((section) => section.dataset.timeGroup);
  expect(groupOrder).toEqual(['overdue', 'today', 'upcoming', 'no-date']);
  expect(document.querySelector('.reminder-group-card')).toBeNull();

  const todayIds = Array.from(document.querySelectorAll('[data-time-group="today"] [data-reminder-item="true"]'))
    .map((row) => row.dataset.id);
  expect(todayIds).toEqual(['today-due', 'today-pinned']);

  const upcomingIds = Array.from(document.querySelectorAll('[data-time-group="upcoming"] [data-reminder-item="true"]'))
    .map((row) => row.dataset.id);
  expect(upcomingIds).toEqual(['upcoming-early', 'upcoming-late']);

  expect(document.querySelector('[data-id="completed"]')).toBeNull();
  expect(document.querySelectorAll('.reminder-stream-more')).toHaveLength(6);
  expect(document.querySelector('[aria-label^="Delete reminder"]')).toBeNull();
  expect(document.querySelector('[data-id="upcoming-late"] .reminder-stream-category').textContent).toBe('School');

  document.querySelector('.reminder-completed-section-toggle').click();
  expect(document.querySelector('[data-id="completed"]')).not.toBeNull();
});

test('category selectors include school and general presets', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option selected>Medium</option></select>
    <input id="category" list="categorySuggestions" />
    <datalist id="categorySuggestions"></datalist>
    <button id="saveBtn" type="button"></button>
    <button id="cancelEditBtn" type="button"></button>
    <div id="status"></div>
    <div id="syncStatus"></div>
    <select id="categoryFilter"><option value="all" selected>All</option></select>
  `;

  await initReminders({
    titleSel: '#title',
    dateSel: '#date',
    timeSel: '#time',
    detailsSel: '#details',
    prioritySel: '#priority',
    categorySel: '#category',
    saveBtnSel: '#saveBtn',
    cancelEditBtnSel: '#cancelEditBtn',
    statusSel: '#status',
    syncStatusSel: '#syncStatus',
    categoryOptionsSel: '#categorySuggestions',
    firebaseDeps: createFirebaseStubs(),
  });

  const datalistValues = Array.from(document.querySelectorAll('#categorySuggestions option')).map((opt) => opt.value);
  expect(datalistValues).toEqual([
    'General',
    'General Appointments',
    'Home & Personal',
    'School',
    'School – Appointments/Meetings',
    'School – Communication & Families',
    'School – Excursions & Events',
    'School – Grading & Assessment',
    'School – Prep & Resources',
    'School – To-Do',
    'Wellbeing & Support',
  ]);

});

test('visible category choices update the reminder category input', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option selected>Medium</option></select>
    <button type="button" data-category-choice="General" aria-pressed="true">General</button>
    <button type="button" data-category-choice="School" aria-pressed="false">School</button>
    <input id="category" list="categorySuggestions" value="General" />
    <datalist id="categorySuggestions"></datalist>
    <button id="saveBtn" type="button"></button>
    <button id="cancelEditBtn" type="button"></button>
    <div id="status"></div>
    <div id="syncStatus"></div>
  `;

  await initReminders({
    titleSel: '#title',
    dateSel: '#date',
    timeSel: '#time',
    detailsSel: '#details',
    prioritySel: '#priority',
    categorySel: '#category',
    saveBtnSel: '#saveBtn',
    cancelEditBtnSel: '#cancelEditBtn',
    statusSel: '#status',
    syncStatusSel: '#syncStatus',
    categoryOptionsSel: '#categorySuggestions',
    firebaseDeps: createFirebaseStubs(),
  });

  const generalChoice = document.querySelector('[data-category-choice="General"]');
  const schoolChoice = document.querySelector('[data-category-choice="School"]');
  schoolChoice.click();

  expect(document.getElementById('category').value).toBe('School');
  expect(schoolChoice.getAttribute('aria-pressed')).toBe('true');
  expect(generalChoice.getAttribute('aria-pressed')).toBe('false');
});
