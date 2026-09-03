/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

let api;

const flushUntil = async (predicate, message = 'Condition was not reached') => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(message);
};

beforeEach(() => {
  document.body.innerHTML = '<div id="status"></div><div id="reminders"></div>';
  document.title = 'Memory Cue';
  localStorage.clear();
  global.fetch = jest.fn();
  window.fetch = global.fetch;
  global.Notification = class MockNotification {
    static permission = 'granted';
  };
  window.Notification = global.Notification;
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  api?.closeActiveNotifications();
  localStorage.clear();
  jest.restoreAllMocks();
});

test('a signed-out local reminder can still be completed from its notification', async () => {
  const postToWorker = jest.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage: postToWorker } }),
      controller: { postMessage: postToWorker },
      addEventListener: jest.fn(),
    },
  });
  const saveReminder = jest.fn().mockResolvedValue(true);
  const reminderDataService = {
    createReminder: () => null,
    updateReminder: () => null,
    deleteReminder: () => null,
    completeReminder: (id, completed, options = {}) => {
      const record = {
        id,
        done: Boolean(completed),
        completed: Boolean(completed),
        completedAt: completed ? Date.now() : null,
        updatedAt: Date.now(),
      };
      options.onCompleted?.(record);
      return record;
    },
  };
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const controller = loadReminderController({
    saveReminder,
    reminderDataService,
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange(null);
      resolveAuthReady();
      return {};
    },
  });
  api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
  await authReady;
  postToWorker.mockClear();

  api.__testing.setItems([{
    id: 'signed-out-local-reminder',
    title: 'Local appointment',
    due: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
    urgentAlert: true,
    hasExplicitTime: true,
    done: false,
  }]);

  await expect(api.handleUrgentAction('done', 'signed-out-local-reminder', 't-15', {
    actionId: 'signed-out-local-action',
    actionCreatedAt: Date.now(),
    ownerUserId: '',
    requireRemotePersistence: true,
  })).resolves.toBe(true);

  expect(api.__testing.getItems()[0].done).toBe(true);
  expect(saveReminder).not.toHaveBeenCalled();
  expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
    type: 'memoryCue:urgentActionCompleted',
    actionId: 'signed-out-local-action',
  }));
});

test('an offline cloud hydration cannot discard a queued action for a remote-only reminder', async () => {
  const postToWorker = jest.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage: postToWorker } }),
      controller: { postMessage: postToWorker },
      addEventListener: jest.fn(),
    },
  });
  const setupReminderFirestoreSync = jest.fn(async ({ hydrateOfflineReminders }) => {
    hydrateOfflineReminders();
    return {
      unsubscribe: null,
      authoritative: false,
    };
  });
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const controller = loadReminderController({
    createReminderFirestoreSync: () => ({ setupReminderFirestoreSync }),
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'phone-user', email: 'phone@example.test' });
      resolveAuthReady();
      return {};
    },
  });
  api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
  await authReady;
  postToWorker.mockClear();

  await expect(api.handleUrgentAction('done', 'remote-only-reminder', 'due', {
    actionId: 'offline-queued-action',
    actionCreatedAt: Date.now(),
    ownerUserId: 'phone-user',
    requireRemotePersistence: true,
  })).resolves.toBe(false);

  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(1);
  expect(postToWorker).not.toHaveBeenCalledWith(expect.objectContaining({
    type: 'memoryCue:urgentActionCompleted',
    actionId: 'offline-queued-action',
  }));
});

