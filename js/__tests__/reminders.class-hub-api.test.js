/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

describe('class hub reminder API', () => {
  let api;
  let completeReminder;
  let createReminder;
  let saveReminder;

  class MockNotification {
    static permission = 'granted';
    static requestPermission = jest.fn().mockResolvedValue('granted');

    constructor() {
      this.close = jest.fn();
    }

    addEventListener() {}
  }

  beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = `
      <main>
        <input id="title" />
        <input id="date" />
        <input id="time" />
        <textarea id="details"></textarea>
        <select id="priority"><option value="Medium" selected>Medium</option></select>
        <input id="category" />
        <button id="save" type="button">Save</button>
        <button id="cancel" type="button" class="hidden">Cancel</button>
        <ul id="list"></ul>
        <div id="status"></div>
      </main>
    `;

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = global.fetch;
    global.Notification = MockNotification;
    window.Notification = MockNotification;
    window.CustomEvent = window.CustomEvent || function CustomEvent(event, params = {}) {
      const customEvent = document.createEvent('CustomEvent');
      customEvent.initCustomEvent(event, params.bubbles ?? false, params.cancelable ?? false, params.detail);
      return customEvent;
    };
    global.CustomEvent = window.CustomEvent;
    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };

    completeReminder = jest.fn((id, completed, options = {}) => {
      const now = Date.now();
      const record = {
        id,
        done: completed === true,
        completed: completed === true,
        completedAt: completed === true ? now : null,
        updatedAt: now,
      };
      options.onCompleted?.(record);
      return record;
    });
    createReminder = jest.fn((payload = {}, options = {}) => {
      const now = Date.now();
      const tomorrow = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const record = {
        id: payload.id || `reminder-${now}`,
        title: payload.title || payload.text || '',
        due: payload.due || payload.dueAt || tomorrow,
        dueAt: payload.dueAt || payload.due || tomorrow,
        notifyAt: payload.notifyAt || tomorrow,
        category: payload.category || 'School',
        priority: payload.priority || 'Medium',
        metadata: payload.metadata ? { ...payload.metadata } : null,
        done: false,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      options.onCreated?.(record);
      return record;
    });
    saveReminder = jest.fn().mockResolvedValue(true);

    const remindersModule = loadReminderController({
      saveReminder,
      reminderDataService: {
        createReminder,
        updateReminder: () => null,
        deleteReminder: () => null,
        completeReminder,
      },
    });

    api = await remindersModule.initReminders({
      variant: 'mobile',
      statusSel: '#status',
      titleSel: '#title',
      dateSel: '#date',
      timeSel: '#time',
      detailsSel: '#details',
      prioritySel: '#priority',
      categorySel: '#category',
      saveBtnSel: '#save',
      cancelEditBtnSel: '#cancel',
      listSel: '#list',
    });
  });

  afterEach(() => {
    api?.closeActiveNotifications?.();
    localStorage.clear();
    document.body.innerHTML = '';
    jest.clearAllTimers();
  });

  test('returns defensive snapshots and completes a linked follow-up through the live lifecycle', async () => {
    const originalNotes = JSON.stringify([{ id: 'note-1', title: 'Existing class note' }]);
    const originalFolders = JSON.stringify([{ id: 'class-y8-hpe', name: 'Year 8 HPE' }]);
    localStorage.setItem('memoryCueNotes', originalNotes);
    localStorage.setItem('memoryCueFolders', originalFolders);

    api.__testing.setItems([{
      id: 'follow-up-1',
      title: 'Speak to the two students',
      category: 'School',
      done: false,
      completed: false,
      metadata: {
        type: 'class-follow-up',
        classHubId: 'class-y8-hpe',
        classHubName: 'Year 8 HPE',
        suppressNotification: true,
      },
    }]);
    api.__testing.persistItems();

    const firstSnapshot = api.getReminders();
    firstSnapshot[0].title = 'Mutated outside the controller';
    firstSnapshot[0].metadata.classHubId = 'wrong-hub';

    expect(api.getReminders()[0]).toMatchObject({
      title: 'Speak to the two students',
      metadata: {
        type: 'class-follow-up',
        classHubId: 'class-y8-hpe',
      },
    });

    const updateEvents = [];
    document.addEventListener('memoryCue:remindersUpdated', (event) => updateEvents.push(event.detail));

    const completed = api.setReminderCompleted('follow-up-1', true);
    await Promise.resolve();

    expect(completeReminder).toHaveBeenCalledWith(
      'follow-up-1',
      true,
      expect.objectContaining({ onCompleted: expect.any(Function) }),
    );
    expect(completed).toMatchObject({
      id: 'follow-up-1',
      done: true,
      completed: true,
      metadata: { classHubId: 'class-y8-hpe' },
    });
    expect(api.getReminders()[0]).toMatchObject({ done: true, completed: true });
    expect(saveReminder).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        id: 'follow-up-1',
        done: true,
        metadata: expect.objectContaining({ classHubId: 'class-y8-hpe' }),
      }),
    );
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0].items[0]).toMatchObject({ id: 'follow-up-1', done: true });
    expect(localStorage.getItem('memoryCueNotes')).toBe(originalNotes);
    expect(localStorage.getItem('memoryCueFolders')).toBe(originalFolders);
  });

  test('returns null without side effects when the reminder id is unknown', () => {
    expect(api.setReminderCompleted('missing-follow-up', true)).toBeNull();
    expect(completeReminder).not.toHaveBeenCalled();
    expect(saveReminder).not.toHaveBeenCalled();
  });

  test('plain class follow-ups never ask for notification permission or enter the schedule', async () => {
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockClear();

    const created = api.createReminderFromPayload({
      text: 'Call parent tomorrow',
      title: 'Call parent tomorrow',
      category: 'School',
      metadata: {
        type: 'class-follow-up',
        classHubId: 'class-y8-hpe',
        classHubName: 'Year 8 HPE',
        suppressNotification: true,
      },
    }, { closeSheet: false });
    await Promise.resolve();

    expect(created).toMatchObject({
      title: 'Call parent tomorrow',
      metadata: { suppressNotification: true },
    });
    expect(createReminder).toHaveBeenCalled();
    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    const scheduled = JSON.parse(localStorage.getItem('scheduledReminders') || '{}');
    expect(scheduled[created.id]).toBeUndefined();
  });
});
