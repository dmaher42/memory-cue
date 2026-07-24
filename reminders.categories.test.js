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

test('mobile reminders render School and Footy as two board columns without hiding older categories', async () => {
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
    { id: 'school-first', title: 'Reports', priority: 'Medium', category: 'School', done: false, due: dueAt(2, 15), orderIndex: 5000 },
    { id: 'school-second', title: 'Passports', priority: 'Medium', category: 'School – Excursions & Events', done: false, due: dueAt(-1, 9), orderIndex: 4000 },
    { id: 'footy-first', title: 'Team selection', priority: 'High', category: 'Footy', done: false, due: dueAt(0, 18), orderIndex: 3000 },
    { id: 'footy-second', title: 'Training plan', priority: 'Medium', category: 'Footy – Drills', done: false, due: null, orderIndex: 2000 },
    { id: 'older-category', title: 'Bowies Adoption', priority: 'Medium', category: 'Home & Personal', done: false, due: null, orderIndex: 1000 },
    { id: 'completed', title: 'Finished task', priority: 'Low', category: 'School', done: true, due: dueAt(0, 10), orderIndex: 500 },
  ]);
  controller.__testing.render();

  const columnOrder = Array.from(document.querySelectorAll('.reminder-category-column'))
    .map((section) => section.dataset.reminderColumn);
  expect(columnOrder).toEqual(['school', 'footy']);

  const schoolIds = Array.from(document.querySelectorAll('[data-reminder-column="school"] [data-reminder-item="true"]'))
    .map((row) => row.dataset.id);
  expect(schoolIds).toEqual(['school-first', 'school-second']);

  const footyIds = Array.from(document.querySelectorAll('[data-reminder-column="footy"] [data-reminder-item="true"]'))
    .map((row) => row.dataset.id);
  expect(footyIds).toEqual(['footy-first', 'footy-second']);

  expect(document.querySelector('[data-reminder-column="school"] .reminder-category-column-title').textContent).toBe('School');
  expect(document.querySelector('[data-reminder-column="footy"] .reminder-category-column-title').textContent).toBe('Footy');
  expect(document.querySelector('[data-reminder-column="school"] .reminder-category-column-count').textContent).toBe('2');
  expect(document.querySelector('[data-reminder-column="footy"] .reminder-category-column-count').textContent).toBe('2');

  expect(document.querySelector('[data-reminder-column="other"] [data-id="older-category"]')).not.toBeNull();
  expect(document.querySelector('.reminder-other-cards-help').textContent).toMatch(/Move these to School or Footy/i);

  expect(document.querySelector('[data-id="completed"]')).toBeNull();
  expect(document.querySelectorAll('.reminder-stream-more')).toHaveLength(5);
  expect(document.querySelector('[aria-label^="Delete reminder"]')).toBeNull();
  expect(document.querySelector('[data-id="footy-second"] .reminder-stream-category').textContent).toBe('Footy – Drills');

  document.querySelector('.reminder-completed-section-toggle').click();
  expect(document.querySelector('[data-id="completed"]')).not.toBeNull();
});

test('mobile board column headings can be renamed and persist without changing reminder categories', async () => {
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

  controller.__testing.setItems([
    { id: 'school-card', title: 'School card', category: 'School', done: false, orderIndex: 3000 },
    { id: 'footy-card', title: 'Footy card', category: 'Footy', done: false, orderIndex: 2000 },
    { id: 'other-card', title: 'Other card', category: 'General', done: false, orderIndex: 1000 },
  ]);

  const renameButton = document.querySelector('[data-reminder-column="school"] [data-action="rename-column"]');
  expect(renameButton.getAttribute('aria-label')).toBe('Rename School column');
  renameButton.click();

  const renameInput = document.querySelector('[data-reminder-column="school"] .reminder-category-column-rename-input');
  expect(renameInput.value).toBe('School');
  renameInput.value = 'Work';
  document.querySelector('[data-reminder-column="school"] .reminder-category-column-rename-save').click();

  expect(document.querySelector('[data-reminder-column="school"] .reminder-category-column-title').textContent).toBe('Work');
  expect(document.querySelector('[data-reminder-column="school"] .reminder-category-add-card').getAttribute('aria-label')).toBe('Add a Work reminder card');
  expect(document.querySelector('.reminder-other-cards-help').textContent).toMatch(/Move these to Work or Footy/i);
  expect(JSON.parse(localStorage.getItem('memoryCue:reminderBoardLabels'))).toEqual({ school: 'Work' });
  expect(controller.__testing.getItems().find((item) => item.id === 'school-card').category).toBe('School');

  document.querySelector('[data-id="footy-card"] .reminder-stream-more').click();
  expect(document.querySelector('.reminder-card-actions-menu [data-action="move-to-school"]').textContent).toBe('Move to Work');

  controller.__testing.render();
  expect(document.querySelector('[data-reminder-column="school"] .reminder-category-column-title').textContent).toBe('Work');
});

