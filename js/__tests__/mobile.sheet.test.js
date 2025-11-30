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
  source = source.replace(
    "import { initSupabaseAuth } from './js/supabase-auth.js';",
    'const initSupabaseAuth = window.__initSupabaseAuth;',
  );
  source = source.replace(
    "import {\n  loadAllNotes,\n  saveAllNotes,\n  createNote,\n  NOTES_STORAGE_KEY,\n} from './js/modules/notes-storage.js';",
    'const { loadAllNotes, saveAllNotes, createNote, NOTES_STORAGE_KEY } = window.__notesModule;',
  );
  source = source.replace(
    "import { initNotesSync } from './js/modules/notes-sync.js';",
    'const initNotesSync = window.__initNotesSync;',
  );
  source = source.replace(
    "import { getFolders } from './js/modules/notes-storage.js';",
    'const { getFolders } = window.__notesModule;'
  );
  source = source.replace(
    "import { getFolderNameById, assignNoteToFolder } from './js/modules/notes-storage.js';",
    'const { getFolderNameById, assignNoteToFolder } = window.__notesModule;'
  );
  source = source.replace(
    "import { ModalController } from './js/modules/modal-controller.js';",
    'const { ModalController } = window.__notesModule;'
  );
  source = source.replace(
    "import { saveFolders } from './js/modules/notes-storage.js';",
    'const { saveFolders } = window.__notesModule;'
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

  context.window.__notesModule =
    context.window.__notesModule || {
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: (note) => note || {},
      NOTES_STORAGE_KEY: 'memoryCue:notes',
    };
  context.window.__initNotesSync =
    context.window.__initNotesSync || (() => ({ handleSessionChange() {}, setSupabaseClient() {} }));

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
    window.__initSupabaseAuth = undefined;
    window.__notesModule = undefined;
  });

  test('clicking Save Reminder triggers handlers when sheet content stops bubbling', async () => {
    window.__saveClicks = 0;
    window.__initSupabaseAuth = jest.fn();
    window.__notesModule = {
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: (note) => note || {},
      NOTES_STORAGE_KEY: 'memoryCue:notes',
      getFolders: () => [],
      getFolderNameById: () => 'General',
      assignNoteToFolder: () => {},
      ModalController: class ModalController {
        constructor() {}
        show() {}
        hide() {}
      },
      saveFolders: () => {},
    };
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
