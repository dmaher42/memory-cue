/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

function loadRemindersModule() {
  return loadReminderController();
}

describe('reminder notification management', () => {
  let api;
  let firebaseDeps;

  class MockNotification {
    static permission = 'granted';
    static requestPermission = jest.fn().mockResolvedValue('granted');

    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.onclose = null;
      this.onclick = null;
      this._listeners = { close: [], click: [] };
      this.close = jest.fn(() => {
        this.closed = true;
        if (typeof this.onclose === 'function') {
          this.onclose();
        }
        this._listeners.close.forEach((handler) => handler());
      });
    }

    addEventListener(event, handler) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(handler);
    }
  }

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="status"></div>';
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.Notification = MockNotification;
    window.Notification = MockNotification;
    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };

    firebaseDeps = {
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
      onAuthStateChanged: jest.fn((auth, cb) => { cb(null); return jest.fn(); }),
      GoogleAuthProvider: jest.fn(function Provider() {}),
      signInWithPopup: jest.fn(() => Promise.resolve()),
      signInWithRedirect: jest.fn(() => Promise.resolve()),
      getRedirectResult: jest.fn(() => Promise.resolve(null)),
      signOut: jest.fn(() => Promise.resolve()),
    };

    const remindersModule = loadRemindersModule();
    api = await remindersModule.initReminders({ statusSel: '#status', firebaseDeps });
  });

  afterEach(() => {
    api?.closeActiveNotifications();
    localStorage.clear();
    jest.clearAllTimers();
  });

  function createImmediateReminder(id = 'rem-1') {
    return {
      id,
      title: 'Test reminder',
      due: new Date(Date.now() - 60_000).toISOString(),
      done: false,
      priority: 'Medium',
    };
  }

  test('cancelReminder closes active notifications', () => {
    const reminder = createImmediateReminder('cancel-close');
    api.scheduleReminder(reminder);
    const active = api.getActiveNotifications();
    const notification = active.get(reminder.id);
    expect(notification).toBeDefined();
    notification.close.mockClear();

    api.cancelReminder(reminder.id);

    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(active.has(reminder.id)).toBe(false);
  });

  test('pagehide dismisses all active notifications', () => {
    const reminder = createImmediateReminder('pagehide-close');
    api.scheduleReminder(reminder);
    const active = api.getActiveNotifications();
    const notification = active.get(reminder.id);
    expect(notification).toBeDefined();
    notification.close.mockClear();

    window.dispatchEvent(new Event('pagehide'));

    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(active.size).toBe(0);
  });
});
