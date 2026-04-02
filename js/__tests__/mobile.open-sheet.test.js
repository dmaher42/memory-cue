/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const { loadMobileModule } = require('./helpers/load-mobile-module');

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
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: () => ({}),
      NOTES_STORAGE_KEY: 'memoryCue:notes',
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
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
