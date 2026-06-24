/** @jest-environment jsdom */

const { beforeEach, afterEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

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

beforeEach(() => {
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
  localStorage.clear();
  document.body.innerHTML = '';
});

// Regression for the temporal-dead-zone crash that left the reminders list blank
// on the deployed (signed-in) app: Firebase restores a persisted session and
// fires onSessionChange *synchronously* during `await initAuth(...)` inside
// initReminders. That callback renders and starts the group-colour sync, which
// read group-colour state declared further down the function - i.e. still in its
// TDZ - throwing "Cannot access ... before initialization".
test('initReminders survives onSessionChange firing synchronously during init (persisted sign-in)', async () => {
  const initAuth = async ({ onSessionChange } = {}) => {
    if (typeof onSessionChange === 'function') {
      // Simulate Firebase replaying a persisted signed-in user during init.
      await onSessionChange({ uid: 'user-123', email: 'user@example.com' });
    }
    return { signOut: async () => {} };
  };

  const { initReminders } = loadReminderController({ initAuth });

  await expect(
    initReminders({
      statusSel: '#status',
      listWrapperSel: '#remindersWrapper',
      emptyStateSel: '#emptyState',
      listSel: '#reminderList',
      googleSignInBtnSel: '#googleSignInBtn',
      firebaseDeps: createFirebaseStubs(),
    }),
  ).resolves.toBeDefined();
});
