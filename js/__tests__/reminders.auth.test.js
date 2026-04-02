/** @jest-environment jsdom */

const { beforeEach, afterEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

function loadRemindersModuleWithStartSignIn(fnReplacement) {
  const startSignInFlow = new Function(`return (${fnReplacement});`)();
  return loadReminderController({ startSignInFlow });
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
  document.body.innerHTML = `
    <button id="googleSignInBtn">Sign in</button>
    <div id="status"></div>
    <div id="remindersWrapper">
      <div id="emptyState"></div>
      <ul id="reminderList"></ul>
    </div>
  `;
});

afterEach(() => {
  controller = null;
  localStorage.clear();
  document.body.innerHTML = '';
});
test('clicking #googleSignInBtn calls startSignInFlow via the wireAuthButton', async () => {
  // Arrange: inject a startSignInFlow stub that increments a global counter
  global.__startCalled = 0;
  const replacementFn = `() => { window.__startCalled = (window.__startCalled || 0) + 1; return Promise.resolve(); }`;
  const { initReminders } = loadRemindersModuleWithStartSignIn(replacementFn);

  // Act: initialize module and simulate a click
  controller = await initReminders({
    statusSel: '#status',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
    googleSignInBtnSel: '#googleSignInBtn',
    firebaseDeps: createFirebaseStubs(),
  });

  const button = document.getElementById('googleSignInBtn');
  expect(button).not.toBeNull();
  button.click();

  // Assert: the startSignInFlow stub should have been called
  expect(window.__startCalled || 0).toBe(1);
});
