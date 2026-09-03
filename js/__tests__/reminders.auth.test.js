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

async function waitForCondition(predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for auth state');
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

test('removes a push registration that finishes after its account signs out', async () => {
  const registration = { active: { postMessage: jest.fn() } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      controller: registration.active,
    },
  });
  global.Notification = { permission: 'granted' };

  let resolveRegistration;
  const registrationGate = new Promise((resolve) => {
    resolveRegistration = resolve;
  });
  let changeAuthSession = null;
  const registerReminderPushDevice = jest.fn(() => registrationGate);
  const unregisterReminderPushDevice = jest.fn(async () => true);
  const startSignOutFlow = jest.fn(async () => {
    await changeAuthSession(null);
  });
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      changeAuthSession = onSessionChange;
      void onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
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

  document.getElementById('googleSignOutBtn').click();
  await waitForMockCall(startSignOutFlow);
  resolveRegistration({ id: 'phone-device' });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (unregisterReminderPushDevice.mock.calls.some(([options]) => (
      options?.userId === 'teacher-1' && options?.preserveMessagingToken === true
    ))) {
      break;
    }
    await Promise.resolve();
  }

  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({ userId: 'teacher-1' });
  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({
    userId: 'teacher-1',
    preserveMessagingToken: true,
  });
});

test('Firebase account changes remove the previous device record with the correct token handling', async () => {
  let changeAuthSession = null;
  const unregisterReminderPushDevice = jest.fn(async () => true);
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      changeAuthSession = onSessionChange;
      await onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
      return {};
    },
    unregisterReminderPushDevice,
  });

  controller = await initReminders({ statusSel: '#status' });
  unregisterReminderPushDevice.mockClear();

  await changeAuthSession({ uid: 'teacher-2', email: 'teacher2@example.com' });
  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({
    userId: 'teacher-1',
    preserveMessagingToken: true,
  });

  unregisterReminderPushDevice.mockClear();
  await changeAuthSession(null);
  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({ userId: 'teacher-2' });
});

test('a deferred registration from an earlier generation cannot supersede a fresh same-account session', async () => {
  const registration = { active: { postMessage: jest.fn() } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      controller: registration.active,
    },
  });
  global.Notification = { permission: 'granted' };

  let resolveStaleRegistration;
  const staleRegistration = new Promise((resolve) => {
    resolveStaleRegistration = resolve;
  });
  const events = [];
  let registrationCall = 0;
  const registerReminderPushDevice = jest.fn(() => {
    registrationCall += 1;
    if (registrationCall === 1) {
      return staleRegistration.then(() => {
        events.push('stale-registration-finished');
        return { id: 'stale-device-write' };
      });
    }
    events.push(`current-registration-${registrationCall}`);
    return Promise.resolve({ id: `current-device-${registrationCall}` });
  });
  const unregisterReminderPushDevice = jest.fn(async (options) => {
    events.push(options?.preserveMessagingToken
      ? 'unregister-preserve-token'
      : 'unregister-delete-token');
    return true;
  });
  let changeAuthSession = null;
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      changeAuthSession = onSessionChange;
      void onSessionChange({ uid: 'teacher-1', email: 'teacher@example.com' });
      return {};
    },
    registerReminderPushDevice,
    unregisterReminderPushDevice,
  });

  controller = await initReminders({ statusSel: '#status' });
  await waitForMockCall(registerReminderPushDevice);

  await changeAuthSession(null);
  await changeAuthSession({ uid: 'teacher-1', email: 'teacher@example.com' });
  expect(registerReminderPushDevice).toHaveBeenCalledTimes(2);

  resolveStaleRegistration();
  await waitForCondition(() => registerReminderPushDevice.mock.calls.length === 3);

  expect(unregisterReminderPushDevice).toHaveBeenCalledWith({
    userId: 'teacher-1',
    preserveMessagingToken: true,
  });
  expect(events.slice(-3)).toEqual([
    'stale-registration-finished',
    'unregister-preserve-token',
    'current-registration-3',
  ]);
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('connected');
});

