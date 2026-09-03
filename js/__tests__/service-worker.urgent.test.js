const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVICE_WORKER_PATH = path.join(__dirname, '..', '..', 'service-worker-v3.js');

function createServiceWorkerHarness({
  windowClients = [],
  openWindowResult = null,
  scope = 'https://memory-cue.test/app/',
  serviceWorkerUrl = new URL('service-worker-v3.js', scope).href,
  activeOwnerKnown = true,
  activeOwnerUserId = '',
} = {}) {
  const listeners = new Map();
  const showNotification = jest.fn().mockResolvedValue(undefined);
  const getNotifications = jest.fn().mockResolvedValue([]);
  const setAppBadge = jest.fn().mockResolvedValue(undefined);
  const clearAppBadge = jest.fn().mockResolvedValue(undefined);
  const openWindow = jest.fn().mockResolvedValue(openWindowResult);
  const matchAll = jest.fn().mockResolvedValue(windowClients);
  const skipWaiting = jest.fn().mockResolvedValue(undefined);
  const cache = { put: jest.fn().mockResolvedValue(undefined) };
  const serviceWorkerGlobal = {
    registration: {
      scope,
      showNotification,
      getNotifications,
    },
    navigator: {
      setAppBadge,
      clearAppBadge,
    },
    clients: {
      claim: jest.fn().mockResolvedValue(undefined),
      matchAll,
      openWindow,
    },
    location: new URL(serviceWorkerUrl),
    skipWaiting,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
  };

  const context = vm.createContext({
    self: serviceWorkerGlobal,
    URL,
    console: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    caches: {
      open: jest.fn().mockResolvedValue(cache),
    },
    fetch: jest.fn().mockResolvedValue(null),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(fs.readFileSync(SERVICE_WORKER_PATH, 'utf8'), context, {
    filename: SERVICE_WORKER_PATH,
  });
  vm.runInContext(`
    activeReminderOwnerState = {
      known: ${activeOwnerKnown === true},
      ownerUserId: ${JSON.stringify(activeOwnerUserId)},
      notificationTriggersSupported: false,
    };
  `, context);
  // Most click tests model a healthy installed app. Individual durability tests
  // override this transport to exercise pending or failed IndexedDB writes.
  vm.runInContext(`
    savePendingUrgentAction = async (record) => Boolean(normalizePendingUrgentAction(record));
  `, context);

  const dispatch = async (type, eventInit = {}) => {
    const pending = [];
    const event = {
      ...eventInit,
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    };
    for (const listener of listeners.get(type) || []) {
      listener(event);
    }
    await Promise.all(pending);
    return event;
  };

  return {
    dispatch,
    evaluate(source) {
      return vm.runInContext(source, context);
    },
    showNotification,
    getNotifications,
    setAppBadge,
    clearAppBadge,
    matchAll,
    openWindow,
    skipWaiting,
  };
}

describe('Memory Cue urgent service-worker alerts', () => {
  test('accepts the direct urgent reminder message contract used by the app', async () => {
    const harness = createServiceWorkerHarness();

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:showUrgentReminder',
        reminder: {
          id: 'meeting-7',
          title: 'Team meeting',
          body: 'Open the video call',
          due: '2026-09-03T12:00:00+09:30',
          urlPath: 'mobile.html#reminders',
        },
        stage: {
          key: 't-5',
          label: 'Due in 5 minutes',
          kind: 'upcoming',
          startAt: '2026-09-03T11:55:00+09:30',
        },
        badgeCount: 1,
      },
    });

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Team meeting',
      expect.objectContaining({ requireInteraction: true })
    );
    expect(harness.setAppBadge).toHaveBeenCalledWith(1);
  });

  test('parses nested FCM data and displays a persistent urgent reminder', async () => {
    const harness = createServiceWorkerHarness();
    const reminder = {
      id: 'appointment-42',
      title: 'Dentist appointment',
      body: 'Bring the referral',
      due: '2026-09-03T10:30:00+09:30',
      urlPath: 'mobile.html#reminders',
    };
    const stage = {
      key: 't-15',
      label: 'Due in 15 minutes',
      kind: 'upcoming',
      startAt: '2026-09-03T10:15:00+09:30',
    };

    await harness.dispatch('push', {
      data: {
        json: () => ({
          data: {
            type: 'memoryCue:showUrgentReminder',
            reminder: JSON.stringify(reminder),
            stage: JSON.stringify(stage),
            badgeCount: '2',
          },
        }),
      },
    });

    expect(harness.setAppBadge).toHaveBeenCalledWith(2);
    expect(harness.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = harness.showNotification.mock.calls[0];
    expect(title).toBe('Dentist appointment');
    expect(options).toEqual(expect.objectContaining({
      body: 'Due in 15 minutes — Bring the referral',
      tag: 'memory-cue-urgent-appointment-42',
      renotify: true,
      requireInteraction: true,
      silent: false,
    }));
    expect(options.actions).toEqual([
      { action: 'acknowledge', title: 'Seen' },
      { action: 'snooze5', title: 'Snooze 5' },
      { action: 'start', title: 'Start / Join' },
      { action: 'done', title: 'Done' },
    ]);
    expect(options.data).toEqual(expect.objectContaining({
      type: 'memoryCue:urgentReminder',
      reminderId: 'appointment-42',
      stageKey: 't-15',
      badgeCount: 2,
    }));
  });

  test('carries the reminder version into the notification and durable action', async () => {
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({ windowClients: [client] });
    const reminderUpdatedAt = 1788472000000;

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:showUrgentReminder',
        reminder: {
          id: 'versioned-appointment',
          title: 'Versioned appointment',
          due: '2026-09-03T12:00:00+09:30',
          updatedAt: reminderUpdatedAt,
        },
        stage: { key: 't-5', label: 'Due in 5 minutes' },
        badgeCount: 1,
      },
    });

    const notificationOptions = harness.showNotification.mock.calls[0][1];
    expect(notificationOptions.data.updatedAt).toBe(reminderUpdatedAt);

    await harness.dispatch('notificationclick', {
      action: 'done',
      notification: { close: jest.fn(), data: notificationOptions.data },
    });
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      reminderId: 'versioned-appointment',
      reminderUpdatedAt,
    }));
  });

  test('an older queued action cannot suppress a newer reopened reminder', async () => {
    const harness = createServiceWorkerHarness();
    harness.evaluate(`
      readPendingUrgentActions = async () => [{
        id: 'old-done-action',
        action: 'done',
        reminderId: 'reopened-appointment',
        ownerUserId: '',
        stageKey: 'due',
        reminderUpdatedAt: 100,
        createdAt: 300,
      }];
    `);

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:showUrgentReminder',
        reminder: {
          id: 'reopened-appointment',
          title: 'Reopened appointment',
          due: '2026-09-03T12:00:00+09:30',
          updatedAt: 200,
        },
        stage: { key: 'due', label: 'Due now' },
        badgeCount: 1,
      },
    });

    expect(harness.showNotification).toHaveBeenCalledTimes(1);
  });

  test('does not promote an old notification action above a newer reminder revision', () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'owner-a' });
    const result = JSON.parse(harness.evaluate(`JSON.stringify((() => {
      const action = {
        id: 'stale-done-action',
        action: 'done',
        reminderId: 'edited-elsewhere',
        ownerUserId: 'owner-a',
        reminderUpdatedAt: 100,
        createdAt: 300,
      };
      const locallyApplied = applyPendingUrgentActionIntent({
        id: 'edited-elsewhere',
        ownerUserId: 'owner-a',
        due: '2099-01-01T00:00:00.000Z',
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: 100,
      }, action);
      const merged = buildScheduledReminderSnapshot(
        [locallyApplied],
        [{
          id: 'edited-elsewhere',
          ownerUserId: 'owner-a',
          due: '2099-01-02T00:00:00.000Z',
          urgentAlert: true,
          hasExplicitTime: true,
          updatedAt: 200,
        }],
        [],
        400,
        [action]
      )[0];
      return { locallyApplied, merged };
    })())`));

    expect(result.locallyApplied).toEqual(expect.objectContaining({
      done: true,
      deleted: true,
      updatedAt: 100,
    }));
    expect(result.merged).toEqual(expect.objectContaining({
      done: false,
      deleted: false,
      updatedAt: 200,
      due: '2099-01-02T00:00:00.000Z',
    }));
  });

  test('rejects stale-account urgent pushes and cancellation after the active owner changes', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'user-b' });
    harness.evaluate(`
      ownerGuardUpserts = 0;
      ownerGuardDeletes = 0;
      upsertScheduledReminder = async () => { ownerGuardUpserts += 1; return true; };
      deleteScheduledReminder = async () => { ownerGuardDeletes += 1; return true; };
    `);

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:updateScheduledReminders',
        reminders: [],
        tombstones: [],
        activeOwnerUserId: 'user-b',
      },
    });
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        ownerUserId: 'user-a',
        reminder: {
          id: 'shared-id',
          ownerUserId: 'user-a',
          title: 'Account A private appointment',
          due: '2026-09-03T12:00:00+09:30',
          updatedAt: 300,
        },
      },
    });
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:cancelScheduledReminder',
        reminderId: 'shared-id',
        ownerUserId: 'user-a',
        updatedAt: 400,
      },
    });
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:showUrgentReminder',
        ownerUserId: 'user-a',
        reminder: {
          id: 'private-a',
          ownerUserId: 'user-a',
          title: 'Private A',
          updatedAt: 300,
        },
        stage: { key: 'due', label: 'Due now' },
      },
    });

    expect(harness.evaluate('ownerGuardUpserts')).toBe(0);
    expect(harness.evaluate('ownerGuardDeletes')).toBe(0);
    expect(harness.showNotification).not.toHaveBeenCalled();

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:showUrgentReminder',
        ownerUserId: 'user-b',
        reminder: {
          id: 'private-b',
          ownerUserId: 'user-b',
          title: 'Private B',
          updatedAt: 300,
        },
        stage: { key: 'due', label: 'Due now' },
      },
    });
    expect(harness.showNotification).toHaveBeenCalledTimes(1);
    expect(harness.showNotification.mock.calls[0][1].tag).toContain('user-b');
  });

  test('rechecks the active owner immediately before displaying a claimed urgent stage', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'user-a' });
    const result = await harness.evaluate(`(async () => {
      let ownerChecks = 0;
      let completedClaims = 0;
      let releasedClaims = 0;
      incomingReminderOwnerIsAllowed = async () => {
        ownerChecks += 1;
        return ownerChecks === 1;
      };
      claimUrgentStage = async () => ({ status: 'claimed', token: 'owner-race-token' });
      completeUrgentStageClaim = async () => {
        completedClaims += 1;
        return true;
      };
      releaseUrgentStageClaim = async () => {
        releasedClaims += 1;
        return true;
      };
      const displayed = await showUrgentReminder({
        ownerUserId: 'user-a',
        reminder: {
          id: 'owner-race-reminder',
          ownerUserId: 'user-a',
          title: 'Private appointment',
          due: '2099-01-01T00:00:00.000Z',
          updatedAt: 100,
        },
        stage: { key: 't-15', label: '15 minutes to go' },
      });
      return { displayed, ownerChecks, completedClaims, releasedClaims };
    })()`);

    expect(result).toEqual({
      displayed: false,
      ownerChecks: 2,
      completedClaims: 0,
      releasedClaims: 1,
    });
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  test('sets and clears the app badge only from supplied authoritative counts', async () => {
    const harness = createServiceWorkerHarness();

    await harness.dispatch('message', {
      data: { type: 'memoryCue:updateUrgentBadge', count: 4 },
    });
    await harness.dispatch('message', {
      data: { type: 'memoryCue:updateUrgentBadge', count: 0 },
    });
    await harness.dispatch('message', {
      data: { type: 'memoryCue:updateUrgentBadge' },
    });

    expect(harness.setAppBadge).toHaveBeenCalledTimes(1);
    expect(harness.setAppBadge).toHaveBeenCalledWith(4);
    expect(harness.clearAppBadge).toHaveBeenCalledTimes(1);
  });

  test('rejects a stale-account badge push after the active owner changes', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'user-b' });

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:updateScheduledReminders',
        reminders: [],
        tombstones: [],
        activeOwnerUserId: 'user-b',
      },
    });
    await harness.dispatch('push', {
      data: {
        json: () => ({
          data: {
            type: 'memoryCue:updateUrgentBadge',
            ownerUserId: 'user-a',
            badgeCount: '9',
          },
        }),
      },
    });

    expect(harness.setAppBadge).not.toHaveBeenCalled();

    await harness.dispatch('push', {
      data: {
        json: () => ({
          data: {
            type: 'memoryCue:updateUrgentBadge',
            ownerUserId: 'user-b',
            badgeCount: '3',
          },
        }),
      },
    });

    expect(harness.setAppBadge).toHaveBeenCalledWith(3);
  });

  test('keeps urgent badge state while suppressing alerts after Seen, Start, Snooze, or Done', () => {
    const harness = createServiceWorkerHarness();
    const now = Date.parse('2026-09-03T10:20:00+09:30');
    const due = '2026-09-03T10:30:00+09:30';
    const base = JSON.stringify({
      id: 'appointment-42',
      due,
      urgentAlert: true,
      hasExplicitTime: true,
    });
    const active = harness.evaluate(`getScheduledUrgentState(${base}, ${now})`);
    const seen = harness.evaluate(`getScheduledUrgentState({ ...${base}, urgentAcknowledgedAt: ${now} }, ${now})`);
    const started = harness.evaluate(`getScheduledUrgentState({ ...${base}, urgentStartedAt: ${now} }, ${now})`);
    const snoozed = harness.evaluate(`getScheduledUrgentState({ ...${base}, snoozedUntil: ${JSON.stringify(new Date(now + 300000).toISOString())} }, ${now})`);
    const done = harness.evaluate(`getScheduledUrgentState({ ...${base}, done: true }, ${now})`);

    expect(active.stage.key).toBe('t-15');
    expect(active.shouldBadge).toBe(true);
    expect(active.shouldAlert).toBe(true);
    expect(seen.shouldBadge).toBe(true);
    expect(seen.shouldAlert).toBe(false);
    expect(started.shouldBadge).toBe(true);
    expect(started.shouldAlert).toBe(false);
    expect(snoozed.shouldBadge).toBe(true);
    expect(snoozed.shouldAlert).toBe(false);
    expect(done.shouldBadge).toBe(false);
    expect(done.shouldAlert).toBe(false);
  });

  test('keeps pending phone intent and delete tombstones ahead of stale page snapshots', () => {
    const harness = createServiceWorkerHarness();
    const result = JSON.parse(harness.evaluate(`JSON.stringify((() => {
      const now = 1000000;
      const due = new Date(now + (10 * MINUTE_MS)).toISOString();
      const deleted = buildScheduledReminderSnapshot(
        [{ id: 'done-1', done: true, deleted: true, updatedAt: 200 }],
        [{
          id: 'done-1',
          due,
          urgentAlert: true,
          hasExplicitTime: true,
          updatedAt: 100,
        }],
        [],
        now,
        [{ id: 'action-done-1', action: 'done', reminderId: 'done-1', reminderUpdatedAt: 100, createdAt: 200 }]
      )[0];
      const snoozed = buildScheduledReminderSnapshot(
        [],
        [{
          id: 'snooze-1',
          due,
          urgentAlert: true,
          hasExplicitTime: true,
          updatedAt: 300,
        }],
        [],
        now,
        [{ id: 'action-snooze-1', action: 'snooze5', reminderId: 'snooze-1', reminderUpdatedAt: 300, createdAt: now }]
      )[0];
      const reopened = buildScheduledReminderSnapshot(
        [{ id: 'reopen-1', done: true, deleted: true, updatedAt: 200 }],
        [{
          id: 'reopen-1',
          due,
          urgentAlert: true,
          hasExplicitTime: true,
          done: false,
          updatedAt: 300,
        }],
        [],
        now,
        [{ id: 'action-done-reopen', action: 'done', reminderId: 'reopen-1', reminderUpdatedAt: 200, createdAt: 200 }]
      )[0];
      return {
        deleted,
        snoozed,
        reopened,
        snoozedState: getScheduledUrgentState(snoozed, now),
      };
    })())`));

    expect(result.deleted).toEqual(expect.objectContaining({
      id: 'done-1',
      done: true,
      deleted: true,
      updatedAt: 200,
    }));
    expect(result.snoozed.snoozedUntil).toBe(new Date(1300000).toISOString());
    expect(result.snoozedState.shouldAlert).toBe(false);
    expect(result.reopened).toEqual(expect.objectContaining({
      id: 'reopen-1',
      done: false,
      deleted: false,
      updatedAt: 300,
    }));
  });

  test('does not apply one account pending action to another account same-id reminder', () => {
    const harness = createServiceWorkerHarness();
    const now = Date.now();
    const reminder = {
      id: 'shared-id',
      ownerUserId: 'user-b',
      due: new Date(now + (10 * 60 * 1000)).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      updatedAt: now - 1000,
    };
    const action = {
      id: 'user-a-done',
      action: 'done',
      reminderId: 'shared-id',
      ownerUserId: 'user-a',
      createdAt: now,
    };
    const result = JSON.parse(harness.evaluate(`JSON.stringify({
      reminder: applyPendingUrgentActionIntent(
        ${JSON.stringify(reminder)},
        ${JSON.stringify(action)}
      ),
      suppressed: shouldSuppressUrgentForPendingActions(
        ${JSON.stringify({
          reminderId: reminder.id,
          ownerUserId: reminder.ownerUserId,
          stageKey: 't-15',
          updatedAt: reminder.updatedAt,
        })},
        [${JSON.stringify(action)}],
        ${now}
      ),
    })`));

    expect(result.reminder.done).toBe(false);
    expect(result.reminder.deleted).toBe(false);
    expect(result.suppressed).toBe(false);
  });

  test('does not tombstone another account same-id schedule on direct Done', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      let upserts = 0;
      getReminderDb = async () => ({
        transaction: () => ({
          objectStore: () => ({
            get: () => ({ value: {
              id: 'shared-id',
              ownerUserId: 'user-b',
              updatedAt: 100,
            } }),
          }),
        }),
      });
      idbRequestToPromise = async (request) => request.value;
      waitForTransaction = async () => true;
      upsertScheduledReminder = async () => { upserts += 1; return true; };
      const applied = await applyPendingUrgentActionToSchedule({
        id: 'user-a-done',
        action: 'done',
        reminderId: 'shared-id',
        ownerUserId: 'user-a',
        createdAt: 200,
      });
      return { applied, upserts };
    })()`);

    expect(result).toEqual({ applied: false, upserts: 0 });
  });

  test('a queued Done suppresses scheduled checks while the app is unavailable', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'user-a' });
    const now = Date.now();
    const due = new Date(now + (10 * 60 * 1000)).toISOString();
    const result = await harness.evaluate(`(async () => {
      readScheduledReminders = async () => [{
        id: 'offline-done-1',
        ownerUserId: 'user-a',
        due: ${JSON.stringify(due)},
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: ${now - 1000},
      }];
      readPendingUrgentActions = async () => [{
        id: 'offline-done-action',
        action: 'done',
        reminderId: 'offline-done-1',
        ownerUserId: 'user-a',
        reminderUpdatedAt: ${now - 1000},
        createdAt: ${now},
      }];
      return checkAndNotifyDueReminders({ source: 'test' });
    })()`);

    expect(result).toBe(true);
    expect(harness.showNotification).not.toHaveBeenCalled();
    expect(harness.clearAppBadge).toHaveBeenCalled();
  });

  test('reads pending actions before opening the scheduled-reminder write transaction', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      const calls = [];
      const written = [];
      readPendingUrgentActions = async () => {
        calls.push('pending');
        return [{ id: 'queued-done', action: 'done', reminderId: 'queued-1', reminderUpdatedAt: 100, createdAt: 200 }];
      };
      getReminderDb = async () => ({
        transaction: () => {
          calls.push('transaction');
          return {
            objectStore: () => ({
              getAll: () => ({ value: [] }),
              clear: () => ({ value: true }),
              put: (entry) => {
                written.push(entry);
                return { value: entry };
              },
            }),
          };
        },
      });
      idbRequestToPromise = async (request) => request.value;
      waitForTransaction = async () => true;
      const saved = await writeScheduledReminders([{
        id: 'queued-1',
        due: '2099-01-01T00:00:00.000Z',
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: 100,
      }]);
      return { calls, saved, written };
    })()`);

    expect(result.calls).toEqual(['pending', 'transaction']);
    expect(result.saved).toBe(true);
    expect(result.written[0]).toEqual(expect.objectContaining({
      id: 'queued-1',
      done: true,
      deleted: true,
    }));
  });

  test('does not let an old-owner notification write replace a newly active schedule', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'user-b' });
    const result = await harness.evaluate(`(async () => {
      const operations = [];
      let scheduledClears = 0;
      let scheduledWrites = 0;
      readPendingUrgentActions = async () => [];
      getReminderDb = async () => ({
        transaction: () => ({
          objectStore: (name) => {
            if (name === REMINDER_META_STORE_NAME) {
              return {
                get: () => {
                  operations.push('metadata:get');
                  return { value: {
                    key: ACTIVE_REMINDER_OWNER_META_KEY,
                    ownerUserId: 'user-b',
                  } };
                },
              };
            }
            return {
              getAll: () => {
                operations.push('scheduled:getAll');
                return { value: [{ id: 'user-b-current', ownerUserId: 'user-b' }] };
              },
              clear: () => {
                scheduledClears += 1;
                return { value: true };
              },
              put: () => {
                scheduledWrites += 1;
                return { value: true };
              },
            };
          },
        }),
      });
      idbRequestToPromise = async (request) => request.value;
      waitForTransaction = async () => true;
      const saved = await writeScheduledReminders([{
        id: 'user-a-stale',
        ownerUserId: 'user-a',
        updatedAt: 100,
      }], [], {
        expectedOwnerUserId: 'user-a',
      });
      return { saved, operations, scheduledClears, scheduledWrites };
    })()`);

    expect(result).toEqual({
      saved: false,
      operations: ['metadata:get'],
      scheduledClears: 0,
      scheduledWrites: 0,
    });
  });

  test('preserves a delivered stage across an equal reminder-sync retry', () => {
    const harness = createServiceWorkerHarness();
    const due = '2026-09-03T10:30:00+09:30';
    const existing = JSON.stringify({
      id: 'appointment-42',
      due,
      updatedAt: 1000,
      urgentAlert: true,
      hasExplicitTime: true,
      notifiedAt: 2000,
      lastUrgentStageKey: 't-15',
    });
    const retry = JSON.stringify({
      id: 'appointment-42',
      due,
      updatedAt: 1000,
      urgentAlert: true,
      hasExplicitTime: true,
      notifiedAt: null,
      lastUrgentStageKey: null,
    });
    const rescheduled = JSON.stringify({
      id: 'appointment-42',
      due: '2026-09-03T11:30:00+09:30',
      updatedAt: 3000,
      urgentAlert: true,
      hasExplicitTime: true,
    });

    const mergedRetry = harness.evaluate(
      `mergeScheduledReminderLocalState(${existing}, ${retry})`
    );
    const mergedReschedule = harness.evaluate(
      `mergeScheduledReminderLocalState(${existing}, ${rescheduled})`
    );

    expect(mergedRetry.lastUrgentStageKey).toBe('t-15');
    expect(mergedRetry.notifiedAt).toBe(2000);
    expect(mergedReschedule.lastUrgentStageKey).toBeNull();
  });

  test('shares a stage claim between foreground and scheduled delivery while allowing later stages', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      const due = '2026-09-03T10:30:00.000Z';
      let now = Date.parse('2026-09-03T10:15:00.000Z');
      const originalDateNow = Date.now;
      Date.now = () => now;
      const scheduledReminder = {
        id: 'shared-stage-1',
        title: 'Important appointment',
        body: 'Leave now',
        due,
        urgentAlert: true,
        hasExplicitTime: true,
        lastUrgentStageKey: null,
      };
      const claims = new Map();
      let sequence = 0;
      const stageClaimDependencies = {
        claimStage: async (id) => {
          const current = claims.get(id);
          if (current?.status === 'shown') {
            return { status: 'shown', token: '' };
          }
          const token = 'claim-' + (++sequence);
          claims.set(id, { status: 'pending', token });
          return { status: 'claimed', token };
        },
        completeStage: async (id, token) => {
          const current = claims.get(id);
          if (current?.token !== token) return false;
          claims.set(id, { status: 'shown', token: '' });
          return true;
        },
        releaseStage: async (id, token) => {
          const current = claims.get(id);
          if (current?.token !== token) return false;
          claims.delete(id);
          return true;
        },
      };
      readScheduledReminders = async () => [scheduledReminder];
      writeScheduledReminders = async (reminders) => {
        Object.assign(scheduledReminder, reminders[0]);
        return true;
      };
      try {
        const foregroundResult = await showUrgentReminder({
          reminder: scheduledReminder,
          stage: {
            key: 't-15',
            label: '15 minutes to go',
            kind: 'upcoming',
            startAt: now,
            dueAt: Date.parse(due),
          },
          badgeCount: 1,
        }, stageClaimDependencies);
        const sameStageSyncResult = await checkAndNotifyDueReminders({
          source: 'push-sync',
          stageClaimDependencies,
        });
        now = Date.parse('2026-09-03T10:25:00.000Z');
        const laterStageResult = await checkAndNotifyDueReminders({
          source: 'push-sync',
          stageClaimDependencies,
        });
        return {
          foregroundResult,
          sameStageSyncResult,
          laterStageResult,
          claimCount: claims.size,
          lastUrgentStageKey: scheduledReminder.lastUrgentStageKey,
        };
      } finally {
        Date.now = originalDateNow;
      }
    })()`);

    expect(result).toEqual({
      foregroundResult: true,
      sameStageSyncResult: true,
      laterStageResult: true,
      claimCount: 2,
      lastUrgentStageKey: 't-5',
    });
    expect(harness.showNotification).toHaveBeenCalledTimes(2);
    expect(harness.showNotification.mock.calls.map(([, options]) => options.data.stageKey))
      .toEqual(['t-15', 't-5']);
  });

  test('releases a failed stage claim so the same alert can retry', async () => {
    const harness = createServiceWorkerHarness();
    harness.showNotification
      .mockRejectedValueOnce(new Error('notification display failed'))
      .mockResolvedValueOnce(undefined);

    const result = await harness.evaluate(`(async () => {
      const claims = new Map();
      let released = 0;
      let sequence = 0;
      const stageClaimDependencies = {
        claimStage: async (id) => {
          const current = claims.get(id);
          if (current?.status === 'shown') return { status: 'shown', token: '' };
          const token = 'retry-' + (++sequence);
          claims.set(id, { status: 'pending', token });
          return { status: 'claimed', token };
        },
        completeStage: async (id, token) => {
          const current = claims.get(id);
          if (current?.token !== token) return false;
          claims.set(id, { status: 'shown', token: '' });
          return true;
        },
        releaseStage: async (id, token) => {
          const current = claims.get(id);
          if (current?.token !== token) return false;
          claims.delete(id);
          released += 1;
          return true;
        },
      };
      const payload = {
        reminder: {
          id: 'retry-stage-1',
          title: 'Retry appointment',
          due: '2026-09-03T10:30:00.000Z',
        },
        stage: { key: 'due', label: 'Due now', kind: 'due' },
      };
      const first = await showUrgentReminder(payload, stageClaimDependencies);
      const second = await showUrgentReminder(payload, stageClaimDependencies);
      return { first, second, released, claimCount: claims.size };
    })()`);

    expect(result).toEqual({
      first: false,
      second: true,
      released: 1,
      claimCount: 1,
    });
    expect(harness.showNotification).toHaveBeenCalledTimes(2);
  });

  test('does not mark a surviving pending stage as delivered', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      let displayAttempts = 0;
      const delivered = await runUrgentStageOnce(
        JSON.stringify(['pending-stage-1', '1788402600000', 't-15']),
        async () => {
          displayAttempts += 1;
          return true;
        },
        {
          claimStage: async () => ({ status: 'pending', token: '' }),
          completeStage: async () => true,
          releaseStage: async () => true,
        }
      );
      return { delivered, displayAttempts };
    })()`);

    expect(result).toEqual({ delivered: false, displayAttempts: 0 });
  });

  test('shows a stage-deduped urgent sync directly when its local upsert cannot persist', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'owner-a' });
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    const result = await harness.evaluate(`(async () => {
      readPendingUrgentActions = async () => [];
      upsertScheduledReminder = async () => null;
      const completedClaims = new Set();
      const claimIds = [];
      claimUrgentStage = async (id) => {
        claimIds.push(id);
        return completedClaims.has(id)
          ? { status: 'shown', token: '' }
          : { status: 'claimed', token: 'fallback-token' };
      };
      completeUrgentStageClaim = async (id, token) => {
        if (token !== 'fallback-token') return false;
        completedClaims.add(id);
        return true;
      };
      releaseUrgentStageClaim = async () => true;
      const payload = {
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        ownerUserId: 'owner-a',
        badgeCount: 1,
        reminder: {
          id: 'fallback-urgent',
          ownerUserId: 'owner-a',
          title: 'Fallback appointment',
          body: 'Join the call now',
          due: ${JSON.stringify(due)},
          updatedAt: 200,
          urgentAlert: true,
          hasExplicitTime: true,
        },
      };
      const first = await handleReminderSyncPush(payload);
      const second = await handleReminderSyncPush(payload);
      return {
        first,
        second,
        claimAttempts: claimIds.length,
        completedClaimCount: completedClaims.size,
        claimId: claimIds[0],
      };
    })()`);

    expect(result).toEqual({
      first: true,
      second: true,
      claimAttempts: 2,
      completedClaimCount: 1,
      claimId: JSON.stringify([
        'owner-a',
        'fallback-urgent',
        String(Date.parse(due)),
        't-15',
        200,
      ]),
    });
    expect(harness.showNotification).toHaveBeenCalledTimes(1);
    expect(harness.showNotification).toHaveBeenCalledWith(
      'Fallback appointment',
      expect.objectContaining({
        requireInteraction: true,
        data: expect.objectContaining({
          reminderId: 'fallback-urgent',
          ownerUserId: 'owner-a',
          stageKey: 't-15',
          updatedAt: 200,
        }),
      })
    );
  });

  test('does not directly display failed delete or non-urgent sync persistence', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'owner-a' });
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    const result = await harness.evaluate(`(async () => {
      readPendingUrgentActions = async () => [];
      let upsertCalls = 0;
      let deleteCalls = 0;
      upsertScheduledReminder = async () => { upsertCalls += 1; return null; };
      deleteScheduledReminder = async () => { deleteCalls += 1; return null; };
      const nonUrgent = await handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        ownerUserId: 'owner-a',
        reminder: {
          id: 'ordinary-sync',
          due: ${JSON.stringify(due)},
          updatedAt: 200,
          urgentAlert: false,
          hasExplicitTime: true,
        },
      });
      const deleted = await handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'delete',
        ownerUserId: 'owner-a',
        reminder: {
          id: 'deleted-sync',
          updatedAt: 300,
          urgentAlert: true,
          hasExplicitTime: true,
        },
      });
      return { nonUrgent, deleted, upsertCalls, deleteCalls };
    })()`);

    expect(result).toEqual({
      nonUrgent: false,
      deleted: false,
      upsertCalls: 1,
      deleteCalls: 1,
    });
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  test('closes a remotely deleted urgent notification when schedule storage fails', async () => {
    const harness = createServiceWorkerHarness({ activeOwnerUserId: 'owner-a' });
    const result = await harness.evaluate(`(async () => {
      const closed = [];
      deleteScheduledReminder = async () => null;
      closeUrgentReminderNotifications = async (reminderId, ownerUserId) => {
        closed.push({ reminderId, ownerUserId });
        return true;
      };
      const handled = await handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'delete',
        ownerUserId: 'owner-a',
        reminder: {
          id: 'deleted-while-storage-down',
          ownerUserId: 'owner-a',
          updatedAt: 300,
        },
      });
      return { handled, closed };
    })()`);

    expect(result).toEqual({
      handled: false,
      closed: [{
        reminderId: 'deleted-while-storage-down',
        ownerUserId: 'owner-a',
      }],
    });
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  test('recomputes the badge from accepted local reminders when a sync is stale', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      upsertScheduledReminder = async () => false;
      readScheduledReminders = async () => [
        {
          id: 'accepted-active',
          due: '2020-01-01T00:00:00.000Z',
          urgentAlert: true,
          hasExplicitTime: true,
          done: false,
        },
        {
          id: 'accepted-done',
          due: '2020-01-01T00:00:00.000Z',
          urgentAlert: true,
          hasExplicitTime: true,
          done: true,
        },
      ];
      return handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        badgeCount: 9,
        reminder: {
          id: 'stale-remote-copy',
          due: '2020-01-01T00:00:00.000Z',
          updatedAt: 1000,
          urgentAlert: true,
          hasExplicitTime: true,
        },
      });
    })()`);

    expect(result).toBe(true);
    expect(harness.setAppBadge).toHaveBeenCalledTimes(1);
    expect(harness.setAppBadge).toHaveBeenCalledWith(1);
    expect(harness.setAppBadge).not.toHaveBeenCalledWith(9);
    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  test('keeps an unseen same-stage notification open across an ordinary sync edit', async () => {
    const close = jest.fn();
    const harness = createServiceWorkerHarness();
    harness.getNotifications.mockResolvedValue([{
      tag: 'memory-cue-urgent-active-edit',
      close,
    }]);
    const due = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    const result = await harness.evaluate(`(async () => {
      readPendingUrgentActions = async () => [];
      upsertScheduledReminder = async () => true;
      checkAndNotifyDueReminders = async () => true;
      return handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        reminder: {
          id: 'active-edit',
          title: 'Edited title',
          due: ${JSON.stringify(due)},
          urgentAlert: true,
          hasExplicitTime: true,
          updatedAt: Date.now(),
        },
      });
    })()`);

    expect(result).toBe(true);
    expect(harness.getNotifications).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  test('closes an existing urgent notification after an accepted cross-device Done', async () => {
    const close = jest.fn();
    const harness = createServiceWorkerHarness();
    harness.getNotifications.mockResolvedValue([{
      tag: 'memory-cue-urgent-remote-done',
      close,
    }]);
    const result = await harness.evaluate(`(async () => {
      readPendingUrgentActions = async () => [];
      upsertScheduledReminder = async () => true;
      checkAndNotifyDueReminders = async () => true;
      return handleReminderSyncPush({
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        reminder: {
          id: 'remote-done',
          done: true,
          completed: true,
          updatedAt: Date.now(),
        },
      });
    })()`);

    expect(result).toBe(true);
    expect(harness.getNotifications).toHaveBeenCalledWith({
      tag: 'memory-cue-urgent-remote-done',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('closes on an accepted local cancel but not when a newer schedule wins', async () => {
    const close = jest.fn();
    const harness = createServiceWorkerHarness();
    harness.getNotifications.mockResolvedValue([{
      tag: 'memory-cue-urgent-cancel-1',
      close,
    }]);
    harness.evaluate(`
      cancelAccepted = true;
      deleteScheduledReminder = async () => cancelAccepted;
      recomputeScheduledUrgentBadge = async () => true;
    `);

    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:cancelScheduledReminder',
        reminderId: 'cancel-1',
        updatedAt: 200,
      },
    });
    expect(close).toHaveBeenCalledTimes(1);

    close.mockClear();
    harness.getNotifications.mockClear();
    harness.evaluate('cancelAccepted = false');
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:cancelScheduledReminder',
        reminderId: 'cancel-1',
        updatedAt: 100,
      },
    });
    expect(harness.getNotifications).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  test('routes a notification action to clients and an exact reminder URL', async () => {
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const duplicateClient = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({ windowClients: [client, duplicateClient] });
    const close = jest.fn();

    await harness.dispatch('notificationclick', {
      action: 'snooze5',
      notification: {
        close,
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 't-15',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action: 'snooze5',
      reminderId: 'appointment-42',
      stageKey: 't-15',
      meetingAlreadyOpened: false,
    }));
    expect(duplicateClient.postMessage).not.toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.navigate).not.toHaveBeenCalled();
    expect(harness.setAppBadge).not.toHaveBeenCalled();
    expect(harness.clearAppBadge).not.toHaveBeenCalled();
  });

  test('closes a tapped urgent notification synchronously while persistence is still pending', async () => {
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({
      windowClients: [client],
      activeOwnerUserId: 'urgent-test-user',
    });
    const close = jest.fn();
    harness.evaluate(`
      actionSaveStarted = false;
      releaseActionSave = null;
      actionSaveGate = new Promise((resolve) => {
        releaseActionSave = resolve;
      });
      savePendingUrgentAction = async () => {
        actionSaveStarted = true;
        await actionSaveGate;
        return true;
      };
    `);

    const clickPromise = harness.dispatch('notificationclick', {
      action: 'done',
      notification: {
        close,
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-close-first',
          ownerUserId: 'urgent-test-user',
          updatedAt: 100,
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(close).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.evaluate('actionSaveStarted')).toBe(true);
    expect(client.focus).not.toHaveBeenCalled();

    harness.evaluate('releaseActionSave()');
    await clickPromise;
    expect(client.focus).toHaveBeenCalledTimes(1);
  });

  test('keeps the badge and schedule intact when a notification action cannot be persisted', async () => {
    const harness = createServiceWorkerHarness();
    const close = jest.fn();
    harness.openWindow.mockRejectedValue(new Error('App open blocked'));
    harness.evaluate(`
      failedActionScheduleApplications = 0;
      failedActionNotificationCloses = 0;
      failedActionBadgeChanges = 0;
      savePendingUrgentAction = async () => false;
      applyPendingUrgentActionToSchedule = async () => {
        failedActionScheduleApplications += 1;
        return true;
      };
      closeUrgentReminderNotifications = async () => {
        failedActionNotificationCloses += 1;
        return true;
      };
      applyUrgentBadge = async () => {
        failedActionBadgeChanges += 1;
        return true;
      };
      recomputeScheduledUrgentBadge = async () => {
        failedActionBadgeChanges += 1;
        return true;
      };
    `);

    await harness.dispatch('notificationclick', {
      action: 'done',
      notification: {
        close,
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'failed-persistence',
          stageKey: 'due',
          badgeCount: 1,
          updatedAt: 100,
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.openWindow).toHaveBeenCalledTimes(1);
    expect(new URL(harness.openWindow.mock.calls[0][0]).searchParams.get('urgentAction')).toBe('done');
    expect(harness.evaluate('failedActionScheduleApplications')).toBe(0);
    expect(harness.evaluate('failedActionNotificationCloses')).toBe(0);
    expect(harness.evaluate('failedActionBadgeChanges')).toBe(0);
  });

  test('persists a Done action until the page requests and completes that exact action', async () => {
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({
      windowClients: [client],
      activeOwnerUserId: 'urgent-test-user',
    });
    harness.evaluate(`
      durableTestActions = [];
      appliedTestActions = [];
      savePendingUrgentAction = async (record) => {
        const normalized = normalizePendingUrgentAction(record);
        if (!normalized) return false;
        durableTestActions = durableTestActions.filter(({ id }) => id !== normalized.id);
        durableTestActions.push(normalized);
        return true;
      };
      readPendingUrgentActions = async () => durableTestActions.map((record) => ({ ...record }));
      deletePendingUrgentAction = async (actionId) => {
        const previousLength = durableTestActions.length;
        durableTestActions = durableTestActions.filter(({ id }) => id !== actionId);
        return durableTestActions.length !== previousLength;
      };
      applyPendingUrgentActionToSchedule = async (record) => {
        appliedTestActions.push(normalizePendingUrgentAction(record));
        return true;
      };
    `);

    await harness.dispatch('notificationclick', {
      action: 'done',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-done-42',
          ownerUserId: 'urgent-test-user',
          updatedAt: 100,
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    const deliveredAction = client.postMessage.mock.calls[0][0];
    expect(deliveredAction).toEqual(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action: 'done',
      reminderId: 'appointment-done-42',
      ownerUserId: 'urgent-test-user',
      stageKey: 'due',
      meetingAlreadyOpened: false,
      actionId: expect.stringMatching(/^urgent-action-/),
      actionCreatedAt: expect.any(Number),
    }));
    expect(JSON.parse(harness.evaluate('JSON.stringify(durableTestActions)'))).toEqual([
      expect.objectContaining({
        id: deliveredAction.actionId,
        action: 'done',
        reminderId: 'appointment-done-42',
        ownerUserId: 'urgent-test-user',
        createdAt: deliveredAction.actionCreatedAt,
      }),
    ]);
    expect(JSON.parse(harness.evaluate('JSON.stringify(appliedTestActions)'))).toEqual([
      expect.objectContaining({
        id: deliveredAction.actionId,
        action: 'done',
        reminderId: 'appointment-done-42',
      }),
    ]);

    client.postMessage.mockClear();
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:requestPendingUrgentActions',
        ownerUserId: 'urgent-test-user',
      },
      source: client,
    });
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      actionId: deliveredAction.actionId,
      actionCreatedAt: deliveredAction.actionCreatedAt,
      action: 'done',
      reminderId: 'appointment-done-42',
    }));

    harness.evaluate(`durableTestActions.push({
      id: 'urgent-action-still-pending',
      action: 'acknowledge',
      reminderId: 'another-appointment',
      ownerUserId: 'urgent-test-user',
      stageKey: 't-5',
      meetingAlreadyOpened: false,
      createdAt: 1234,
    })`);
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:urgentActionCompleted',
        actionId: deliveredAction.actionId,
        ownerUserId: 'urgent-test-user',
      },
      source: client,
    });

    client.postMessage.mockClear();
    await harness.dispatch('message', {
      data: {
        type: 'memoryCue:requestPendingUrgentActions',
        ownerUserId: 'urgent-test-user',
      },
      source: client,
    });
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'urgent-action-still-pending',
      reminderId: 'another-appointment',
    }));
  });

  test('drops expired pending actions without silently discarding recent actions', () => {
    const harness = createServiceWorkerHarness();
    const now = 40 * 24 * 60 * 60 * 1000;
    const retained = JSON.parse(harness.evaluate(`JSON.stringify(selectRetainedPendingUrgentActions([
      {
        id: 'expired-action',
        action: 'done',
        reminderId: 'expired-reminder',
        createdAt: ${now} - PENDING_URGENT_ACTION_RETENTION_MS,
      },
      ...Array.from({ length: PENDING_URGENT_ACTION_LIMIT + 3 }, (_, index) => ({
        id: 'recent-action-' + index,
        action: 'acknowledge',
        reminderId: 'reminder-' + index,
        createdAt: ${now} - 1000 + index,
      })),
    ], ${now}))`));

    expect(retained).toHaveLength(259);
    expect(retained.some(({ id }) => id === 'expired-action')).toBe(false);
    expect(retained[0].id).toBe('recent-action-0');
    expect(retained[retained.length - 1].id).toBe('recent-action-258');
  });

  test.each([
    ['acknowledge'],
    ['snooze5'],
  ])('reuses the installed root app for the %s notification action', async (action) => {
    const client = {
      url: 'https://memory-cue.pages.dev/',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({
      windowClients: [client],
      scope: 'https://memory-cue.pages.dev/',
    });

    await harness.dispatch('notificationclick', {
      action,
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 't-15',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action,
      reminderId: 'appointment-42',
      stageKey: 't-15',
    }));
    expect(client.navigate).not.toHaveBeenCalled();
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  test('does not open a duplicate when focusing the existing app is rejected', async () => {
    const client = {
      url: 'https://memory-cue.test/app/',
      postMessage: jest.fn(),
      focus: jest.fn().mockRejectedValue(new Error('Focus unavailable')),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({ windowClients: [client] });

    await harness.dispatch('notificationclick', {
      action: 'snooze5',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 't-15',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action: 'snooze5',
      reminderId: 'appointment-42',
    }));
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  test('reuses the desktop entry when a notification targets the mobile entry', async () => {
    const client = {
      url: 'https://memory-cue.test/app/index.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({ windowClients: [client] });

    await harness.dispatch('notificationclick', {
      action: 'acknowledge',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'acknowledge',
      reminderId: 'appointment-42',
    }));
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  test('opens only a cross-origin meeting when the app is closed so it stays in front', async () => {
    const harness = createServiceWorkerHarness({ openWindowResult: {} });
    const meetingUrl = 'https://meet.example.test/appointment-42';

    await harness.dispatch('notificationclick', {
      action: 'start',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
          meetingUrl,
        },
      },
    });

    expect(harness.openWindow).toHaveBeenCalledTimes(1);
    expect(harness.openWindow).toHaveBeenCalledWith(meetingUrl);
  });

  test('bootstraps the closed app and refocuses a controllable meeting client', async () => {
    const meetingUrl = 'https://memory-cue.test/app/meeting-room';
    const meetingClient = { focus: jest.fn().mockResolvedValue(undefined) };
    const harness = createServiceWorkerHarness();
    harness.openWindow.mockImplementation(async (url) => (
      url === meetingUrl ? meetingClient : {}
    ));

    await harness.dispatch('notificationclick', {
      action: 'start',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
          meetingUrl,
        },
      },
    });

    expect(harness.openWindow).toHaveBeenCalledTimes(2);
    expect(harness.openWindow.mock.calls[0][0]).toBe(meetingUrl);
    const destination = new URL(harness.openWindow.mock.calls[1][0]);
    expect(destination.pathname).toBe('/app/mobile.html');
    expect(destination.searchParams.get('urgentAction')).toBe('start');
    expect(destination.searchParams.get('urgentActionId')).toMatch(/^urgent-action-/);
    expect(destination.searchParams.get('meetingOpened')).toBe('1');
    expect(meetingClient.focus).toHaveBeenCalledTimes(1);
    expect(harness.openWindow.mock.invocationCallOrder[1])
      .toBeLessThan(meetingClient.focus.mock.invocationCallOrder[0]);
  });

  test('lets the reopened app handle Start when the service worker cannot open the meeting', async () => {
    const harness = createServiceWorkerHarness();
    const meetingUrl = 'https://meet.example.test/appointment-42';
    harness.openWindow.mockImplementation(async (url) => {
      if (url === meetingUrl) {
        throw new Error('Meeting window blocked');
      }
      return {};
    });

    await harness.dispatch('notificationclick', {
      action: 'start',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
          meetingUrl,
        },
      },
    });

    expect(harness.openWindow).toHaveBeenCalledTimes(2);
    expect(harness.openWindow.mock.calls[0][0]).toBe(meetingUrl);
    const destination = new URL(harness.openWindow.mock.calls[1][0]);
    expect(destination.searchParams.get('urgentAction')).toBe('start');
    expect(destination.searchParams.get('urgentActionId')).toMatch(/^urgent-action-/);
    expect(destination.searchParams.has('meetingOpened')).toBe(false);
  });

  test('keeps a cross-origin meeting foreground when its client cannot be refocused', async () => {
    const harness = createServiceWorkerHarness();
    const meetingUrl = 'https://meet.example.test/appointment-42';
    harness.openWindow.mockImplementation(async (url) => {
      if (url === meetingUrl) return null;
      throw new Error('Memory Cue must not replace the meeting');
    });

    await harness.dispatch('notificationclick', {
      action: 'start',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          urlPath: 'mobile.html#reminders',
          meetingUrl,
        },
      },
    });

    expect(harness.openWindow).toHaveBeenCalledTimes(1);
    expect(harness.openWindow).toHaveBeenCalledWith(meetingUrl);
  });

  test('opens a meeting link from the notification gesture before marking a live app as started', async () => {
    const meetingUrl = 'https://meet.example.test/appointment-42';
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({
      windowClients: [client],
      // Cross-origin opens resolve null even when the browser opens them.
      openWindowResult: null,
    });
    harness.evaluate(`
      releaseMeetingRecordUpdate = null;
      meetingRecordUpdateGate = new Promise((resolve) => {
        releaseMeetingRecordUpdate = resolve;
      });
      savePendingUrgentAction = async () => true;
      updatePendingUrgentActionMeetingOpened = async () => {
        await meetingRecordUpdateGate;
        return true;
      };
    `);

    const clickPromise = harness.dispatch('notificationclick', {
      action: 'start',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          meetingUrl,
          urlPath: 'mobile.html#reminders',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.openWindow).toHaveBeenCalledWith(meetingUrl);
    expect(client.focus).not.toHaveBeenCalled();
    harness.evaluate('releaseMeetingRecordUpdate()');
    await clickPromise;

    expect(client.focus).not.toHaveBeenCalled();
    expect(harness.openWindow).toHaveBeenCalledWith(meetingUrl);
    expect(harness.openWindow.mock.invocationCallOrder[0])
      .toBeLessThan(client.postMessage.mock.invocationCallOrder[0]);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action: 'start',
      reminderId: 'appointment-42',
      meetingAlreadyOpened: true,
    }));
  });

  test('treats a notification body click as acknowledge and does not clear the badge', async () => {
    const client = {
      url: 'https://memory-cue.test/app/mobile.html',
      postMessage: jest.fn(),
      focus: jest.fn().mockResolvedValue(undefined),
      navigate: jest.fn().mockResolvedValue(undefined),
    };
    const harness = createServiceWorkerHarness({ windowClients: [client] });

    await harness.dispatch('notificationclick', {
      action: '',
      notification: {
        close: jest.fn(),
        data: {
          type: 'memoryCue:urgentReminder',
          reminderId: 'appointment-42',
          stageKey: 'due',
          badgeCount: 2,
          urlPath: 'mobile.html',
        },
      },
    });

    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'memoryCue:urgentAction',
      action: 'acknowledge',
      reminderId: 'appointment-42',
      stageKey: 'due',
    }));
    expect(harness.setAppBadge).toHaveBeenCalledWith(2);
    expect(harness.clearAppBadge).not.toHaveBeenCalled();
  });

  test('unwraps a nested legacy push notification without changing its display path', async () => {
    const harness = createServiceWorkerHarness();

    await harness.dispatch('push', {
      data: {
        json: () => ({
          data: {
            title: 'Ordinary reminder',
            body: 'Legacy notification body',
            urlPath: 'mobile.html#reminders',
          },
        }),
      },
    });

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Ordinary reminder',
      expect.objectContaining({ body: 'Legacy notification body' })
    );
  });

  test('routes a nested reminder-sync payload without showing it as a generic push', async () => {
    const harness = createServiceWorkerHarness();

    await harness.dispatch('push', {
      data: {
        json: () => ({
          data: {
            type: 'memoryCue:reminder-sync',
            action: 'upsert',
            reminder: JSON.stringify({
              id: 'sync-9',
              title: 'Synced reminder',
              due: '2099-01-01T10:00:00.000Z',
            }),
          },
        }),
      },
    });

    expect(harness.showNotification).not.toHaveBeenCalled();
  });

  test('suppresses repeated and concurrent revision-aware scheduler delivery IDs', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      const deliveryId = 'v2_' + 'A'.repeat(43);
      let processed = false;
      let attempts = 0;
      let remembered = 0;
      const storage = {
        wasProcessed: async () => processed,
        rememberProcessed: async () => {
          processed = true;
          remembered += 1;
          return true;
        },
      };
      const operation = async () => {
        attempts += 1;
        await Promise.resolve();
        return true;
      };
      const first = runUrgentDeliveryOnce(deliveryId, operation, storage);
      const concurrent = runUrgentDeliveryOnce(deliveryId, operation, storage);
      await Promise.all([first, concurrent]);
      await runUrgentDeliveryOnce(deliveryId, operation, storage);
      return { attempts, remembered };
    })()`);

    expect(result).toEqual({ attempts: 1, remembered: 1 });
  });

  test('does not remember a scheduler delivery until processing succeeds', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      const deliveryId = 'v1_' + 'B'.repeat(43);
      let processed = false;
      let attempts = 0;
      let remembered = 0;
      const storage = {
        wasProcessed: async () => processed,
        rememberProcessed: async () => {
          processed = true;
          remembered += 1;
          return true;
        },
      };
      const operation = async () => {
        attempts += 1;
        return attempts > 1;
      };
      const firstResult = await runUrgentDeliveryOnce(deliveryId, operation, storage);
      const retryResult = await runUrgentDeliveryOnce(deliveryId, operation, storage);
      return { firstResult, retryResult, attempts, remembered };
    })()`);

    expect(result).toEqual({
      firstResult: false,
      retryResult: true,
      attempts: 2,
      remembered: 1,
    });
  });

  test('does not persist invalid delivery IDs', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      let attempts = 0;
      let storageCalls = 0;
      const storage = {
        wasProcessed: async () => { storageCalls += 1; return false; },
        rememberProcessed: async () => { storageCalls += 1; return true; },
      };
      const operation = async () => { attempts += 1; return true; };
      await runUrgentDeliveryOnce('not-a-scheduler-id', operation, storage);
      await runUrgentDeliveryOnce('not-a-scheduler-id', operation, storage);
      return { attempts, storageCalls };
    })()`);

    expect(result).toEqual({ attempts: 2, storageCalls: 0 });
  });
});

