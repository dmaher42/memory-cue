/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

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
    const controller = loadReminderController({
      reminderDataService,
      getUrgentReminderState: buildUrgentState,
      isUrgentTimedReminder: (reminder) => reminder?.urgentAlert === true && reminder?.hasExplicitTime === true,
    });
    api = await controller.initReminders({ statusSel: '#status', listSel: '#reminders' });
    setAppBadge.mockClear();
    clearAppBadge.mockClear();
    postToWorker.mockClear();
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
});
