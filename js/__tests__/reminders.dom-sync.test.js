/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRemindersModule() {
  const filePath = path.resolve(__dirname, '../reminders.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+async\s+function\s+initReminders/, 'async function initReminders');
  source += '\nmodule.exports = { initReminders };\n';
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    setTimeout,
    clearTimeout,
    window,
    document,
    localStorage,
    navigator,
    Notification,
    CustomEvent: window.CustomEvent,
    fetch: global.fetch,
    Blob: global.Blob,
    Response: global.Response,
    URL: global.URL,
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

describe('rendered reminders expose dataset metadata', () => {
  let api;

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
          <button id="cancelEditBtn" type="button" class="hidden">Cancel</button>
        </form>
        <div id="remindersWrapper"><ul id="reminderList"></ul></div>
        <div id="emptyState" class="hidden"></div>
        <div id="statusMessage"></div>
        <div id="syncStatus"></div>
      </main>
    `;

    window.scrollTo = jest.fn();
    window.toast = jest.fn();
    global.toast = window.toast;

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    window.fetch = global.fetch;

    global.Notification = MockNotification;
    window.Notification = MockNotification;

    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };
    navigator.serviceWorker = navigator.serviceWorker || {
      getRegistration: jest.fn().mockResolvedValue(null),
      register: jest.fn().mockResolvedValue({}),
      ready: Promise.resolve({
        showNotification: jest.fn(),
        getNotifications: jest.fn().mockResolvedValue([]),
      }),
    };

    window.CustomEvent = window.CustomEvent || function CustomEvent(event, params = {}) {
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles ?? false, params.cancelable ?? false, params.detail);
      return evt;
    };
    global.CustomEvent = window.CustomEvent;

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
      cancelEditBtnSel: '#cancelEditBtn',
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
    localStorage.clear();
    jest.clearAllTimers();
    delete window.toast;
    delete global.toast;
  });

  test('each rendered reminder row includes a serialised dataset payload', () => {
    const title = document.getElementById('reminderText');
    const date = document.getElementById('reminderDate');
    const time = document.getElementById('reminderTime');
    const save = document.getElementById('saveReminder');

    title.value = 'Call Alex';
    date.value = '2025-12-24';
    time.value = '15:45';

    save.click();

    const row = document.querySelector('.task-item');
    expect(row).toBeTruthy();
    expect(row.dataset).toBeTruthy();

    const summary = JSON.parse(row.dataset.reminder || '{}');

    expect(summary).toMatchObject({
      title: 'Call Alex',
      category: 'General',
      priority: 'Medium',
      done: false,
    });
    expect(typeof summary.id).toBe('string');
    expect(summary.id.length).toBeGreaterThan(0);
    expect(summary.dueIso).toContain('2025-12-24');

    expect(row.dataset.id).toBe(summary.id);
    expect(row.dataset.title).toBe('Call Alex');
    expect(row.dataset.category).toBe('General');
    expect(row.dataset.priority).toBe('Medium');
    expect(row.dataset.done).toBe('false');
    expect(row.dataset.due).toContain('2025-12-24');
  });
});