describe('Memory Cue service-worker install identity', () => {
  test('immediately activates the targeted durable phone-action repair', async () => {
    const harness = createServiceWorkerHarness({
      serviceWorkerUrl: 'https://memory-cue.test/app/service-worker-v3.js?v=20260904a',
    });

    await harness.dispatch('install');

    expect(harness.skipWaiting).toHaveBeenCalledTimes(1);
  });

  test('returns later service-worker releases to normal wait-for-close activation', async () => {
    const harness = createServiceWorkerHarness({
      serviceWorkerUrl: 'https://memory-cue.test/app/service-worker-v3.js?v=20260904b',
    });

    await harness.dispatch('install');

    expect(harness.skipWaiting).not.toHaveBeenCalled();
  });

  test('uses a stable PWA id and a bumped registration version', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'manifest.webmanifest'),
      'utf8'
    ));
    const registrationSource = fs.readFileSync(
      path.join(__dirname, '..', 'register-service-worker-v2.js'),
      'utf8'
    );
    const mobileSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'mobile.html'),
      'utf8'
    );
    const mobileRuntimeSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'mobile.js'),
      'utf8'
    );
    const reminderLoaderSource = fs.readFileSync(
      path.join(__dirname, '..', 'reminders.js'),
      'utf8'
    );
    const reminderControllerSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'reminders', 'reminderController.js'),
      'utf8'
    );

    expect(manifest.id).toBe('./');
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: './icons/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: './icons/icon-512.png', sizes: '512x512' }),
    ]));
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'icons', 'icon-192.png'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'icons', 'icon-512.png'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'icons', 'apple-touch-icon.png'))).toBe(true);
    const readPngSize = (filename) => {
      const data = fs.readFileSync(path.join(__dirname, '..', '..', 'icons', filename));
      return [data.readUInt32BE(16), data.readUInt32BE(20)];
    };
    expect(readPngSize('icon-192.png')).toEqual([192, 192]);
    expect(readPngSize('icon-512.png')).toEqual([512, 512]);
    expect(readPngSize('apple-touch-icon.png')).toEqual([180, 180]);
    expect(registrationSource).toContain('service-worker-v3.js?v=20260904a');
    expect(mobileSource).toContain('register-service-worker-v2.js?v=20260904a');
    expect(mobileSource).toContain('mobile.js?v=20260904a');
    expect(mobileRuntimeSource).toContain('js/reminders.js?v=20260904a');
    expect(reminderLoaderSource).toContain('reminderController.js?v=20260904a');
    expect(reminderControllerSource).toContain('reminderRepository.js?v=20260904a');
    expect(reminderControllerSource).toContain('reminderFirestoreSync.js?v=20260904a');
    expect(reminderControllerSource).toContain('reminderPushSync.js?v=20260904a');

    const serviceWorkerSource = fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');
    expect(serviceWorkerSource).toContain("const CACHE_NAME = 'memory-cue-v6';");
    expect(serviceWorkerSource).toContain('const REMINDER_DB_VERSION = 5;');
    expect(serviceWorkerSource).toContain("const PROCESSED_URGENT_DELIVERY_STORE_NAME = 'processedUrgentDeliveries';");
    expect(serviceWorkerSource).toContain("const URGENT_STAGE_CLAIM_STORE_NAME = 'urgentStageClaims';");
    expect(serviceWorkerSource).toContain("const PENDING_URGENT_ACTION_STORE_NAME = 'pendingUrgentActions';");
    expect(serviceWorkerSource).toContain('const PROCESSED_URGENT_DELIVERY_LIMIT = 512;');
    expect(serviceWorkerSource).toContain('const URGENT_STAGE_CLAIM_PRUNE_TARGET = 896;');
  });
});