test('coming online hydrates remote reminders before replaying and applying a queued action', async () => {
  const actionCreatedAt = Date.now();
  const queuedAction = {
    type: 'memoryCue:urgentAction',
    action: 'done',
    reminderId: 'remote-after-reconnect',
    stageKey: 't-15',
    actionId: 'queued-until-reconnect',
    actionCreatedAt,
    ownerUserId: 'phone-user',
    reminderUpdatedAt: actionCreatedAt - 1000,
  };
  let serviceWorkerMessageHandler = null;
  const postToWorker = jest.fn((message) => {
    if (message?.type === 'memoryCue:requestPendingUrgentActions') {
      Promise.resolve().then(() => {
        serviceWorkerMessageHandler?.({ data: queuedAction });
      });
    }
  });
  const worker = { postMessage: postToWorker };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: worker }),
      controller: worker,
      addEventListener: jest.fn((type, handler) => {
        if (type === 'message') {
          serviceWorkerMessageHandler = handler;
        }
      }),
    },
  });
  const saveReminder = jest.fn().mockResolvedValue(true);
  const reminderDataService = {
    createReminder: () => null,
    updateReminder: () => null,
    deleteReminder: () => null,
    completeReminder: (id, completed, options = {}) => {
      const record = {
        id,
        done: Boolean(completed),
        completed: Boolean(completed),
        completedAt: completed ? Date.now() : null,
        updatedAt: Date.now(),
      };
      options.onCompleted?.(record);
      return record;
    },
  };
  let setupCalls = 0;
  const createReminderFirestoreSync = (options) => ({
    setupReminderFirestoreSync: jest.fn(async ({ hydrateOfflineReminders }) => {
      setupCalls += 1;
      if (setupCalls === 1) {
        hydrateOfflineReminders();
        return { unsubscribe: null, authoritative: false };
      }
      options.setItems([{
        id: 'remote-after-reconnect',
        title: 'Loaded after reconnect',
        due: new Date(actionCreatedAt + (10 * 60 * 1000)).toISOString(),
        urgentAlert: true,
        hasExplicitTime: true,
        done: false,
        userId: 'phone-user',
        updatedAt: actionCreatedAt - 1000,
      }]);
      options.rescheduleAllReminders();
      return { unsubscribe: jest.fn(), authoritative: true };
    }),
  });
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const controller = loadReminderController({
    createReminderFirestoreSync,
    reminderDataService,
    saveReminder,
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'phone-user', email: 'phone@example.test' });
      resolveAuthReady();
      return {};
    },
  });

  api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
  await authReady;
  await flushUntil(() => serviceWorkerMessageHandler !== null, 'Worker action handler was not installed');
  await Promise.resolve();
  expect(saveReminder).not.toHaveBeenCalled();

  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('online'));

  await flushUntil(
    () => postToWorker.mock.calls.some(([message]) => (
      message?.type === 'memoryCue:urgentActionCompleted'
      && message?.actionId === 'queued-until-reconnect'
    )),
    'Queued action was not completed after reconnect hydration'
  );

  expect(setupCalls).toBe(2);
  expect(saveReminder).toHaveBeenCalledTimes(1);
  expect(saveReminder.mock.calls[0][1]).toEqual(expect.objectContaining({
    id: 'remote-after-reconnect',
    done: true,
  }));
  expect(api.__testing.getItems()[0].done).toBe(true);
});

test('coming online retries authoritative hydration while pending writes remain', async () => {
  const postToWorker = jest.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage: postToWorker } }),
      controller: { postMessage: postToWorker },
      addEventListener: jest.fn(),
    },
  });
  let setupCalls = 0;
  const setupReminderFirestoreSync = jest.fn(async () => {
    setupCalls += 1;
    return {
      unsubscribe: jest.fn(),
      authoritative: true,
      pendingWork: setupCalls === 1,
    };
  });
  let resolveAuthReady;
  const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });
  const controller = loadReminderController({
    createReminderFirestoreSync: () => ({ setupReminderFirestoreSync }),
    initAuth: async ({ onSessionChange }) => {
      await onSessionChange({ uid: 'phone-user', email: 'phone@example.test' });
      resolveAuthReady();
      return {};
    },
  });

  api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
  await authReady;
  expect(setupCalls).toBe(1);

  window.dispatchEvent(new Event('online'));
  await flushUntil(() => setupCalls === 2, 'Pending reminder work was not retried online');

  expect(setupReminderFirestoreSync).toHaveBeenCalledTimes(2);
});