test('mobile board controls add, edit, move, reorder, and delete canonical reminder cards', async () => {
  document.body.innerHTML = `
    <input id="title" />
    <input id="date" />
    <input id="time" />
    <textarea id="details"></textarea>
    <select id="priority"><option selected>Medium</option></select>
    <input id="category" list="categorySuggestions" value="General" />
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

  controller.__testing.setItems([
    { id: 'school-one', title: 'School one', category: 'School', done: false, orderIndex: 3000 },
    { id: 'school-two', title: 'School two', category: 'School', done: false, orderIndex: 2000 },
    { id: 'footy-one', title: 'Footy one', category: 'Footy', done: false, orderIndex: 1000 },
  ]);

  document.querySelector('[data-reminder-column="footy"] .reminder-category-add-card').click();
  expect(document.getElementById('category').value).toBe('Footy');

  let editOpened = false;
  document.addEventListener('cue:open', (event) => {
    if (event.detail?.mode === 'edit') editOpened = true;
  }, { once: true });
  document.querySelector('[data-id="school-one"] .reminder-stream-more').click();
  document.querySelector('.reminder-card-actions-menu [data-action="edit-card"]').click();
  expect(editOpened).toBe(true);

  document.querySelector('[data-id="school-one"] .reminder-stream-more').click();
  document.querySelector('.reminder-card-actions-menu [data-action="move-to-footy"]').click();
  expect(controller.__testing.getItems().find((item) => item.id === 'school-one').category).toBe('Footy');
  expect(document.querySelector('[data-reminder-column="footy"] [data-id="school-one"]')).not.toBeNull();

  document.querySelector('[data-id="footy-one"] .reminder-stream-more').click();
  document.querySelector('.reminder-card-actions-menu [data-action="move-card-up"]').click();
  const footyIds = Array.from(document.querySelectorAll('[data-reminder-column="footy"] [data-reminder-item="true"]'))
    .map((row) => row.dataset.id);
  expect(footyIds).toEqual(['footy-one', 'school-one']);

  document.querySelector('[data-id="footy-one"] .reminder-stream-more').click();
  document.querySelector('.reminder-card-actions-menu [data-action="delete-card"]').click();
  await Promise.resolve();
  expect(controller.__testing.getItems().some((item) => item.id === 'footy-one')).toBe(false);
  expect(document.querySelector('[data-id="footy-one"]')).toBeNull();
  controller.__testing.setItems([]);
  controller.__testing.persistItems();
});

test('legacy Today list items migrate once into canonical reminders before the old store is removed', async () => {
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
    <div id="wrapper"><ul id="list"></ul></div>
    <div id="status"></div>
    <div id="syncStatus"></div>
  `;

  const dateId = (offset) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  };
  const todayId = dateId(0);
  const tomorrowId = dateId(1);
  const legacyPayload = {
    [todayId]: [
      { id: 'school-form', text: 'Return school form', category: 'School', priority: 'high', completed: false, createdAt: 1000 },
      { id: 'finished', text: 'Finished errand', category: 'general', priority: 'low', completed: true, createdAt: 2000, completedAt: 3000 },
    ],
    [tomorrowId]: [
      { id: 'passport', text: 'Check passport', category: 'Travel', priority: 'medium', completed: false, createdAt: 4000 },
    ],
  };
  localStorage.setItem('dailyTasksByDate', JSON.stringify(legacyPayload));

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

  const migrated = controller.__testing.getItems()
    .filter((item) => item?.metadata?.migratedFrom === 'dailyTasksByDate');
  expect(migrated).toHaveLength(3);
  expect(migrated.map((item) => item.title).sort()).toEqual(['Check passport', 'Finished errand', 'Return school form']);
  expect(migrated.find((item) => item.title === 'Finished errand').done).toBe(true);
  expect(migrated.find((item) => item.title === 'Return school form').priority).toBe('High');
  expect(migrated.every((item) => item.metadata.isAllDay === true)).toBe(true);
  expect(migrated.every((item) => item.metadata.suppressNotification === true)).toBe(true);
  expect(localStorage.getItem('dailyTasksByDate')).toBeNull();

  expect(document.querySelector('[data-reminder-column="school"] [data-title="Return School Form"] .reminder-stream-due').textContent).toBe('Today');
  expect(document.querySelector('[data-reminder-column="other"] [data-title="Check Passport"] .reminder-stream-due').textContent).toBe('Tomorrow');
  expect(document.querySelector('.reminder-completed-section-count').textContent).toBe('1');

  localStorage.setItem('dailyTasksByDate', JSON.stringify(legacyPayload));
  const rerun = controller.__testing.migrateLegacyDailyTasks();
  expect(rerun).toMatchObject({ migrated: 0, existing: 3, invalid: 0, verified: true, sourceRemoved: true });
  expect(controller.__testing.getItems()).toHaveLength(3);
  expect(localStorage.getItem('dailyTasksByDate')).toBeNull();
  controller.__testing.setItems([]);
  controller.__testing.persistItems();
});

test('legacy Today migration keeps the source when any item cannot be safely converted', async () => {
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
    <div id="wrapper"><ul id="list"></ul></div>
    <div id="status"></div>
    <div id="syncStatus"></div>
  `;
  const now = new Date();
  const todayId = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  localStorage.setItem('dailyTasksByDate', JSON.stringify({
    [todayId]: [
      { id: 'valid', text: 'Keep this task', completed: false },
      { id: 'invalid', text: '', completed: false },
    ],
  }));

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

  expect(controller.__testing.getItems().map((item) => item.title)).toEqual(['Keep this task']);
  expect(localStorage.getItem('dailyTasksByDate')).not.toBeNull();
  const rerun = controller.__testing.migrateLegacyDailyTasks();
  expect(rerun).toMatchObject({ migrated: 0, existing: 1, invalid: 1, verified: false, sourceRemoved: false });
  expect(controller.__testing.getItems()).toHaveLength(1);
  controller.__testing.setItems([]);
  controller.__testing.persistItems();
});

test('category selectors include School, Footy, and existing presets', async () => {
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
    'Footy',
    'Footy – Drills',
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
