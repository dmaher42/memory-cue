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
    'School – Appointments/Meetings',
    'School – Communication & Families',
    'School – Excursions & Events',
    'School – Grading & Assessment',
    'School – Prep & Resources',
    'School – To-Do',
    'Wellbeing & Support',
  ]);

});
