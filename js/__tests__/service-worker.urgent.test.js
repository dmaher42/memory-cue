const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SERVICE_WORKER_PATH = path.join(__dirname, '..', '..', 'service-worker-v3.js');

function createServiceWorkerHarness({
  windowClients = [],
  openWindowResult = null,
  scope = 'https://memory-cue.test/app/',
  serviceWorkerUrl = new URL('service-worker-v3.js', scope).href,
} = {}) {
  const listeners = new Map();
  const showNotification = jest.fn().mockResolvedValue(undefined);
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

  test('opens the app action fallback and meeting link when the app is closed', async () => {
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

    expect(harness.openWindow).toHaveBeenCalledTimes(2);
    const destination = new URL(harness.openWindow.mock.calls[0][0]);
    expect(destination.pathname).toBe('/app/mobile.html');
    expect(destination.searchParams.get('reminderId')).toBe('appointment-42');
    expect(destination.searchParams.get('urgentAction')).toBe('start');
    expect(destination.searchParams.get('urgentStage')).toBe('due');
    expect(destination.searchParams.get('meetingOpened')).toBe('1');
    expect(destination.hash).toBe('#reminders');
    expect(harness.openWindow.mock.calls[1][0]).toBe(meetingUrl);
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

    await harness.dispatch('notificationclick', {
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

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(harness.openWindow).toHaveBeenCalledWith(meetingUrl);
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

  test('suppresses repeated and concurrent scheduler delivery IDs', async () => {
    const harness = createServiceWorkerHarness();
    const result = await harness.evaluate(`(async () => {
      const deliveryId = 'v1_' + 'A'.repeat(43);
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
  test('immediately activates the targeted duplicate-window repair', async () => {
    const harness = createServiceWorkerHarness({
      serviceWorkerUrl: 'https://memory-cue.test/app/service-worker-v3.js?v=20260903b',
    });

    await harness.dispatch('install');

    expect(harness.skipWaiting).toHaveBeenCalledTimes(1);
  });

  test('returns later service-worker releases to normal wait-for-close activation', async () => {
    const harness = createServiceWorkerHarness({
      serviceWorkerUrl: 'https://memory-cue.test/app/service-worker-v3.js?v=20260903c',
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
    expect(registrationSource).toContain('service-worker-v3.js?v=20260903b');

    const serviceWorkerSource = fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');
    expect(serviceWorkerSource).toContain('const REMINDER_DB_VERSION = 2;');
    expect(serviceWorkerSource).toContain("const PROCESSED_URGENT_DELIVERY_STORE_NAME = 'processedUrgentDeliveries';");
    expect(serviceWorkerSource).toContain('const PROCESSED_URGENT_DELIVERY_LIMIT = 512;');
  });
});
