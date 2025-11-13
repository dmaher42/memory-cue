/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runMobileModule(window) {
  const filePath = path.resolve(__dirname, '../../mobile.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    "import { initViewportHeight } from './js/modules/viewport-height.js';",
    'const initViewportHeight = () => () => {};',
  );
  source = source.replace(
    "import { initReminders } from './js/reminders.js';",
    'const initReminders = window.__initReminders;',
  );

  const context = vm.createContext({});
  context.window = window;
  context.document = window.document;
  context.console = console;
  context.setTimeout = window.setTimeout.bind(window);
  context.clearTimeout = window.clearTimeout.bind(window);
  context.CustomEvent = window.CustomEvent;
  context.Event = window.Event;
  context.HTMLElement = window.HTMLElement;
  context.Element = window.Element;
  context.Node = window.Node;
  context.navigator = window.navigator;
  context.globalThis = context;
  context.self = window;

  vm.runInContext(source, context, { filename: filePath });
}

describe('mobile create sheet interactions', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="create-sheet" class="sheet" data-add-task-dialog>
        <div class="sheet-panel" data-dialog-content>
          <form id="createReminderForm">
            <input id="reminderText" />
            <button id="saveReminder" type="button">Save Reminder</button>
          </form>
        </div>
        <div class="sheet-backdrop" data-close></div>
      </div>
      <div id="remindersWrapper"><ul id="reminderList"></ul></div>
      <div id="emptyState"></div>
      <div id="statusMessage"></div>
      <div id="syncStatus"></div>
    `;
  });

  afterEach(() => {
    window.__initReminders = undefined;
    window.__saveClicks = undefined;
  });

  test('clicking Save Reminder triggers handlers when sheet content stops bubbling', async () => {
    window.__saveClicks = 0;
    window.__initReminders = jest.fn(() => {
      const saveBtn = document.getElementById('saveReminder');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          window.__saveClicks += 1;
        });
      }
      return Promise.resolve({});
    });

    runMobileModule(window);

    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    await Promise.resolve();

    document.dispatchEvent(new window.CustomEvent('cue:open'));

    const saveBtn = document.getElementById('saveReminder');
    saveBtn.click();

    expect(window.__saveClicks).toBe(1);
  });
});
