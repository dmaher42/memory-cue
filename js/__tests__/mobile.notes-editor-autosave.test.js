/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileNotesEditorUi() {
  const filePath = path.resolve(__dirname, '../../src/ui/mobileNotesEditorUi.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { initMobileNotesEditorUi };\n';

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    document,
    window,
    console,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = `
    <input id="noteTitleMobile" />
    <div id="notebook-editor-body" contenteditable="true"></div>
    <button id="noteSaveMobile" type="button">Save</button>
    <button id="newNoteMobile" type="button">New note</button>
  `;
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('body typing in a new note marks it changed so autosave can save it', () => {
  const { initMobileNotesEditorUi } = loadMobileNotesEditorUi();
  const titleInput = document.getElementById('noteTitleMobile');
  const editor = document.getElementById('notebook-editor-body');
  const saveButton = document.getElementById('noteSaveMobile');
  const newNoteButton = document.getElementById('newNoteMobile');

  let currentNoteId = null;
  let currentNoteIsNew = false;
  let currentNoteHasChanged = false;
  let notes = [];

  initMobileNotesEditorUi({
    saveButton,
    titleInput,
    scratchNotesEditorElement: editor,
    newNoteButton,
    debounce: (fn, delay = 0) => {
      let timeoutId;
      return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
      };
    },
    createNote: (title, bodyHtml, overrides = {}) => ({
      id: overrides.id || 'note-1',
      title: title || 'Untitled note',
      body: bodyHtml || '',
      bodyHtml: bodyHtml || '',
      bodyText: overrides.bodyText || bodyHtml || '',
      updatedAt: overrides.updatedAt || 'now',
      folderId: overrides.folderId || 'everyday',
    }),
    loadAllNotes: () => notes,
    saveAllNotes: (nextNotes) => {
      notes = nextNotes;
      return true;
    },
    getEditorBodyHtml: () => editor.innerHTML,
    getEditorBodyText: () => editor.textContent || '',
    getCurrentNoteId: () => currentNoteId,
    setCurrentNoteId: (value) => { currentNoteId = value; },
    getCurrentFolderId: () => 'all',
    getCurrentEditingNoteFolderId: () => 'everyday',
    setCurrentEditingNoteFolderId: () => {},
    getCurrentNoteIsNew: () => currentNoteIsNew,
    setCurrentNoteIsNew: (value) => { currentNoteIsNew = value; },
    getCurrentNoteHasChanged: () => currentNoteHasChanged,
    setCurrentNoteHasChanged: (value) => { currentNoteHasChanged = value; },
    hasMeaningfulContent: () => Boolean(titleInput.value.trim() || editor.textContent.trim()),
    hasUnsavedChanges: () => Boolean(editor.textContent.trim()),
    resetEditorScroll: () => {},
    setEditorValues: (note, { isNew = false } = {}) => {
      currentNoteId = note?.id || null;
      currentNoteIsNew = isNew;
      currentNoteHasChanged = false;
      titleInput.value = note?.title || '';
      editor.innerHTML = note?.bodyHtml || '';
    },
    updateListSelection: () => {},
    updateStoredSnapshot: () => {},
    refreshFromStorage: () => {},
    syncNoteFolderButtonLabel: () => {},
    updateToolbarState: () => {},
    handleListShortcuts: () => {},
    handleFormattingShortcuts: () => {},
  });

  newNoteButton.click();
  editor.textContent = 'Body-only journal thought';
  editor.dispatchEvent(new Event('input', { bubbles: true }));

  expect(currentNoteHasChanged).toBe(true);

  jest.advanceTimersByTime(1500);

  expect(notes).toHaveLength(1);
  expect(notes[0].bodyText).toBe('Body-only journal thought');
});
