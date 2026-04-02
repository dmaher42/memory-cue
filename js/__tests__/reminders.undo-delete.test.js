/** @jest-environment jsdom */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

function loadRemindersModule() {
  return loadReminderController();
}

function createFirebaseStubs() {
  return {
    initializeApp: jest.fn(() => ({})),
    initializeFirestore: jest.fn(() => ({})),
    getFirestore: jest.fn(() => ({})),
    enableMultiTabIndexedDbPersistence: jest.fn(() => Promise.resolve()),
    enableIndexedDbPersistence: jest.fn(() => Promise.resolve()),
    doc: jest.fn(() => ({})),
    setDoc: jest.fn(() => Promise.resolve()),
    deleteDoc: jest.fn(() => Promise.resolve()),
    onSnapshot: jest.fn(() => () => {}),
    collection: jest.fn(() => ({})),
    query: jest.fn(() => ({})),
    orderBy: jest.fn(() => ({})),
    persistentLocalCache: jest.fn(() => ({})),
    serverTimestamp: jest.fn(() => new Date()),
    getAuth: jest.fn(() => ({})),
    onAuthStateChanged: jest.fn((_auth, callback) => {
      callback(null);
      return jest.fn();
    }),
    GoogleAuthProvider: jest.fn(function Provider() {}),
    signInWithPopup: jest.fn(() => Promise.resolve()),
    signInWithRedirect: jest.fn(() => Promise.resolve()),
    getRedirectResult: jest.fn(() => Promise.resolve(null)),
    signOut: jest.fn(() => Promise.resolve()),
  };
}

describe('reminder deletion undo', () => {
  let controller;
  let firebaseDeps;

  beforeEach(async () => {
    jest.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="remindersWrapper">
        <div id="emptyState"></div>
        <ul id="reminderList"></ul>
      </div>
    `;

    window.CustomEvent = window.CustomEvent || function CustomEvent(event, params = {}) {
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles ?? false, params.cancelable ?? false, params.detail);
      return evt;
    };
    global.CustomEvent = window.CustomEvent;

    firebaseDeps = createFirebaseStubs();
    const { initReminders } = loadRemindersModule();
    controller = await initReminders({
      statusSel: '#status',
      listWrapperSel: '#remindersWrapper',
      emptyStateSel: '#emptyState',
      listSel: '#reminderList',
      firebaseDeps,
      variant: 'desktop',
    });
  });

  afterEach(() => {
    controller = null;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('allows a reminder deletion to be undone', async () => {
    const now = Date.now();
    controller.__testing.setItems([
      {
        id: 'rem-undo',
        title: 'Undo candidate',
        priority: 'High',
        category: 'General',
        notes: '',
        done: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    controller.__testing.render();

    const deleteButton = document.querySelector('[data-action="delete"]');
    expect(deleteButton).toBeTruthy();

    deleteButton.click();
    await Promise.resolve();

    expect(controller.__testing.getItems()).toHaveLength(0);

    const statusEl = document.getElementById('status');
    expect(statusEl.dataset.statusKind).toBe('undo');
    const undoButton = statusEl.querySelector('button');
    expect(undoButton).toBeTruthy();

    undoButton.click();
    await Promise.resolve();

    const items = controller.__testing.getItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('rem-undo');
    expect(statusEl.textContent).toBe('');

    jest.runOnlyPendingTimers();
    expect(statusEl.textContent).toBe('');
  });

  test('clears the undo prompt after the timeout elapses', async () => {
    const now = Date.now();
    controller.__testing.setItems([
      {
        id: 'rem-timeout',
        title: 'Timeout candidate',
        priority: 'Medium',
        category: 'General',
        notes: '',
        done: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    controller.__testing.render();

    const deleteButton = document.querySelector('[data-action="delete"]');
    deleteButton.click();
    await Promise.resolve();

    const statusEl = document.getElementById('status');
    expect(statusEl.dataset.statusKind).toBe('undo');

    jest.advanceTimersByTime(6000);
    jest.runOnlyPendingTimers();

    expect(statusEl.textContent).toBe('');
    expect(statusEl.dataset.statusKind).toBeUndefined();
    expect(statusEl.dataset.undoToken).toBeUndefined();
  });
});
