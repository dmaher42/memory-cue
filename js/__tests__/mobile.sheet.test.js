/**
 * @jest-environment jsdom
 */

const { loadMobileModule } = require('./helpers/load-mobile-module');

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
    window.__saveClicks = undefined;
    delete window.__mobileMocks;
  });

  test('clicking Save Reminder triggers handlers when sheet content stops bubbling', async () => {
    window.__saveClicks = 0;
    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn(() => {
        const saveBtn = document.getElementById('saveReminder');
        if (saveBtn) {
          saveBtn.addEventListener('click', () => {
            window.__saveClicks += 1;
          });
        }
        return Promise.resolve({});
      }),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: (note) => note || {},
      NOTES_STORAGE_KEY: 'memoryCue:notes',
      getFolders: () => [],
      getFolderNameById: () => 'General',
      assignNoteToFolder: () => {},
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      ModalController: class ModalController {
        constructor() {}
        show() {}
        hide() {}
      },
      saveFolders: () => {},
    };

    loadMobileModule();

    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    await Promise.resolve();

    document.dispatchEvent(new window.CustomEvent('cue:open'));

    const saveBtn = document.getElementById('saveReminder');
    saveBtn.click();

    expect(window.__saveClicks).toBe(1);
  });
});
