/** @jest-environment jsdom */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClassHubsUi() {
  const filePath = path.resolve(__dirname, '../../src/ui/mobileClassHubsUi.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export function initMobileClassHubsUi/g, 'function initMobileClassHubsUi')
    .replace(/export const CLASS_HUB_REMINDER_TYPES/g, 'const CLASS_HUB_REMINDER_TYPES');
  source += '\nmodule.exports = { initMobileClassHubsUi, CLASS_HUB_REMINDER_TYPES };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    document,
    window,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLFormElement: window.HTMLFormElement,
    HTMLInputElement: window.HTMLInputElement,
    CustomEvent: window.CustomEvent,
    Date,
    Intl,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Math,
    RegExp,
    Promise,
    setTimeout,
    clearTimeout,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('mobile Class Hubs UI', () => {
  let folders;
  let notes;
  let reminders;
  let ui;
  let openNote;
  let openReminder;
  let startAiOrganize;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main id="main"><section id="classHubsPanel" aria-label="Class hubs"></section></main>';
    folders = [
      { id: 'school', name: 'School', order: 0 },
      { id: 'class-existing', name: 'Year 9 English', order: 1, kind: 'class-hub' },
    ];
    notes = [{
      id: 'ordinary-note',
      title: 'Ordinary note',
      bodyText: 'Keep me unchanged',
      folderId: 'school',
      updatedAt: '2026-08-10T10:00:00.000Z',
    }];
    reminders = [{
      id: 'ordinary-reminder',
      text: 'Ordinary reminder',
      completed: false,
      metadata: null,
      createdAt: 1,
    }];
    openNote = jest.fn();
    openReminder = jest.fn();
    startAiOrganize = jest.fn(() => true);

    const { initMobileClassHubsUi } = loadClassHubsUi();
    ui = initMobileClassHubsUi({
      rootElement: document.getElementById('classHubsPanel'),
      getClassHubFolders: () => folders.filter((folder) => folder.kind === 'class-hub'),
      createClassHubFolder: (name) => {
        const duplicate = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
        if (duplicate) return { status: 'duplicate', folder: duplicate };
        const folder = { id: 'class-hpe', name, order: folders.length, kind: 'class-hub' };
        folders.push(folder);
        return { status: 'created', folder };
      },
      getNotes: () => notes,
      getReminders: () => reminders,
      createReminder: (payload) => {
        const reminder = {
          ...payload,
          id: `reminder-${reminders.length}`,
          completed: false,
          createdAt: reminders.length + 1,
        };
        reminders.push(reminder);
        return reminder;
      },
      setReminderCompleted: (id, completed) => {
        const reminder = reminders.find((entry) => entry.id === id);
        if (!reminder) return null;
        reminder.completed = completed;
        return { ...reminder };
      },
      openNote,
      openReminder,
      startAiOrganize,
    });
  });

  afterEach(() => {
    ui?.destroy?.();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  test('creates a class, adds a follow-up and completes it without changing ordinary Notes', async () => {
    const ordinaryNoteBefore = JSON.stringify(notes[0]);
    const ordinaryReminderBefore = JSON.stringify(reminders[0]);

    document.querySelector('[data-class-hub-create]').click();
    const createDialog = document.getElementById('createClassHubDialog');
    createDialog.querySelector('[name="className"]').value = 'Year 8 HPE';
    createDialog.querySelector('[data-class-hub-create-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector('[data-class-hub-heading]').textContent).toBe('Year 8 HPE');

    document.querySelector('[data-class-hub-add-follow-up]').click();
    const followDialog = document.getElementById('classFollowUpDialog');
    followDialog.querySelector('[name="followUpText"]').value = 'Speak to the two students next lesson';
    followDialog.querySelector('[data-class-follow-up-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const followUp = reminders.find((reminder) => reminder.metadata?.type === 'class-follow-up');
    expect(followUp).toMatchObject({
      text: 'Speak to the two students next lesson',
      category: 'School',
      metadata: {
        classHubId: 'class-hpe',
        classHubName: 'Year 8 HPE',
        suppressNotification: true,
      },
    });

    const checkbox = document.querySelector(`[data-class-hub-reminder-toggle="${followUp.id}"]`);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(followUp.completed).toBe(true);
    expect(document.querySelector('.class-hub-completed summary').textContent).toBe('Completed (1)');
    expect(JSON.stringify(notes.find((note) => note.id === 'ordinary-note'))).toBe(ordinaryNoteBefore);
    expect(JSON.stringify(reminders.find((reminder) => reminder.id === 'ordinary-reminder'))).toBe(ordinaryReminderBefore);
  });

  test('sets a dated generic check-list reminder without exposing a detailed follow-up', async () => {
    document.querySelector('[data-class-hub-open="class-existing"]').click();
    document.querySelector('[data-class-hub-add-cue]').click();

    const dialog = document.getElementById('classFollowUpDialog');
    expect(dialog.querySelector('[name="followUpText"]').value).toBe('Check Year 9 English class list');
    const targetDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const targetDateValue = [
      targetDate.getFullYear(),
      String(targetDate.getMonth() + 1).padStart(2, '0'),
      String(targetDate.getDate()).padStart(2, '0'),
    ].join('-');
    dialog.querySelector('[name="followUpDate"]').value = targetDateValue;
    dialog.querySelector('[name="followUpTime"]').value = '10:15';
    dialog.querySelector('[data-class-follow-up-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const cue = reminders.find((reminder) => reminder.metadata?.type === 'class-list-cue');
    expect(cue.text).toBe('Check Year 9 English class list');
    expect(cue.metadata).toMatchObject({
      classHubId: 'class-existing',
      suppressNotification: false,
    });
    const cueDate = new Date(cue.dueAt);
    expect(cueDate.getFullYear()).toBe(targetDate.getFullYear());
    expect(cueDate.getMonth()).toBe(targetDate.getMonth());
    expect(cueDate.getDate()).toBe(targetDate.getDate());
    expect(cueDate.getHours()).toBe(10);
  });

  test('opens saved Notes and Reminders through their canonical editors without a second note-creation action', () => {
    notes.push({
      id: 'class-note',
      title: 'Outdoor lesson',
      bodyText: 'Details',
      folderId: 'class-existing',
      updatedAt: '2026-08-11T09:00:00.000Z',
    });
    reminders.push({
      id: 'class-task',
      text: 'Speak with students',
      completed: false,
      createdAt: 3,
      metadata: { type: 'class-follow-up', classHubId: 'class-existing' },
    });
    ui.render();
    document.querySelector('[data-class-hub-open="class-existing"]').click();

    document.querySelector('[data-class-hub-note-open="class-note"]').click();
    document.querySelector('[data-class-hub-reminder-open="class-task"]').click();

    expect(openNote).toHaveBeenCalledWith('class-note');
    expect(openReminder).toHaveBeenCalledWith('class-task');
    expect(document.querySelector('[data-class-hub-full-note]')).toBeNull();
  });

  test('refreshes an open hub when Saved notes is reopened after an editor autosave', () => {
    document.querySelector('[data-class-hub-open="class-existing"]').click();
    expect(document.querySelector('.class-hub-detail-summary').textContent).toContain('0 notes');

    notes.push({
      id: 'autosaved-class-note',
      title: 'Outdoor lesson follow-up',
      bodyText: 'Speak with the students next lesson.',
      folderId: 'class-existing',
      updatedAt: '2026-08-11T11:00:00.000Z',
    });
    document.dispatchEvent(new CustomEvent('memoryCue:notesModeChanged', {
      detail: { mode: 'overview' },
    }));

    expect(document.querySelector('.class-hub-detail-summary').textContent).toContain('1 note');
    expect(document.querySelector('[data-class-hub-note-open="autosaved-class-note"]')).not.toBeNull();
  });

  test('starts a review-first note from the hub without instructions or another freeform input', () => {
    document.querySelector('[data-class-hub-open="class-existing"]').click();

    const action = document.querySelector('[data-class-hub-ai-organize]');
    const notesSection = action.closest('.class-hub-section');
    expect(action.textContent).toBe('Add note');
    expect(action.getAttribute('aria-label')).toBe('Add note to Year 9 English');
    expect(notesSection.querySelector('.class-hub-section-title').textContent).toBe('Notes');
    expect(document.querySelectorAll('[data-class-hub-ai-organize]')).toHaveLength(1);
    expect(document.querySelector('[data-class-hub-full-note]')).toBeNull();
    expect(document.querySelector('[data-class-thought-review-host="class-existing"]')).not.toBeNull();
    expect(document.querySelector('[data-class-thought-review-host="class-existing"]').childElementCount).toBe(0);
    expect(document.body.classList.contains('class-hub-open')).toBe(true);
    expect(document.querySelector('#classHubsPanel textarea')).toBeNull();

    action.click();

    expect(startAiOrganize).toHaveBeenCalledWith(expect.objectContaining({
      id: 'class-existing',
      name: 'Year 9 English',
      kind: 'class-hub',
    }));
  });

  test('announces hub renders and clears the global hub-open state on back', () => {
    const rendered = jest.fn();
    document.addEventListener('memoryCue:classHubRendered', rendered);

    document.querySelector('[data-class-hub-open="class-existing"]').click();
    expect(rendered).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: { hubId: 'class-existing' },
    }));
    expect(document.body.classList.contains('class-hub-open')).toBe(true);

    document.querySelector('[data-class-hub-back]').click();
    expect(rendered).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: { hubId: '' },
    }));
    expect(document.body.classList.contains('class-hub-open')).toBe(false);

    document.removeEventListener('memoryCue:classHubRendered', rendered);
  });

  test('shows the global New action state only while the Class Hub overview is visible', () => {
    const rendered = jest.fn();
    document.addEventListener('memoryCue:classHubRendered', rendered);
    document.querySelector('[data-class-hub-open="class-existing"]').click();
    expect(document.body.classList.contains('class-hub-open')).toBe(true);

    document.dispatchEvent(new CustomEvent('memoryCue:notesModeChanged', {
      detail: { mode: 'notebooks' },
    }));

    expect(document.body.classList.contains('class-hub-open')).toBe(false);
    expect(rendered).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: { hubId: '' },
    }));
    document.removeEventListener('memoryCue:classHubRendered', rendered);
  });

  test('stays in the hub with an inline status when a note cannot start', () => {
    startAiOrganize.mockReturnValue(false);
    document.querySelector('[data-class-hub-open="class-existing"]').click();

    document.querySelector('[data-class-hub-ai-organize]').click();

    expect(document.querySelector('[data-class-hub-heading]').textContent).toBe('Year 9 English');
    expect(document.querySelector('[data-class-hub-status]').textContent)
      .toBe('Another action is still running. Try again in a moment.');
  });

  test('returns to the requested hub with a live status and heading focus', async () => {
    document.getElementById('main').scrollTop = 240;
    document.dispatchEvent(new CustomEvent('memoryCue:classHubOpen', {
      detail: {
        hubId: 'class-existing',
        status: 'Saved: 1 note and 2 follow-ups.',
      },
    }));
    await flush();

    const heading = document.querySelector('[data-class-hub-heading]');
    expect(heading.textContent).toBe('Year 9 English');
    expect(document.querySelector('[data-class-hub-status]').textContent)
      .toBe('Saved: 1 note and 2 follow-ups.');
    expect(document.activeElement).toBe(heading);
    expect(document.getElementById('main').scrollTop).toBe(0);
  });

  test('places New note mode beside the one existing Capture input', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../mobile.html'), 'utf8');
    expect(html.match(/id="thinkingBarInput"/g)).toHaveLength(1);
    expect(html).toContain('id="classThoughtModeBar"');
    expect(html).toContain('New note:');
    expect(html).toContain('id="classThoughtExitButton"');
    expect(html).not.toContain('id="classThoughtInput"');
  });
});
