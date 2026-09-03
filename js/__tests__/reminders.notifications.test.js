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
    delete window.toast;
    delete window.__MEMORY_CUE_PHONE_PUSH_STATUS;
    delete navigator.serviceWorker;
  });

  async function waitForMockCall(mock, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (mock.mock.calls.length > 0) {
        return;
      }
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for the notification registration attempt');
  }

  async function initialiseNotificationButton(pushRegistrationResult) {
    document.body.innerHTML = `
      <div id="status"></div>
      <input id="notifBtn" type="checkbox" />
    `;
    const serviceWorkerRegistration = {
      active: { postMessage: jest.fn() },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve(serviceWorkerRegistration),
        controller: serviceWorkerRegistration.active,
      },
    });

    const registerReminderPushDevice = jest.fn().mockResolvedValue(pushRegistrationResult);
    window.toast = jest.fn();

    const remindersModule = loadReminderController({
      initAuth: async ({ onSessionChange }) => {
        await onSessionChange({ uid: 'phone-user', email: 'phone@example.com' });
        return {};
      },
      registerReminderPushDevice,
    });
    api = await remindersModule.initReminders({
      statusSel: '#status',
      notifBtnSel: '#notifBtn',
    });

    await waitForMockCall(registerReminderPushDevice);
    registerReminderPushDevice.mockClear();
    window.toast.mockClear();
    return registerReminderPushDevice;
  }

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

  test('reports local reminders separately when phone push registration is unavailable', async () => {
    const registerReminderPushDevice = await initialiseNotificationButton(null);
    const statusEvents = [];
    document.addEventListener('reminder:notification-permission-changed', (event) => {
      statusEvents.push(event.detail);
    }, { once: true });

    document.getElementById('notifBtn').click();
    await waitForMockCall(registerReminderPushDevice);

    expect(window.toast).toHaveBeenCalledWith(
      'Local reminders enabled. This device is not registered for lock-screen alerts.'
    );
    expect(window.toast).not.toHaveBeenCalledWith('Notifications enabled');
    expect(statusEvents).toContainEqual({
      permission: 'granted',
      phonePushStatus: 'unavailable',
    });
  });

  test('confirms the phone connection only after push registration succeeds', async () => {
    const registerReminderPushDevice = await initialiseNotificationButton({
      id: 'phone-device',
      token: 'registered-token',
    });
    const statusEvents = [];
    document.addEventListener('reminder:notification-permission-changed', (event) => {
      statusEvents.push(event.detail);
    }, { once: true });

    document.getElementById('notifBtn').click();
    await waitForMockCall(registerReminderPushDevice);

    expect(window.toast).toHaveBeenCalledWith(
      'Local reminders enabled. This device is registered for lock-screen alerts.'
    );
    expect(statusEvents).toContainEqual({
      permission: 'granted',
      phonePushStatus: 'connected',
    });
  });
});
