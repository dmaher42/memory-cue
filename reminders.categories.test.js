/** @jest-environment jsdom */

const { beforeAll, beforeEach, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let initReminders;

function loadRemindersModule() {
  const filePath = path.resolve(__dirname, './js/reminders.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+async\s+function\s+initReminders/, 'async function initReminders');
  source += '\nmodule.exports = { initReminders };\n';
  const NotificationRef = typeof global.Notification === 'undefined' ? undefined : global.Notification;
  const BlobRef = typeof global.Blob === 'undefined' ? undefined : global.Blob;
  const ResponseRef = typeof global.Response === 'undefined' ? undefined : global.Response;
  const URLRef = typeof global.URL === 'undefined' ? undefined : global.URL;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    setTimeout,
    clearTimeout,
    window,
    document,
    localStorage,
    navigator,
    Notification: NotificationRef,
    fetch: global.fetch,
    Blob: BlobRef,
    Response: ResponseRef,
    URL: URLRef,
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

function createFirebaseStubs() {
  return {
    initializeApp: () => ({}),
    initializeFirestore: () => ({}),
    getFirestore: () => ({}),
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
  ({ initReminders } = loadRemindersModule());
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

test('desktop reminders render grouped category headings', async () => {
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
    categoryFilterSel: '#categoryFilter',
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

  const headings = Array.from(document.querySelectorAll('[data-category-heading]'));
  expect(headings.map((heading) => heading.dataset.categoryHeading)).toEqual(['Admin', 'Communication']);

  const adminItems = document.querySelectorAll('[data-category="Admin"]');
  expect(adminItems).toHaveLength(2);

  const communicationItems = document.querySelectorAll('[data-category="Communication"]');
  expect(communicationItems).toHaveLength(1);
});

test('mobile reminders group uncategorised items under General', async () => {
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
    categoryFilterSel: '#categoryFilter',
    categoryOptionsSel: '#categorySuggestions',
    variant: 'mobile',
    firebaseDeps: createFirebaseStubs(),
  });

  const now = Date.now();
  controller.__testing.setItems([
    { id: 'a', title: 'Pack equipment', priority: 'High', done: false, category: '', due: new Date(now + 3600e3).toISOString() },
    { id: 'b', title: 'Book bus', priority: 'Medium', category: 'Excursion', done: false, due: new Date(now + 5400e3).toISOString() },
  ]);

  const headings = Array.from(document.querySelectorAll('[data-category-heading]'));
  expect(headings.map((heading) => heading.dataset.categoryHeading)).toEqual(['Excursion', 'General']);

  const generalItems = document.querySelectorAll('[data-category="General"]');
  expect(generalItems).toHaveLength(1);

  const excursionItems = document.querySelectorAll('[data-category="Excursion"]');
  expect(excursionItems).toHaveLength(1);
});
