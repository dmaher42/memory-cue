/** @jest-environment jsdom */

const { beforeEach, afterEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

function loadRemindersModule() {
  return loadReminderController();
}

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

let controller;

beforeEach(async () => {
  jest.useFakeTimers({ now: Date.UTC(2024, 4, 15, 9, 0, 0) });
  localStorage.clear();
  document.body.innerHTML = `
    <div id="status"></div>
    <div id="remindersWrapper">
      <div id="emptyState"></div>
      <ul id="reminderList"></ul>
    </div>
    <input id="reminderText" />
    <input id="reminderDate" type="date" />
    <input id="reminderTime" type="time" />
    <form id="quickAddForm">
      <input id="reminderQuickAdd" />
      <button id="quickAddSubmit" type="button">Add</button>
      <button id="quickAddVoice" type="button">Voice</button>
      <div id="quickAddParsingIndicator" hidden></div>
      <div id="quickAddSuccessIndicator" hidden></div>
    </form>
  `;

  const { initReminders } = loadRemindersModule();
  controller = await initReminders({
    statusSel: '#status',
    titleSel: '#reminderText',
    dateSel: '#reminderDate',
    timeSel: '#reminderTime',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
    firebaseDeps: createFirebaseStubs(),
  });
});

afterEach(() => {
  controller = null;
  jest.useRealTimers();
  localStorage.clear();
  document.body.innerHTML = '';
});

test('quick add routes footy drill prefix to Footy – Drills category', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'footy drill: cone sprint ladders';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe('cone sprint ladders');
  expect(items[0].category).toBe('Footy – Drills');
  expect(Number.isFinite(items[0].createdAt)).toBe(true);
  expect(Number.isFinite(items[0].updatedAt)).toBe(true);

  const memoryEntries = JSON.parse(localStorage.getItem('memoryCueInbox') || '[]');
  expect(memoryEntries).toHaveLength(1);
  expect(memoryEntries[0].text).toBe('footy drill: cone sprint ladders');
  expect(memoryEntries[0].source).toBe('quick-add');
  expect(memoryEntries[0].parsedType).toBe('reminder');
  expect(Number.isFinite(memoryEntries[0].createdAt)).toBe(true);
});

test('quick add routes task prefix to Tasks category', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'TASK: mark lesson plans';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe('mark lesson plans');
  expect(items[0].category).toBe('Tasks');
  expect(Number.isFinite(items[0].createdAt)).toBe(true);
  expect(Number.isFinite(items[0].updatedAt)).toBe(true);
});

test('quick add routes reflection prefix to Lesson – Reflections notes folder', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'Reflection: Year 8 class responded better to shorter instructions';

  const note = await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(0);
  expect(note).toBeTruthy();

  const folders = JSON.parse(localStorage.getItem('memoryCueFolders') || '[]');
  const reflectionFolder = folders.find((folder) => folder?.name === 'Lesson – Reflections');
  expect(reflectionFolder).toBeTruthy();

  const notes = JSON.parse(localStorage.getItem('memoryCueNotes') || '[]');
  expect(Array.isArray(notes)).toBe(true);
  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Year 8 class responded better to shorter instructions');
  expect(notes[0].folderId).toBe(reflectionFolder.id);
  expect(typeof notes[0].updatedAt).toBe('string');
  expect(Number.isNaN(Date.parse(notes[0].updatedAt))).toBe(false);
});



test('inbox search parser handles weekday plus time', () => {
  const parsed = controller.__testing.parseInboxTimeQuery('Monday 4pm', new Date('2024-05-15T09:00:00Z'));

  expect(parsed.keywordQuery).toBe('');
  expect(parsed.timeRange).toBeTruthy();
  expect(Number.isFinite(parsed.timeRange.start)).toBe(true);
  expect(Number.isFinite(parsed.timeRange.end)).toBe(true);
  expect(parsed.timeRange.end).toBeGreaterThan(parsed.timeRange.start);
});

test('inbox search parser handles today keyword without time', () => {
  const parsed = controller.__testing.parseInboxTimeQuery('today', new Date('2024-05-15T09:00:00Z'));

  expect(parsed.keywordQuery).toBe('');
  expect(parsed.timeRange).toBeTruthy();
  expect(parsed.timeRange.end).toBeGreaterThan(parsed.timeRange.start);
});

test('inbox search parser falls back to keyword-only when no time pattern exists', () => {
  const parsed = controller.__testing.parseInboxTimeQuery('mark reports');

  expect(parsed.keywordQuery).toBe('mark reports');
  expect(parsed.timeRange).toBeNull();
});


test('quick add stores reminder suggestion when text contains time reference', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'Call parents tomorrow 1pm';

  await window.memoryCueQuickAddNow();

  const memoryEntries = JSON.parse(localStorage.getItem('memoryCueInbox') || '[]');
  expect(memoryEntries).toHaveLength(1);
  expect(memoryEntries[0].source).toBe('quick-add');
});

test('quick add parses natural language time into due date', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'Call parents tomorrow 1pm';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  const item = items[0];

  const expected = new Date();
  expected.setDate(expected.getDate() + 1);
  expected.setHours(13, 0, 0, 0);
  const expectedIso = expected.toISOString();

  expect(item.due).toBe(expectedIso);
});

test('quick add parses explicit date and time into due date', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'Call parents Mon 20 May 4pm';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  const item = items[0];

  const expected = new Date();
  expected.setFullYear(2024, 4, 20);
  expected.setHours(16, 0, 0, 0);
  const expectedIso = expected.toISOString();

  expect(item.title).toBe('Call parents');
  expect(item.due).toBe(expectedIso);
});

test('quick add parses compact time ranges into due date and cleans title', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = 'Archer Basketball 330-530';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  const item = items[0];

  const expected = new Date();
  expected.setDate(expected.getDate() + 1);
  expected.setHours(15, 30, 0, 0);
  const expectedIso = expected.toISOString();

  expect(item.title).toBe('Archer Basketball');
  expect(item.due).toBe(expectedIso);
});

test('quick add with weekday range fills edit reminder date and time fields', async () => {
  const quickInput = document.getElementById('reminderQuickAdd');
  quickInput.value = '! Archer Basketball Sunday 330-530';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  const item = items[0];
  expect(item.due).toBeTruthy();
  expect(Number.isNaN(new Date(item.due).getTime())).toBe(false);

  window.openEditReminderSheet(item);

  expect(document.getElementById('reminderDate').value).toBe('2024-05-19');
  expect(document.getElementById('reminderTime').value).toBe('15:30');
  expect(item.title).toBe('Archer Basketball');
});
