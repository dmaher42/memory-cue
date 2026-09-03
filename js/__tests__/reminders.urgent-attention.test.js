/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushUntil = async (predicate, message = 'Condition was not reached') => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(message);
};

const buildUrgentState = (reminders = [], nowMs = Date.now()) => {
  const entries = reminders
    .filter((reminder) => reminder && !reminder.done && reminder.urgentAlert && reminder.hasExplicitTime)
    .filter((reminder) => Date.parse(reminder.due) <= nowMs + (15 * 60 * 1000))
    .map((reminder) => {
      const dueAt = Date.parse(reminder.due);
      const stage = {
        key: 't-15',
        label: '15 minutes to go',
        kind: 'upcoming',
        startAt: dueAt - (15 * 60 * 1000),
        dueAt,
      };
      return {
        reminder,
        reminderId: reminder.id,
        stage,
        shouldBadge: true,
        shouldAlert: !reminder.urgentStartedAt
          && !(reminder.snoozedUntil && Date.parse(reminder.snoozedUntil) > nowMs)
          && !(reminder.urgentAcknowledgedAt >= stage.startAt),
      };
    });
  const badgeItems = entries.filter((entry) => entry.shouldBadge);
  return {
    badgeItems,
    alertItems: entries.filter((entry) => entry.shouldAlert),
    badgeCount: badgeItems.length,
  };
};

