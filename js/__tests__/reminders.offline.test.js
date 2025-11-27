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
  source = source.replace(
    "import { setAuthContext, startSignInFlow, startSignOutFlow } from './supabase-auth.js';\n",
    'const setAuthContext = () => {}; const startSignInFlow = () => {}; const startSignOutFlow = () => {};\n',
  );
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
    HTMLElement: window.HTMLElement,
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

describe('reminders offline initialisation', () => {
  let importModule;
  let api;

  class MockNotification {
    static permission = 'granted';
    static requestPermission = jest.fn().mockResolvedValue('granted');

    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.onclose = null;
      this.onclick = null;
      this.close = jest.fn();
    }

    addEventListener() {}
  }

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="status"></div>
      <input id="title" />
      <input id="date" />
      <input id="time" />
      <textarea id="details"></textarea>
      <select id="priority"><option value="High">High</option><option value="Medium" selected>Medium</option><option value="Low">Low</option></select>
      <input id="category" />
      <button id="save">Save</button>
      <button id="cancel" class="hidden">Cancel</button>
      <div id="list"></div>
    `;

    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.Notification = MockNotification;
    window.Notification = MockNotification;
    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };
    delete globalThis.__memoryCueFirebaseUnavailable__;
    window.CustomEvent = function CustomEvent(event, params = {}) {
      const evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(event, params.bubbles ?? false, params.cancelable ?? false, params.detail);
      return evt;
    };
    global.CustomEvent = window.CustomEvent;

    importModule = jest.fn(() => Promise.reject(new Error('Failed to load Firebase')));

    const remindersModule = loadRemindersModule();
    api = await remindersModule.initReminders({
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
      importModule,
    });
  });

  afterEach(() => {
    api?.closeActiveNotifications();
    localStorage.clear();
    jest.clearAllTimers();
  });

  test('continues offline setup when Firebase imports fail', () => {
    const title = document.querySelector('#title');
    const saveBtn = document.querySelector('#save');
    title.value = 'Offline reminder works';

    saveBtn.click();

    const saved = api.__testing.getItems();
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('Offline reminder works');
    expect(importModule).toHaveBeenCalled();
    expect(window.__memoryCueFirebaseUnavailable__).toBe(true);
  });
});
