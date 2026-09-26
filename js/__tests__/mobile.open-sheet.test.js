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
            <button type="button" data-reminder-date-preset="today">Today</button>
            <button type="button" data-reminder-date-preset="tomorrow">Tomorrow</button>
            <button type="button" data-reminder-date-preset="choose">Choose date</button>
            <button type="button" id="reminderAddTime" hidden>Add time</button>
            <div id="reminderDateTimeFields" hidden>
              <input id="reminderDate" type="date" />
              <input id="reminderTime" type="time" />
            </div>
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

  test('quick dates keep fields tucked away until Add time is requested', () => {
    document.dispatchEvent(new CustomEvent('cue:open'));
    const fields = document.getElementById('reminderDateTimeFields');
    const addTime = document.getElementById('reminderAddTime');
    const date = document.getElementById('reminderDate');
    expect(fields.hidden).toBe(true);
    expect(addTime.hidden).toBe(true);
    document.querySelector('[data-reminder-date-preset="tomorrow"]').click();
    expect(date.value).not.toBe('');
    expect(fields.hidden).toBe(true);
    expect(addTime.hidden).toBe(false);
    const selectedDate = date.value;
    addTime.click();
    expect(fields.hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('reminderTime'));
    expect(date.value).toBe(selectedDate);
  });

  test('Choose date reveals the native input before opening its picker', () => {
    document.dispatchEvent(new CustomEvent('cue:open'));
    const fields = document.getElementById('reminderDateTimeFields');
    const date = document.getElementById('reminderDate');
    date.showPicker = jest.fn(() => expect(fields.hidden).toBe(false));
    const choose = document.querySelector('[data-reminder-date-preset="choose"]');
    choose.click();
    expect(date.showPicker).toHaveBeenCalledTimes(1);
    expect(choose.getAttribute('aria-expanded')).toBe('true');
  });

  test('editing reveals an existing schedule and a fresh form collapses again', () => {
    const fields = document.getElementById('reminderDateTimeFields');
    const date = document.getElementById('reminderDate');
    const time = document.getElementById('reminderTime');
    date.value = '2030-12-15';
    time.value = '15:30';
    document.dispatchEvent(new CustomEvent('cue:open'));
    expect(fields.hidden).toBe(false);
    expect(date.value).toBe('2030-12-15');
    expect(time.value).toBe('15:30');
    document.dispatchEvent(new CustomEvent('cue:close'));
    date.value = '';
    time.value = '';
    document.dispatchEvent(new CustomEvent('cue:open'));
    expect(fields.hidden).toBe(true);
    document.querySelector('[data-reminder-date-preset="today"]').click();
    time.value = '16:30';
    document.dispatchEvent(new CustomEvent('cue:close'));
    document.dispatchEvent(new CustomEvent('cue:open'));
    expect(fields.hidden).toBe(false);
    expect(time.value).toBe('16:30');
  });
});