describe('urgent reminder attention surface', () => {
  let api;
  let postToWorker;
  let setAppBadge;
  let clearAppBadge;
  let saveReminder;
  let removeReminder;
  let syncReminderToOtherDevices;
  let changeAuthSession;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="status"></div><div id="reminders"></div>';
    document.title = 'Memory Cue';
    localStorage.clear();
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.Notification = class MockNotification {
      static permission = 'granted';
    };
    window.Notification = global.Notification;

    postToWorker = jest.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: { postMessage: postToWorker } }),
        controller: { postMessage: postToWorker },
        addEventListener: jest.fn(),
      },
    });
    setAppBadge = jest.fn().mockResolvedValue(undefined);
    clearAppBadge = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: setAppBadge });
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge });

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
    saveReminder = jest.fn().mockResolvedValue(true);
    removeReminder = jest.fn().mockResolvedValue(true);
    syncReminderToOtherDevices = jest.fn().mockResolvedValue({ sent: 0 });
    let resolveAuthReady;
    const authReady = new Promise((resolve) => {
      resolveAuthReady = resolve;
    });
    const controller = loadReminderController({
      reminderDataService,
      getUrgentReminderState: buildUrgentState,
      isUrgentTimedReminder: (reminder) => reminder?.urgentAlert === true && reminder?.hasExplicitTime === true,
      saveReminder,
      removeReminder,
      syncReminderToOtherDevices,
      initAuth: async ({ onSessionChange }) => {
        changeAuthSession = onSessionChange;
        try {
          await onSessionChange({ uid: 'urgent-test-user', email: 'urgent@example.test' });
          return {};
        } finally {
          resolveAuthReady();
        }
      },
    });
    api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
    await authReady;
    setAppBadge.mockClear();
    clearAppBadge.mockClear();
    postToWorker.mockClear();
    saveReminder.mockClear();
    removeReminder.mockClear();
    syncReminderToOtherDevices.mockClear();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    api?.closeActiveNotifications();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test('Seen stops the interruption but keeps the number and red state until Done', async () => {
    const windowsAttention = jest.spyOn(window, 'postMessage');
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'appointment-1',
      title: 'Dentist appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const surface = document.getElementById('urgentAppointmentAlert');
    expect(surface).not.toBeNull();
    expect(surface.hidden).toBe(false);
    expect(surface.textContent).toContain('Dentist appointment');
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
    expect(document.title).toMatch(/^\ud83d\udd34 1 urgent appointment \u2022 ALERT/);
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:showUrgentReminder',
      badgeCount: 1,
    }));
    expect(windowsAttention).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:windowsAttention',
      action: 'urgent',
      count: 1,
      stage: 't-15',
    }), window.location.origin);

    surface.querySelector('[data-urgent-action="acknowledge"]').click();

    expect(surface.hidden).toBe(true);
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
    expect(clearAppBadge).not.toHaveBeenCalled();
    expect(document.title).toMatch(/^\ud83d\udd34 1 urgent appointment \u2014/);
    expect(windowsAttention).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:windowsAttention',
      action: 'acknowledged',
      count: 1,
    }), window.location.origin);

    await api.handleUrgentAction('done', 'appointment-1');

    expect(clearAppBadge).toHaveBeenCalled();
    expect(document.title).toBe('Memory Cue');
    expect(api.__testing.getItems()[0].done).toBe(true);
    expect(windowsAttention).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:windowsAttention',
      action: 'clear',
      count: 0,
    }), window.location.origin);
  });

  test('restarts its urgent checker after the page returns from sleep or back-forward cache', () => {
    const setIntervalSpy = jest.spyOn(window, 'setInterval');

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('pageshow'));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  test('Start from a lock-screen action does not open the meeting twice and suppresses later stages', async () => {
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    const openMeeting = jest.spyOn(window, 'open').mockImplementation(() => null);
    api.__testing.setItems([{
      id: 'meeting-1',
      title: 'Planning meeting',
      notes: 'Join https://meet.example.test/planning',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);

    await api.handleUrgentAction('start', 'meeting-1', 't-15', {
      meetingAlreadyOpened: true,
    });

    expect(openMeeting).not.toHaveBeenCalled();
    const item = api.__testing.getItems()[0];
    expect(item.urgentStartedAt).toEqual(expect.any(Number));
    const scheduled = JSON.parse(localStorage.getItem('scheduledReminders'));
    expect(scheduled['meeting-1'].urgentStartedAt).toBe(item.urgentStartedAt);
    expect(document.title).toMatch(/^\ud83d\udd34 1 urgent appointment/);
    expect(document.title).not.toContain('ALERT');
  });

  test('a new appointment keeps unseen and unstarted state when it is sent to the service worker', async () => {
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();

    api.scheduleReminder({
      id: 'fresh-appointment',
      title: 'Fresh appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      urgentAcknowledgedAt: null,
      urgentStartedAt: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const scheduled = JSON.parse(localStorage.getItem('scheduledReminders'));
    expect(scheduled['fresh-appointment'].urgentAcknowledgedAt).toBeNull();
    expect(scheduled['fresh-appointment'].urgentStartedAt).toBeNull();

    const scheduledMessages = postToWorker.mock.calls
      .map(([message]) => message)
      .filter((message) => message?.type === 'memoryCue:updateScheduledReminders');
    const serviceWorkerReminder = scheduledMessages
      .flatMap((message) => message.reminders || [])
      .find((reminder) => reminder.id === 'fresh-appointment');
    expect(serviceWorkerReminder).toEqual(expect.objectContaining({
      urgentAcknowledgedAt: null,
      urgentStartedAt: null,
    }));
  });

  test('phone Done waits for the Firestore save before acknowledging the action', async () => {
    const saveDeferred = createDeferred();
    saveReminder.mockImplementationOnce(() => saveDeferred.promise);
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'phone-done-1',
      title: 'Phone action appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);

    const actionPromise = api.handleUrgentAction('done', 'phone-done-1', 't-15', {
      actionId: 'urgent-action-done-1',
      actionCreatedAt: Date.now(),
    });
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'Done save did not start');

    expect(api.__testing.getItems()[0].done).toBe(true);
    expect(postToWorker.mock.calls.some(([message]) => (
      message?.type === 'memoryCue:urgentActionCompleted'
    ))).toBe(false);
    expect(saveReminder.mock.calls[0][1]).toEqual(expect.objectContaining({
      id: 'phone-done-1',
      done: true,
      completed: true,
    }));

    saveDeferred.resolve(true);
    await expect(actionPromise).resolves.toBe(true);

    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-done-1',
    }));

    await api.handleUrgentAction('done', 'phone-done-1', 't-15', {
      actionId: 'urgent-action-done-1',
      actionCreatedAt: Date.now(),
    });
    expect(saveReminder).toHaveBeenCalledTimes(1);
  });

  test('does not apply a queued phone action while a different account is signed in', async () => {
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'other-account-reminder',
      title: 'Reminder from another account',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);

    await expect(api.handleUrgentAction('done', 'other-account-reminder', 't-15', {
      actionId: 'urgent-action-other-account',
      actionCreatedAt: Date.now(),
      ownerUserId: 'different-user',
      requireRemotePersistence: true,
    })).resolves.toBe(false);

    expect(saveReminder).not.toHaveBeenCalled();
    expect(api.__testing.getItems()[0].done).toBe(false);
    expect(postToWorker).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-other-account',
    }));
  });

  test('discards a durable action when its reminder is already absent after matching-account hydration', async () => {
    await expect(api.handleUrgentAction('done', 'already-removed-reminder', 'due', {
      actionId: 'urgent-action-already-removed',
      actionCreatedAt: Date.now(),
      ownerUserId: 'urgent-test-user',
      requireRemotePersistence: true,
    })).resolves.toBe(true);

    expect(saveReminder).not.toHaveBeenCalled();
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-already-removed',
    }));
  });

  test('acknowledges an old queued action without overwriting a newer reminder edit', async () => {
    const reminderUpdatedAt = Date.now() - 5000;
    const actionCreatedAt = reminderUpdatedAt + 2000;
    api.__testing.setItems([{
      id: 'newer-reopened-reminder',
      title: 'Reopened after the old notification',
      due: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      userId: 'urgent-test-user',
      updatedAt: reminderUpdatedAt + 1000,
    }]);

    await expect(api.handleUrgentAction('done', 'newer-reopened-reminder', 't-15', {
      actionId: 'stale-action-after-reopen',
      actionCreatedAt,
      reminderUpdatedAt,
      ownerUserId: 'urgent-test-user',
      requireRemotePersistence: true,
    })).resolves.toBe(true);

    expect(api.__testing.getItems()[0].done).toBe(false);
    expect(saveReminder).not.toHaveBeenCalled();
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'stale-action-after-reopen',
    }));
  });

  test('accepts the newer server reminder and retires a Done action rejected by the transaction', async () => {
    const reminderUpdatedAt = Date.now() - 2000;
    const newerRemoteUpdatedAt = reminderUpdatedAt + 1000;
    saveReminder.mockResolvedValueOnce({
      saved: false,
      reason: 'newer-remote-version',
      remoteStateKnown: true,
      remoteReminder: {
        id: 'transaction-conflict-done',
        title: 'Edited on another device',
        due: new Date(Date.now() + (20 * 60 * 1000)).toISOString(),
        urgentAlert: true,
        hasExplicitTime: true,
        done: false,
        userId: 'urgent-test-user',
        updatedAt: newerRemoteUpdatedAt,
      },
    });
    api.__testing.setItems([{
      id: 'transaction-conflict-done',
      title: 'Old notification title',
      due: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      userId: 'urgent-test-user',
      updatedAt: reminderUpdatedAt,
    }]);

    await expect(api.handleUrgentAction('done', 'transaction-conflict-done', 't-15', {
      actionId: 'transaction-conflict-action',
      actionCreatedAt: Date.now(),
      reminderUpdatedAt,
      ownerUserId: 'urgent-test-user',
      requireRemotePersistence: true,
    })).resolves.toBe(true);

    expect(api.__testing.getItems()).toEqual([
      expect.objectContaining({
        id: 'transaction-conflict-done',
        title: 'Edited on another device',
        done: false,
        pendingSync: false,
        updatedAt: newerRemoteUpdatedAt,
      }),
    ]);
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'transaction-conflict-action',
    }));
  });

  test('requests pending phone actions again when connectivity returns', async () => {
    postToWorker.mockClear();

    window.dispatchEvent(new Event('online'));

    await flushUntil(
      () => postToWorker.mock.calls.length > 0,
      'Pending actions were not requested after coming online'
    );

    expect(postToWorker).toHaveBeenCalledWith({
      type: 'memoryCue:requestPendingUrgentActions',
      ownerUserId: 'urgent-test-user',
    });
  });

  test('a cold-start Done URL is locked before reminder updates can replay it', async () => {
    const saveDeferred = createDeferred();
    saveReminder.mockImplementationOnce(() => saveDeferred.promise);
    const actionCreatedAt = Date.now();
    const due = new Date(actionCreatedAt + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'url-done-1',
      title: 'Cold-start phone action',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);
    window.history.replaceState({}, '', `/mobile.html?reminderId=url-done-1&urgentAction=done&urgentStage=t-15&urgentActionId=urgent-action-url-done-1&urgentActionCreatedAt=${actionCreatedAt}#reminders`);

    document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated'));
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'URL Done save did not start');

    expect(saveReminder).toHaveBeenCalledTimes(1);
    expect(api.__testing.getItems()[0].done).toBe(true);
    expect(window.location.search).toContain('urgentAction=done');

    document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated'));
    await Promise.resolve();
    expect(saveReminder).toHaveBeenCalledTimes(1);

    saveDeferred.resolve(true);
    await flushUntil(
      () => !window.location.search.includes('urgentAction=done'),
      'Completed URL action was not removed'
    );

    expect(saveReminder).toHaveBeenCalledTimes(1);
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-url-done-1',
    }));
  });

  test('a legacy action URL without an action id is also locked against recursion', async () => {
    const saveDeferred = createDeferred();
    saveReminder.mockImplementationOnce(() => saveDeferred.promise);
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'legacy-url-done-1',
      title: 'Older phone notification action',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);
    window.history.replaceState({}, '', '/mobile.html?reminderId=legacy-url-done-1&urgentAction=done&urgentStage=t-15#reminders');

    document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated'));
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'Legacy URL Done save did not start');

    expect(saveReminder).toHaveBeenCalledTimes(1);
    expect(window.location.search).toContain('urgentAction=done');

    saveDeferred.resolve(true);
    await flushUntil(
      () => !window.location.search.includes('urgentAction=done'),
      'Completed legacy URL action was not removed'
    );

    expect(saveReminder).toHaveBeenCalledTimes(1);
    expect(api.__testing.getItems()[0].done).toBe(true);
  });

  test('a slow URL action never restores an older route after the user navigates elsewhere', async () => {
    const saveDeferred = createDeferred();
    saveReminder.mockImplementationOnce(() => saveDeferred.promise);
    const actionCreatedAt = Date.now();
    api.__testing.setItems([{
      id: 'url-navigation-done-1',
      title: 'Slow phone action',
      due: new Date(actionCreatedAt + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);
    window.history.replaceState({}, '', `/mobile.html?reminderId=url-navigation-done-1&urgentAction=done&urgentStage=t-15&urgentActionId=urgent-action-navigation-done-1&urgentActionCreatedAt=${actionCreatedAt}#reminders`);

    document.dispatchEvent(new CustomEvent('memoryCue:remindersUpdated'));
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'Navigation test save did not start');

    window.history.replaceState({}, '', '/mobile.html?view=notes#notebooks');
    saveDeferred.resolve(true);
    await flushUntil(
      () => postToWorker.mock.calls.some(([message]) => (
        message?.type === 'memoryCue:urgentActionCompleted'
        && message?.actionId === 'urgent-action-navigation-done-1'
      )),
      'Navigation test action was not acknowledged'
    );

    expect(window.location.pathname).toBe('/mobile.html');
    expect(window.location.search).toBe('?view=notes');
    expect(window.location.hash).toBe('#notebooks');
  });

  test('serializes Seen before Done so reverse network completion cannot reactivate the reminder', async () => {
    const saves = [];
    saveReminder.mockImplementation((_userId, payload) => {
      const deferred = createDeferred();
      saves.push({ deferred, payload });
      return deferred.promise;
    });
    const reminderUpdatedAt = Date.now() - 1000;
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'seen-then-done-1',
      title: 'Seen then Done appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      userId: 'urgent-test-user',
      updatedAt: reminderUpdatedAt,
    }]);

    const seenPromise = api.handleUrgentAction('acknowledge', 'seen-then-done-1', 't-15', {
      actionId: 'urgent-action-seen-1',
      actionCreatedAt: Date.now(),
      ownerUserId: 'urgent-test-user',
      reminderUpdatedAt,
    });
    await flushUntil(() => saves.length === 1, 'Seen save did not start');

    const donePromise = api.handleUrgentAction('done', 'seen-then-done-1', 't-15', {
      actionId: 'urgent-action-done-2',
      actionCreatedAt: Date.now() + 1,
      ownerUserId: 'urgent-test-user',
      reminderUpdatedAt: api.__testing.getItems()[0].updatedAt,
    });
    await Promise.resolve();

    expect(saves).toHaveLength(1);
    expect(saves[0].payload.done).toBe(false);

    saves[0].deferred.resolve(true);
    await flushUntil(() => saves.length === 2, 'Done save did not follow Seen');
    expect(saves[1].payload).toEqual(expect.objectContaining({
      id: 'seen-then-done-1',
      done: true,
      completed: true,
    }));

    saves[1].deferred.resolve(true);
    await expect(Promise.all([seenPromise, donePromise])).resolves.toEqual([true, true]);
    expect(saves.map(({ payload }) => payload.done)).toEqual([false, true]);
    expect(api.__testing.getItems()[0].done).toBe(true);
  });

  test('replayed Start opens its meeting only once when the first Firestore save fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    saveReminder
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(true);
    const openMeeting = jest.spyOn(window, 'open').mockImplementation(() => null);
    const actionCreatedAt = Date.now();
    const reminderUpdatedAt = actionCreatedAt - 1000;
    api.__testing.setItems([{
      id: 'retry-start-1',
      title: 'Retry meeting',
      notes: 'Join https://meet.example.test/retry',
      due: new Date(actionCreatedAt + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      userId: 'urgent-test-user',
      updatedAt: reminderUpdatedAt,
    }]);
    const actionOptions = {
      actionId: 'urgent-action-retry-start-1',
      actionCreatedAt,
      ownerUserId: 'urgent-test-user',
      reminderUpdatedAt,
      requireRemotePersistence: true,
    };

    await expect(api.handleUrgentAction('start', 'retry-start-1', 't-15', actionOptions))
      .resolves.toBe(false);
    await expect(api.handleUrgentAction('start', 'retry-start-1', 't-15', actionOptions))
      .resolves.toBe(true);

    expect(openMeeting).toHaveBeenCalledTimes(1);
    expect(saveReminder).toHaveBeenCalledTimes(2);
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-retry-start-1',
    }));
  });

  test('does not let an unresolved Seen push fan-out block the Done save or acknowledgement', async () => {
    const firstPush = createDeferred();
    syncReminderToOtherDevices
      .mockImplementationOnce(() => firstPush.promise)
      .mockResolvedValue({ sent: 0 });
    const reminderUpdatedAt = Date.now() - 1000;
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'push-independent-done-1',
      title: 'Push independent appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      userId: 'urgent-test-user',
      updatedAt: reminderUpdatedAt,
    }]);

    const seenPromise = api.handleUrgentAction('acknowledge', 'push-independent-done-1', 't-15', {
      actionId: 'urgent-action-push-seen-1',
      actionCreatedAt: Date.now(),
      ownerUserId: 'urgent-test-user',
      reminderUpdatedAt,
    });
    await flushUntil(
      () => syncReminderToOtherDevices.mock.calls.length === 1,
      'Seen push fan-out did not start'
    );

    const donePromise = api.handleUrgentAction('done', 'push-independent-done-1', 't-15', {
      actionId: 'urgent-action-push-done-1',
      actionCreatedAt: Date.now() + 1,
      ownerUserId: 'urgent-test-user',
      reminderUpdatedAt: api.__testing.getItems()[0].updatedAt,
    });
    await flushUntil(() => saveReminder.mock.calls.length === 2, 'Done Firestore save stayed behind Seen push');

    await expect(Promise.all([seenPromise, donePromise])).resolves.toEqual([true, true]);
    expect(saveReminder.mock.calls.map(([, payload]) => payload.done)).toEqual([false, true]);
    expect(postToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentActionCompleted',
      actionId: 'urgent-action-push-done-1',
    }));

    firstPush.resolve({ sent: 0 });
  });

  test('queues remote deletion behind an in-flight reminder save', async () => {
    const saveDeferred = createDeferred();
    saveReminder.mockImplementationOnce(() => saveDeferred.promise);
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'save-then-delete-1',
      title: 'Delete after pending save',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);

    const seenPromise = api.handleUrgentAction('acknowledge', 'save-then-delete-1', 't-15', {
      actionId: 'urgent-action-before-delete-1',
      actionCreatedAt: Date.now(),
    });
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'Save before delete did not start');

    const deletePromise = api.undoCapturedReminder('save-then-delete-1');
    await Promise.resolve();
    expect(removeReminder).not.toHaveBeenCalled();

    saveDeferred.resolve(true);
    await flushUntil(() => removeReminder.mock.calls.length === 1, 'Delete did not follow the save');
    await expect(Promise.all([seenPromise, deletePromise])).resolves.toEqual([true, true]);
    expect(removeReminder).toHaveBeenCalledWith(
      'urgent-test-user',
      'save-then-delete-1',
      expect.objectContaining({ maxUpdatedAt: expect.any(Number) })
    );
    expect(api.__testing.getItems()).toHaveLength(0);
  });

  test('does not restore or offer Undo for account A after its delete finishes under account B', async () => {
    const deleteDeferred = createDeferred();
    removeReminder.mockImplementationOnce(() => deleteDeferred.promise);
    api.__testing.setItems([{
      id: 'account-switch-delete-1',
      title: 'Account A reminder',
      due: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      done: false,
    }]);

    const deletePromise = api.__testing.removeItem('account-switch-delete-1');
    await flushUntil(() => removeReminder.mock.calls.length === 1, 'Account A delete did not start');
    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });

    deleteDeferred.resolve(true);
    await expect(deletePromise).resolves.toBe(true);

    expect(api.__testing.getItems().some(({ id }) => id === 'account-switch-delete-1')).toBe(false);
    expect(document.querySelector('#status .status-undo')).toBeNull();
    expect(document.getElementById('status').textContent).not.toContain('Reminder deleted.');
  });

  test('keeps a failed account A delete in its owner-scoped delete outbox under account B', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const deleteDeferred = createDeferred();
    removeReminder.mockImplementationOnce(() => deleteDeferred.promise);
    api.__testing.setItems([{
      id: 'account-switch-delete-failure-1',
      title: 'Account A pending delete',
      due: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      done: false,
    }]);

    const deletePromise = api.__testing.removeItem('account-switch-delete-failure-1');
    await flushUntil(() => removeReminder.mock.calls.length === 1, 'Account A delete did not start');
    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });

    deleteDeferred.reject(new Error('Account A delete failed'));
    await expect(deletePromise).resolves.toBe(true);

    expect(api.__testing.getItems().some(({ id }) => id === 'account-switch-delete-failure-1')).toBe(false);
    expect(document.querySelector('#status .status-undo')).toBeNull();
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toEqual([
      expect.objectContaining({
        type: 'delete',
        id: 'account-switch-delete-failure-1',
        userId: 'urgent-test-user',
      }),
    ]);
    expect(localStorage.getItem('memoryCue:quarantinedPendingReminders')).toBeNull();
  });

  test('does not restore an account A completed reminder when clear finishes under account B', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const deleteDeferred = createDeferred();
    removeReminder.mockImplementationOnce(() => deleteDeferred.promise);
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    api.__testing.setItems([{
      id: 'account-switch-clear-1',
      title: 'Completed account A reminder',
      due: new Date(Date.now() - (60 * 60 * 1000)).toISOString(),
      done: true,
      completed: true,
    }]);

    const clearPromise = api.__testing.clearCompletedReminders();
    await flushUntil(() => removeReminder.mock.calls.length === 1, 'Clear completed delete did not start');
    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });

    deleteDeferred.reject(new Error('Account A clear failed'));
    await expect(clearPromise).resolves.toBeUndefined();

    expect(api.__testing.getItems().some(({ id }) => id === 'account-switch-clear-1')).toBe(false);
    expect(document.querySelector('#status .status-undo')).toBeNull();
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toEqual([
      expect.objectContaining({
        type: 'delete',
        id: 'account-switch-clear-1',
        userId: 'urgent-test-user',
      }),
    ]);
    expect(localStorage.getItem('memoryCue:quarantinedPendingReminders')).toBeNull();
  });

  test('queues a signed-out cloud reminder deletion without reporting a remote delete', async () => {
    await changeAuthSession(null);
    removeReminder.mockClear();
    api.__testing.setItems([{
      id: 'signed-out-delete-1',
      title: 'Cached account A reminder',
      userId: 'urgent-test-user',
      due: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      done: false,
    }]);
    api.__testing.persistItems();

    await expect(api.__testing.removeItem('signed-out-delete-1')).resolves.toBe(true);

    expect(removeReminder).not.toHaveBeenCalled();
    expect(api.__testing.getItems()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toEqual([
      expect.objectContaining({
        type: 'delete',
        id: 'signed-out-delete-1',
        userId: 'urgent-test-user',
        updatedAt: expect.any(Number),
      }),
    ]);
    expect(document.getElementById('status').textContent).toContain('Cloud deletion queued');

    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });
    expect(removeReminder).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))[0].userId)
      .toBe('urgent-test-user');
  });

  test('clear completed queues signed-out cloud deletes and never sends them through account B', async () => {
    await changeAuthSession(null);
    removeReminder.mockClear();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    api.__testing.setItems([
      {
        id: 'signed-out-clear-1',
        title: 'Completed account A reminder one',
        userId: 'urgent-test-user',
        done: true,
        completed: true,
      },
      {
        id: 'signed-out-clear-2',
        title: 'Completed account A reminder two',
        userId: 'urgent-test-user',
        done: true,
        completed: true,
      },
    ]);
    api.__testing.persistItems();

    await api.__testing.clearCompletedReminders();

    expect(removeReminder).not.toHaveBeenCalled();
    expect(api.__testing.getItems()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'signed-out-clear-1', userId: 'urgent-test-user' }),
        expect.objectContaining({ id: 'signed-out-clear-2', userId: 'urgent-test-user' }),
      ])
    );

    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });
    expect(removeReminder).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toHaveLength(2);
  });

  test('keeps a cloud reminder visible when the delete outbox cannot be persisted', async () => {
    const consoleWarning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storagePrototype = Object.getPrototypeOf(localStorage);
    const originalSetItem = storagePrototype.setItem;
    jest.spyOn(storagePrototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (key === 'memoryCue:pendingReminderDeletions') {
        throw new Error('Storage full');
      }
      return originalSetItem.call(this, key, value);
    });
    api.__testing.setItems([{
      id: 'delete-storage-failure-1',
      title: 'Keep me if delete cannot be queued',
      userId: 'urgent-test-user',
      done: false,
    }]);

    await expect(api.__testing.removeItem('delete-storage-failure-1')).resolves.toBe(false);

    expect(removeReminder).not.toHaveBeenCalled();
    expect(api.__testing.getItems()).toEqual([
      expect.objectContaining({ id: 'delete-storage-failure-1' }),
    ]);
    expect(consoleWarning).toHaveBeenCalledWith(
      'Failed to preserve pending reminder deletions',
      expect.any(Error)
    );
  });

  test('Undo cancels a queued cloud delete before restoring the reminder', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    removeReminder.mockRejectedValueOnce(new Error('offline'));
    api.__testing.setItems([{
      id: 'queued-delete-undo-1',
      title: 'Undo queued deletion',
      userId: 'urgent-test-user',
      done: false,
    }]);

    await expect(api.__testing.removeItem('queued-delete-undo-1')).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem('memoryCue:pendingReminderDeletions'))).toHaveLength(1);

    document.querySelector('#status .status-undo').click();
    await flushUntil(() => saveReminder.mock.calls.length === 1, 'Undo save did not start');

    expect(localStorage.getItem('memoryCue:pendingReminderDeletions')).toBeNull();
    expect(api.__testing.getItems()).toEqual([
      expect.objectContaining({
        id: 'queued-delete-undo-1',
        userId: 'urgent-test-user',
      }),
    ]);
  });

  test('keeps same-session delete Undo working', async () => {
    api.__testing.setItems([{
      id: 'same-session-undo-1',
      title: 'Undo this reminder',
      due: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      done: false,
    }]);

    await expect(api.__testing.removeItem('same-session-undo-1')).resolves.toBe(true);
    const undoButton = document.querySelector('#status .status-undo');
    expect(undoButton).not.toBeNull();

    undoButton.click();

    expect(api.__testing.getItems().some(({ id }) => id === 'same-session-undo-1')).toBe(true);
    expect(document.querySelector('#status .status-undo')).toBeNull();
  });

  test('pushes a fresh deletion timestamp when the removed reminder timestamp is stale', async () => {
    const staleUpdatedAt = 1;
    const deletionStartedAt = Date.now();
    api.__testing.setItems([{
      id: 'fresh-delete-tombstone-1',
      title: 'Stale scheduled reminder',
      due: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      updatedAt: staleUpdatedAt,
      done: false,
    }]);

    await expect(api.__testing.removeItem('fresh-delete-tombstone-1', {
      offerUndo: false,
    })).resolves.toBe(true);

    expect(syncReminderToOtherDevices).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'urgent-test-user',
      action: 'delete',
      reminder: expect.objectContaining({
        id: 'fresh-delete-tombstone-1',
        updatedAt: expect.any(Number),
      }),
    }));
    const pushedReminder = syncReminderToOtherDevices.mock.calls[0][0].reminder;
    expect(pushedReminder.updatedAt).toBeGreaterThan(staleUpdatedAt);
    expect(pushedReminder.updatedAt).toBeGreaterThanOrEqual(deletionStartedAt);
  });

  test('a signed-out cached cloud reminder keeps its owner and queues locally', async () => {
    await changeAuthSession(null);
    saveReminder.mockClear();
    const cachedReminder = {
      id: 'signed-out-cached-1',
      title: 'Cached cloud reminder',
      due: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: true,
      completed: true,
      userId: 'urgent-test-user',
    };

    await expect(api.__testing.saveToFirebase(cachedReminder)).resolves.toBe(true);

    expect(saveReminder).not.toHaveBeenCalled();
    expect(cachedReminder.userId).toBe('urgent-test-user');
    expect(cachedReminder.pendingSync).toBe(true);
  });

  test('refuses to save a cached reminder owned by another signed-in account', async () => {
    await changeAuthSession({ uid: 'different-user', email: 'different@example.test' });
    saveReminder.mockClear();
    const cachedReminder = {
      id: 'other-owner-cached-1',
      title: 'Another account reminder',
      due: new Date(Date.now() + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: true,
      completed: true,
      userId: 'urgent-test-user',
    };

    await expect(api.__testing.saveToFirebase(cachedReminder, {
      expectedUserId: 'urgent-test-user',
    })).resolves.toBe(false);

    expect(saveReminder).not.toHaveBeenCalled();
    expect(cachedReminder.userId).toBe('urgent-test-user');
  });

  test('replayed phone Snooze actions do not extend the snooze twice', async () => {
    const actionCreatedAt = Date.now();
    const due = new Date(actionCreatedAt + (10 * 60 * 1000)).toISOString();
    api.__testing.setItems([{
      id: 'phone-snooze-1',
      title: 'Phone snooze appointment',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
    }]);
    const actionOptions = {
      actionId: 'urgent-action-snooze-1',
      actionCreatedAt,
    };

    await Promise.all([
      api.handleUrgentAction('snooze5', 'phone-snooze-1', 't-15', actionOptions),
      api.handleUrgentAction('snooze5', 'phone-snooze-1', 't-15', actionOptions),
    ]);

    await api.handleUrgentAction('snooze5', 'phone-snooze-1', 't-15', actionOptions);

    expect(saveReminder).toHaveBeenCalledTimes(1);
  });
});
