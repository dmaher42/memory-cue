/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

let api;
let changeAuthSession;
let postToWorker;

const futureDue = (offsetMinutes) => new Date(
  Date.now() + (offsetMinutes * 60 * 1000)
).toISOString();

async function initializeController(overrides = {}, initialUser = {
  uid: 'user-a',
  email: 'a@example.test',
}) {
  const controller = loadReminderController({
    ...overrides,
    initAuth: async ({ onSessionChange }) => {
      changeAuthSession = onSessionChange;
      await onSessionChange(initialUser);
      return {};
    },
  });
  api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="status"></div><div id="reminders"></div>';
  localStorage.clear();
  postToWorker = jest.fn();
  const worker = { postMessage: postToWorker };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: worker }),
      controller: worker,
      addEventListener: jest.fn(),
    },
  });
  global.Notification = class MockNotification {
    static permission = 'denied';
  };
  window.Notification = global.Notification;
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  api?.closeActiveNotifications();
  localStorage.clear();
  jest.restoreAllMocks();
  delete global.TimestampTrigger;
  delete window.TimestampTrigger;
  delete global.ServiceWorkerRegistration;
  delete window.ServiceWorkerRegistration;
});

test('TimestampTrigger devices still receive an empty worker snapshot and persisted tombstones', async () => {
  class MockServiceWorkerRegistration {}
  MockServiceWorkerRegistration.prototype.showNotification = jest.fn();
  class MockTimestampTrigger {}
  global.ServiceWorkerRegistration = MockServiceWorkerRegistration;
  window.ServiceWorkerRegistration = MockServiceWorkerRegistration;
  global.TimestampTrigger = MockTimestampTrigger;
  window.TimestampTrigger = MockTimestampTrigger;
  global.Notification.permission = 'granted';
  localStorage.setItem('memoryCue:scheduledReminderTombstones', JSON.stringify([{
    id: 'completed-before-reload',
    ownerUserId: 'user-a',
    done: true,
    deleted: true,
    updatedAt: 200,
  }]));

  await initializeController({ loadReminders: () => [] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshots = postToWorker.mock.calls
    .map(([message]) => message)
    .filter((message) => message?.type === 'memoryCue:updateScheduledReminders');
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      reminders: [],
      tombstones: expect.arrayContaining([
        expect.objectContaining({ id: 'completed-before-reload', updatedAt: 200 }),
      ]),
      notificationTriggersSupported: true,
    }),
  ]));
  expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
    type: 'memoryCue:checkScheduledReminders',
  }));
});

test('remote Done and delete remove their existing schedules and create tombstones', async () => {
  await initializeController();
  const firstDue = futureDue(60);
  const secondDue = futureDue(90);
  const thirdDue = futureDue(120);
  api.__testing.setItems([
    { id: 'remote-done', title: 'Done remotely', due: firstDue, userId: 'user-a', updatedAt: 100 },
    { id: 'remote-delete', title: 'Deleted remotely', due: secondDue, userId: 'user-a', updatedAt: 110 },
    { id: 'remote-suppressed', title: 'Suppressed remotely', due: thirdDue, userId: 'user-a', updatedAt: 120 },
  ]);
  api.__testing.rescheduleAllReminders();
  expect(Object.keys(api.__testing.getScheduledReminders())).toEqual([
    'remote-done',
    'remote-delete',
    'remote-suppressed',
  ]);

  api.__testing.setItems([
    {
      id: 'remote-done',
      title: 'Done remotely',
      due: firstDue,
      userId: 'user-a',
      updatedAt: 200,
      done: true,
      completed: true,
    },
    {
      id: 'remote-suppressed',
      title: 'Suppressed remotely',
      due: thirdDue,
      userId: 'user-a',
      updatedAt: 220,
      metadata: { suppressNotification: true },
    },
  ]);
  api.__testing.rescheduleAllReminders();

  expect(api.__testing.getScheduledReminders()).toEqual({});
  const tombstones = api.__testing.getScheduledReminderTombstones();
  expect(tombstones).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'remote-done', updatedAt: 200, deleted: true }),
    expect.objectContaining({ id: 'remote-delete', deleted: true }),
    expect.objectContaining({ id: 'remote-suppressed', updatedAt: 220, deleted: true }),
  ]));
});

