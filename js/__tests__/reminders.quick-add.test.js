/** @jest-environment jsdom */

const { beforeEach, afterEach, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRemindersModule() {
  const filePath = path.resolve(__dirname, '../reminders.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    "import { setAuthContext, startSignInFlow, startSignOutFlow } from './supabase-auth.js';\n",
    'const setAuthContext = () => {}; const startSignInFlow = () => {}; const startSignOutFlow = () => {};\n',
  );
  source = source.replace(/export\s+async\s+function\s+initReminders/, 'async function initReminders');
  source += '\nmodule.exports = { initReminders };\n';
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
    HTMLElement: window.HTMLElement,
    Date,
    fetch: global.fetch,
    Blob: global.Blob,
    Response: global.Response,
    URL: global.URL,
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
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
    <input id="quickAddInput" />
  `;

  const { initReminders } = loadRemindersModule();
  controller = await initReminders({
    statusSel: '#status',
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
  const quickInput = document.getElementById('quickAddInput');
  quickInput.value = 'footy drill: cone sprint ladders';

  await window.memoryCueQuickAddNow();

  const items = controller.__testing.getItems();
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe('cone sprint ladders');
  expect(items[0].category).toBe('Footy – Drills');
  expect(Number.isFinite(items[0].createdAt)).toBe(true);
  expect(Number.isFinite(items[0].updatedAt)).toBe(true);
});

test('quick add routes task prefix to Tasks category', async () => {
  const quickInput = document.getElementById('quickAddInput');
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
  const quickInput = document.getElementById('quickAddInput');
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

test('quick add parses natural language time into due date', async () => {
  const quickInput = document.getElementById('quickAddInput');
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
