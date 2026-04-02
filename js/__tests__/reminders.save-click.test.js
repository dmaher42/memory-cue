/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const { loadReminderController } = require('./helpers/load-reminder-controller');

function loadRemindersModule() {
  return loadReminderController();
}

describe('mobile save interactions', () => {
  let api;
  const events = [];

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

    document.body.innerHTML = `
      <main>
        <form id="createReminderForm">
          <input id="reminderText" />
          <input id="reminderDate" type="date" />
          <input id="reminderTime" type="time" />
          <textarea id="reminderDetails"></textarea>
          <select id="priority">
            <option value="High">High</option>
            <option value="Medium" selected>Medium</option>
            <option value="Low">Low</option>
          </select>
          <fieldset id="priorityChips">
            <label><input type="radio" name="priority" value="High" /></label>
            <label><input type="radio" name="priority" value="Medium" checked /></label>
            <label><input type="radio" name="priority" value="Low" /></label>
          </fieldset>
          <input id="category" />
          <button id="saveReminder" type="button">Save</button>
          <button id="cancelEdit" type="button" class="hidden">Cancel</button>
        </form>
        <div id="remindersWrapper"><ul id="reminderList"></ul></div>
        <div id="emptyState"></div>
        <div id="statusMessage"></div>
        <div id="syncStatus"></div>
      </main>
    `;

    window.scrollTo = jest.fn();

    window.CustomEvent = window.CustomEvent || function CustomEvent(event, params = {}) {
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles ?? false, params.cancelable ?? false, params.detail);
      return evt;
    };

    global.CustomEvent = window.CustomEvent;

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    window.fetch = global.fetch;

    global.HTMLElement = window.HTMLElement;
    window.HTMLElement = window.HTMLElement || global.HTMLElement;

    global.Notification = MockNotification;
    window.Notification = MockNotification;

    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };

    events.length = 0;
    document.addEventListener('reminders:updated', (e) => events.push(['reminders:updated', e?.detail]));
    document.addEventListener('memoryCue:remindersUpdated', (e) => events.push(['memoryCue:remindersUpdated', e?.detail]));

    window.toast = jest.fn();
    global.toast = window.toast;

    const { initReminders } = loadRemindersModule();
    api = await initReminders({
      variant: 'mobile',
      titleSel: '#reminderText',
      dateSel: '#reminderDate',
      timeSel: '#reminderTime',
      detailsSel: '#reminderDetails',
      prioritySel: '#priority',
      categorySel: '#category',
      saveBtnSel: '#saveReminder',
      cancelEditBtnSel: '#cancelEdit',
      listSel: '#reminderList',
      listWrapperSel: '#remindersWrapper',
      emptyStateSel: '#emptyState',
      statusSel: '#statusMessage',
      syncStatusSel: '#syncStatus',
      defaultFilter: 'all',
      importModule: jest.fn(() => Promise.reject(new Error('firebase disabled'))),
    });
  });

  afterEach(() => {
    api?.closeActiveNotifications?.();
    document.body.innerHTML = '';
    events.length = 0;
    localStorage.clear();
    jest.clearAllTimers();
    delete window.toast;
    delete global.toast;
    delete global.HTMLElement;
  });

  test('clicking Save creates and then updates a reminder without duplicate handlers', async () => {
    const title = document.getElementById('reminderText');
    const date = document.getElementById('reminderDate');
    const time = document.getElementById('reminderTime');
    const save = document.getElementById('saveReminder');
    const highChip = document.querySelector('#priorityChips input[value="High"]');

    title.value = 'Call Alex';
    date.value = '2025-10-28';
    time.value = '15:30';

    const initialRemindersUpdated = events.filter((entry) => entry[0] === 'reminders:updated').length;
    const initialMemoryCueUpdated = events.filter((entry) => entry[0] === 'memoryCue:remindersUpdated').length;

    save.click();
    await Promise.resolve();

    const itemsAfterCreate = api.__testing.getItems();
    expect(itemsAfterCreate).toHaveLength(1);
    expect(itemsAfterCreate[0].title).toBe('Call Alex');
    expect(events.filter((entry) => entry[0] === 'reminders:updated').length).toBe(initialRemindersUpdated + 1);
    expect(events.filter((entry) => entry[0] === 'memoryCue:remindersUpdated').length).toBe(initialMemoryCueUpdated + 1);

    // Enter edit mode via rendered list button
    const reminderRow = document.querySelector('[data-reminder-item="true"]');
    expect(reminderRow).toBeTruthy();
    reminderRow.click();
    await Promise.resolve();

    title.value = 'Call Alex Updated';
    highChip.checked = true;

    const remindersUpdatedBeforeEdit = events.filter((entry) => entry[0] === 'reminders:updated').length;
    const memoryCueUpdatedBeforeEdit = events.filter((entry) => entry[0] === 'memoryCue:remindersUpdated').length;

    save.click();
    await Promise.resolve();

    const itemsAfterEdit = api.__testing.getItems();
    expect(itemsAfterEdit).toHaveLength(1);
    expect(itemsAfterEdit[0].title).toBe('Call Alex Updated');
    expect(itemsAfterEdit[0].priority).toBe('High');
    expect(events.filter((entry) => entry[0] === 'reminders:updated').length).toBe(remindersUpdatedBeforeEdit + 1);
    expect(events.filter((entry) => entry[0] === 'memoryCue:remindersUpdated').length).toBe(memoryCueUpdatedBeforeEdit + 1);

    expect(itemsAfterEdit).toHaveLength(1);
    expect(itemsAfterEdit[0].title).toBe('Call Alex Updated');

    const toastMessages = (window.toast.mock.calls || []).map((call) => call[0]);
    expect(toastMessages).not.toContain('Add a reminder title');
  });
});