test('remote due changes replace the schedule, reset stale notified state, and unchanged snapshots do not reschedule', async () => {
  const originalDue = futureDue(60);
  const notifiedAt = Date.now();
  localStorage.setItem('scheduledReminders', JSON.stringify({
    appointment: {
      id: 'appointment',
      ownerUserId: 'user-a',
      title: 'Appointment',
      due: originalDue,
      notifyAt: originalDue,
      category: 'General',
      priority: 'Medium',
      notes: '',
      body: `Due ${originalDue}`,
      urlPath: 'mobile.html#reminders',
      updatedAt: 100,
      notifiedAt,
    },
  }));
  await initializeController({
    loadReminders: () => [{
      id: 'appointment',
      title: 'Appointment',
      due: originalDue,
      notifyAt: originalDue,
      userId: 'user-a',
      updatedAt: 100,
    }],
  });

  expect(api.__testing.getScheduledReminders().appointment.notifiedAt).toBe(notifiedAt);
  postToWorker.mockClear();
  api.__testing.rescheduleAllReminders();
  await Promise.resolve();
  expect(postToWorker.mock.calls.some(([message]) => (
    message?.type === 'memoryCue:updateScheduledReminders'
    || message?.type === 'memoryCue:cancelScheduledReminder'
  ))).toBe(false);

  const changedDue = futureDue(120);
  api.__testing.setItems([{
    id: 'appointment',
    title: 'Appointment',
    due: changedDue,
    notifyAt: changedDue,
    userId: 'user-a',
    updatedAt: 200,
  }]);
  api.__testing.rescheduleAllReminders();

  expect(api.__testing.getScheduledReminders().appointment).toEqual(expect.objectContaining({
    due: changedDue,
    updatedAt: 200,
    notifiedAt: null,
  }));
});

test('switching accounts cancels the previous schedule and switching back rearms its unchanged reminder', async () => {
  await initializeController();
  const accountAReminder = {
    id: 'account-a-reminder',
    title: 'Account A appointment',
    due: futureDue(60),
    userId: 'user-a',
    updatedAt: 100,
  };
  api.__testing.setItems([accountAReminder]);
  api.__testing.rescheduleAllReminders();
  expect(api.__testing.getScheduledReminders()['account-a-reminder']).toBeDefined();

  await changeAuthSession({ uid: 'user-b', email: 'b@example.test' });

  expect(api.__testing.getScheduledReminders()['account-a-reminder']).toBeUndefined();
  expect(api.__testing.getScheduledReminderTombstones()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'account-a-reminder',
      ownerUserId: 'user-a',
      deleted: true,
    }),
  ]));

  const persistedTombstones = JSON.parse(
    localStorage.getItem('memoryCue:scheduledReminderTombstones') || '[]'
  );
  expect(persistedTombstones).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'account-a-reminder',
      transientAccountCleanup: true,
    }),
  ]));

  // Simulate closing/reloading while account B remains active, then returning
  // to A with the same unchanged authoritative reminder.
  window.dispatchEvent(new Event('pagehide'));
  api.closeActiveNotifications();
  await initializeController(
    { loadReminders: () => [accountAReminder] },
    { uid: 'user-b', email: 'b@example.test' }
  );
  expect(api.__testing.getScheduledReminders()['account-a-reminder']).toBeUndefined();

  await changeAuthSession({ uid: 'user-a', email: 'a@example.test' });

  expect(api.__testing.getScheduledReminders()['account-a-reminder']).toEqual(expect.objectContaining({
    ownerUserId: 'user-a',
    due: accountAReminder.due,
  }));
  expect(api.__testing.getScheduledReminderTombstones()).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'account-a-reminder' }),
  ]));

  postToWorker.mockClear();
  api.__testing.rescheduleAllReminders();
  await Promise.resolve();
  expect(postToWorker.mock.calls.some(([message]) => (
    message?.type === 'memoryCue:updateScheduledReminders'
    || message?.type === 'memoryCue:cancelScheduledReminder'
  ))).toBe(false);
});

test('schedule ordering keeps a pending Done over a stale reopen but accepts a genuinely newer reopen', async () => {
  await initializeController();
  const due = futureDue(60);
  api.__testing.setItems([{
    id: 'reopen-order',
    title: 'Appointment',
    due,
    userId: 'user-a',
    updatedAt: 100,
  }]);
  api.__testing.rescheduleAllReminders();
  expect(api.__testing.getScheduledReminders()['reopen-order'].updatedAt).toBe(100);

  api.__testing.setItems([{
    id: 'reopen-order',
    title: 'Appointment',
    due,
    userId: 'user-a',
    updatedAt: 200,
    done: true,
  }]);
  api.__testing.rescheduleAllReminders();
  expect(api.__testing.getScheduledReminders()['reopen-order']).toBeUndefined();
  expect(api.__testing.getScheduledReminderTombstones()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'reopen-order', updatedAt: 200 }),
  ]));

  api.__testing.setItems([{
    id: 'reopen-order',
    title: 'Stale active copy',
    due,
    userId: 'user-a',
    updatedAt: 150,
    done: false,
  }]);
  api.__testing.rescheduleAllReminders();
  expect(api.__testing.getScheduledReminders()['reopen-order']).toBeUndefined();

  api.__testing.setItems([{
    id: 'reopen-order',
    title: 'Reopened later',
    due,
    userId: 'user-a',
    updatedAt: 300,
    done: false,
  }]);
  api.__testing.rescheduleAllReminders();
  expect(api.__testing.getScheduledReminders()['reopen-order']).toEqual(expect.objectContaining({
    title: 'Reopened later',
    updatedAt: 300,
  }));
  expect(api.__testing.getScheduledReminderTombstones()).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'reopen-order' }),
  ]));
});
