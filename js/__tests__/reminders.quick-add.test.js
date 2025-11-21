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