test('keeps a cached account reminder hidden and unscheduled until that account is authenticated', async () => {
  const due = new Date(Date.now() + (60 * 60 * 1000)).toISOString();
  const accountAReminder = {
    id: 'account-a-private-reminder',
    title: 'Account A private appointment',
    notes: 'Private account A details',
    due,
    notifyAt: due,
    userId: 'account-a',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    pendingSync: false,
  };
  let storedReminders = [{ ...accountAReminder }];
  let changeAuthSession = null;
  const setupReminderFirestoreSync = jest.fn(async () => ({
    unsubscribe: jest.fn(),
    authoritative: true,
    pendingWork: false,
  }));
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      changeAuthSession = onSessionChange;
      return {};
    },
    loadReminders: () => storedReminders.map((item) => ({ ...item })),
    setStoredReminders: (nextReminders = []) => {
      storedReminders = nextReminders.map((item) => ({ ...item }));
      return storedReminders;
    },
    createReminderFirestoreSync: () => ({ setupReminderFirestoreSync }),
  });

  controller = await initReminders({
    statusSel: '#status',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
  });
  await waitForCondition(() => typeof changeAuthSession === 'function');

  const expectAccountAReminderHidden = () => {
    const renderedText = document.getElementById('reminderList').textContent.toLowerCase();
    expect(controller.__testing.getItems()).toEqual([]);
    expect(renderedText).not.toContain(accountAReminder.title.toLowerCase());
    expect(controller.__testing.getScheduledReminders()).not.toHaveProperty(accountAReminder.id);
    expect(storedReminders.some((item) => item.id === accountAReminder.id)).toBe(true);
  };

  controller.__testing.rescheduleAllReminders();
  expectAccountAReminderHidden();

  await changeAuthSession({ uid: 'account-b', email: 'account-b@example.com' });
  expectAccountAReminderHidden();

  await changeAuthSession(null);
  expectAccountAReminderHidden();

  await changeAuthSession({ uid: 'account-a', email: 'account-a@example.com' });
  expect(controller.__testing.getItems()).toEqual([
    expect.objectContaining({
      id: accountAReminder.id,
      userId: 'account-a',
      title: accountAReminder.title,
    }),
  ]);
  expect(document.getElementById('reminderList').textContent.toLowerCase()).toContain(
    accountAReminder.title.toLowerCase()
  );
  expect(controller.__testing.getScheduledReminders()).toHaveProperty(
    accountAReminder.id,
    expect.objectContaining({ ownerUserId: 'account-a', due })
  );
});

test('a transient post-login save failure is retried when the app regains focus', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const reminder = {
    id: 'save-retry-reminder',
    title: 'Retry this save',
    notes: '',
    due: null,
    userId: 'account-a',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    pendingSync: false,
  };
  let storedReminders = [{ ...reminder }];
  const saveReminder = jest.fn().mockRejectedValueOnce(new Error('temporary save failure'));
  const setupReminderFirestoreSync = jest.fn(async () => ({
    unsubscribe: jest.fn(),
    authoritative: true,
    pendingWork: false,
  }));
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'account-a', email: 'account-a@example.com' });
      resolveAuthReady();
      return {};
    },
    loadReminders: () => storedReminders.map((item) => ({ ...item })),
    setStoredReminders: (nextReminders = []) => {
      storedReminders = nextReminders.map((item) => ({ ...item }));
      return storedReminders;
    },
    saveReminder,
    createReminderFirestoreSync: () => ({ setupReminderFirestoreSync }),
  });

  controller = await initReminders({
    statusSel: '#status',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
  });
  await authReady;
  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(1);

  const saved = await controller.__testing.saveToFirebase(
    controller.__testing.getItems()[0]
  );
  expect(saved).toBe(false);
  expect(saveReminder).toHaveBeenCalledTimes(1);
  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(1);
  expect(controller.__testing.getItems()[0]).toEqual(
    expect.objectContaining({ id: reminder.id, pendingSync: true })
  );

  window.dispatchEvent(new Event('focus'));
  await waitForCondition(() => setupReminderFirestoreSync.mock.calls.length === 2);

  expect(setupReminderFirestoreSync.mock.calls[1][0]).toEqual(
    expect.objectContaining({ userId: 'account-a' })
  );
});

test('a transient post-login delete failure is retried when the app comes online', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const reminder = {
    id: 'delete-retry-reminder',
    title: 'Retry this delete',
    notes: '',
    due: null,
    userId: 'account-a',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    pendingSync: false,
  };
  let storedReminders = [{ ...reminder }];
  const removeReminder = jest.fn().mockRejectedValueOnce(new Error('temporary delete failure'));
  const setupReminderFirestoreSync = jest.fn(async () => ({
    unsubscribe: jest.fn(),
    authoritative: true,
    pendingWork: false,
  }));
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const { initReminders } = loadReminderController({
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'account-a', email: 'account-a@example.com' });
      resolveAuthReady();
      return {};
    },
    loadReminders: () => storedReminders.map((item) => ({ ...item })),
    setStoredReminders: (nextReminders = []) => {
      storedReminders = nextReminders.map((item) => ({ ...item }));
      return storedReminders;
    },
    removeReminder,
    createReminderFirestoreSync: () => ({ setupReminderFirestoreSync }),
  });

  controller = await initReminders({
    statusSel: '#status',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    listSel: '#reminderList',
  });
  await authReady;
  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(1);

  const removed = await controller.__testing.removeItem(reminder.id, { offerUndo: false });
  expect(removed).toBe(true);
  expect(removeReminder).toHaveBeenCalledTimes(1);
  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toEqual([
    expect.objectContaining({ id: reminder.id, userId: 'account-a' }),
  ]);

  window.dispatchEvent(new Event('online'));
  await waitForCondition(() => setupReminderFirestoreSync.mock.calls.length === 2);

  expect(setupReminderFirestoreSync.mock.calls[1][0]).toEqual(
    expect.objectContaining({ userId: 'account-a' })
  );
});
