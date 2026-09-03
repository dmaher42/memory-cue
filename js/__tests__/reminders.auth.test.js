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

async function waitForMockCall(mock, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (mock.mock.calls.length > 0) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for auth action');
}

let controller;

beforeEach(async () => {
  document.body.innerHTML = `
    <button id="googleSignInBtn">Sign in</button>
    <button id="googleSignOutBtn">Sign out</button>
    <div id="status"></div>
    <div id="remindersWrapper">
      <div id="emptyState"></div>
      <ul id="reminderList"></ul>
    </div>
  `;
});

afterEach(() => {
  jest.restoreAllMocks();
  controller = null;
  localStorage.clear();
  document.body.innerHTML = '';
  delete window.__MEMORY_CUE_PHONE_PUSH_STATUS;
  delete navigator.serviceWorker;
  delete global.Notification;
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

test('removes the phone push registration before Firebase sign-out', async () => {
  const callOrder = [];
  const unregisterReminderPushDevice = jest.fn(async () => {
    callOrder.push('unregister');
    return true;
  });
  const startSignOutFlow = jest.fn(async () => {
    callOrder.push('sign-out');
  });
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
      return {};
    },
    unregisterReminderPushDevice,
    startSignOutFlow,
  });

  controller = await initReminders({
    statusSel: '#status',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
    googleSignOutBtnSel: '#googleSignOutBtn',
  });

  let authHandledOnSharedClick = false;
  document.addEventListener('click', (event) => {
    authHandledOnSharedClick = event.__memoryCueAuthHandled === true;
  }, { once: true });
  document.getElementById('googleSignOutBtn').click();
  await waitForMockCall(startSignOutFlow);

  expect(authHandledOnSharedClick).toBe(true);
  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({ userId: 'teacher-1' });
  expect(startSignOutFlow).toHaveBeenCalledTimes(1);
  expect(callOrder).toEqual(['unregister', 'sign-out']);
});

test('restores phone push registration when Firebase sign-out fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const registration = { active: { postMessage: jest.fn() } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      controller: registration.active,
    },
  });
  global.Notification = { permission: 'granted' };

  const registerReminderPushDevice = jest.fn(async () => ({ id: 'phone-device' }));
  const unregisterReminderPushDevice = jest.fn(async () => true);
  const startSignOutFlow = jest.fn(async () => {
    throw new Error('sign-out failed');
  });
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
      return {};
    },
    registerReminderPushDevice,
    unregisterReminderPushDevice,
    startSignOutFlow,
  });

  controller = await initReminders({
    statusSel: '#status',
    googleSignOutBtnSel: '#googleSignOutBtn',
  });
  await waitForMockCall(registerReminderPushDevice);
  registerReminderPushDevice.mockClear();

  document.getElementById('googleSignOutBtn').click();
  await waitForMockCall(startSignOutFlow);
  await waitForMockCall(registerReminderPushDevice);
  await Promise.resolve();
  await Promise.resolve();

  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({ userId: 'teacher-1' });
  expect(registerReminderPushDevice).toHaveBeenCalledWith({
    userId: 'teacher-1',
    serviceWorkerRegistration: registration,
  });
});

test('registers phone alerts before unrelated startup sync can fail', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const registration = { active: { postMessage: jest.fn() } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      controller: registration.active,
    },
  });
  global.Notification = { permission: 'granted' };

  const registerReminderPushDevice = jest.fn(async () => ({ id: 'phone-device' }));
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
      return {};
    },
    registerReminderPushDevice,
    createReminderFirestoreSync: () => ({
      setupReminderFirestoreSync: async () => {
        throw new Error('unrelated reminder sync failed');
      },
    }),
  });

  controller = await initReminders({ statusSel: '#status' });
  await waitForMockCall(registerReminderPushDevice);

  expect(registerReminderPushDevice).toHaveBeenCalledWith({
    userId: 'teacher-1',
    serviceWorkerRegistration: registration,
  });
});
