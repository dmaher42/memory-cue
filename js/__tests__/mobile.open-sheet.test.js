/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileModule() {
  const filePath = path.resolve(__dirname, '../../mobile.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    "import { initViewportHeight } from './js/modules/viewport-height.js';",
    'const { initViewportHeight } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { initReminders } from './js/reminders.js';",
    'const { initReminders } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { initSupabaseAuth } from './js/supabase-auth.js';",
    "const { initSupabaseAuth, startSignInFlow } = window.__mobileMocks;"
  );
  source = source.replace(
    "import {\n  loadAllNotes,\n  saveAllNotes,\n  createNote,\n  NOTES_STORAGE_KEY,\n} from './js/modules/notes-storage.js';",
    'const { loadAllNotes, saveAllNotes, createNote, NOTES_STORAGE_KEY } = window.__mobileMocks;',
  );
  source = source.replace(
    "import { initNotesSync } from './js/modules/notes-sync.js';",
    'const { initNotesSync } = window.__mobileMocks;',
  );
  source = source.replace(
    "import { getFolders } from './js/modules/notes-storage.js';",
    'const { getFolders } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { getFolderNameById, assignNoteToFolder } from './js/modules/notes-storage.js';",
    'const { getFolderNameById, assignNoteToFolder } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { ModalController } from './js/modules/modal-controller.js';",
    'const { ModalController } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { saveFolders } from './js/modules/notes-storage.js';",
    'const { saveFolders } = window.__mobileMocks;'
  );
  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement,
    HTMLFormElement: window.HTMLFormElement,
    navigator,
    location: window.location,
  });
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
}

describe('mobile sheet opener events', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <button data-open-add-task id="openSheet">Add</button>
      <div id="create-sheet" class="sheet hidden">
        <div data-dialog-content>
          <button id="closeCreateSheet" type="button">Close</button>
          <form id="createReminderForm">
            <input id="reminderText" />
            <textarea id="reminderDetails"></textarea>
            <input id="reminderDate" type="date" />
            <input id="reminderTime" type="time" />
            <select id="priority">
              <option value="High">High</option>
              <option value="Medium" selected>Medium</option>
              <option value="Low">Low</option>
            </select>
            <fieldset id="priorityChips">
              <label><input type="radio" name="priority" value="High"></label>
              <label><input type="radio" name="priority" value="Medium" checked></label>
              <label><input type="radio" name="priority" value="Low"></label>
            </fieldset>
            <input id="category" />
            <button id="saveReminder" type="button">Save</button>
          </form>
        </div>
        <div class="sheet-backdrop"></div>
      </div>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initSupabaseAuth: jest.fn(),
      startSignInFlow: jest.fn(),
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: () => ({}),
      NOTES_STORAGE_KEY: 'memoryCue:notes',
      initNotesSync: () => ({ handleSessionChange() {}, setSupabaseClient() {} }),
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

    loadMobileModule();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    jest.clearAllMocks();
  });

  test('dispatches cue prepare before opening the sheet', () => {
    const addButton = document.querySelector('[data-open-add-task]');
    const titleInput = document.getElementById('reminderText');
    titleInput.value = 'Keep me';

    const events = [];
    document.addEventListener('cue:prepare', (event) => {
      events.push({ type: 'prepare', trigger: event.detail?.trigger });
      titleInput.value = '';
    });
    document.addEventListener('cue:open', (event) => {
      events.push({ type: 'open', trigger: event.detail?.trigger });
    });

    addButton.click();

    expect(events.map((e) => e.type)).toEqual(['prepare', 'open']);
    expect(events[0].trigger).toBe(addButton);
    expect(events[1].trigger).toBe(addButton);
    expect(titleInput.value).toBe('');
  });
});
