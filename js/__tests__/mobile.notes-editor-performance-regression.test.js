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
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document,
    window,
    console,
    HTMLElement: window.HTMLElement,
    setTimeout,
    clearTimeout,
  }, { filename: filePath });
  return module.exports;
}

const debounce = (fn, delay = 0) => {
  let timeoutId = null;
  const debounced = (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, delay);
  };
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };
  return debounced;
};

function createHarness({ updateToolbarState = () => {} } = {}) {
  const titleInput = document.getElementById('noteTitleMobile');
  const editor = document.getElementById('notebook-editor-body');
  const saveButton = document.getElementById('noteSaveMobile');
  let changed = false;
  let notes = [{
    id: 'note-1',
    title: 'Existing note',
    body: '<p>Old body</p>',
    bodyHtml: '<p>Old body</p>',
    bodyText: 'Old body',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    folderId: 'everyday',
  }];
  const saveAllNotes = jest.fn((nextNotes) => {
    notes = nextNotes;
    changed = false;
    return true;
  });

  titleInput.value = 'Existing note';
  editor.innerHTML = '<p>Old body</p>';

  const { initMobileNotesEditorUi } = loadMobileNotesEditorUi();
  initMobileNotesEditorUi({
    saveButton,
    titleInput,
    scratchNotesEditorElement: editor,
    debounce,
    createNote: (title, bodyHtml, overrides = {}) => ({
      id: overrides.id || 'note-1',
      title,
      body: bodyHtml,
      bodyHtml,
      bodyText: overrides.bodyText || '',
      createdAt: overrides.createdAt || '2026-07-15T00:00:00.000Z',
      updatedAt: overrides.updatedAt || '2026-07-15T00:00:00.000Z',
      folderId: overrides.folderId || 'everyday',
    }),
    loadAllNotes: () => notes,
    saveAllNotes,
    getEditorBodyHtml: () => editor.innerHTML,
    getEditorBodyText: () => editor.textContent || '',
    getCurrentNoteId: () => 'note-1',
    getCurrentEditingNoteFolderId: () => 'everyday',
    getCurrentNoteIsNew: () => false,
    getCurrentNoteHasChanged: () => changed,
    setCurrentNoteHasChanged: (value) => { changed = value; },
    hasMeaningfulContent: () => true,
    hasUnsavedChanges: () => changed,
    updateStoredSnapshot: () => {},
    refreshFromStorage: () => {},
    updateToolbarState,
  });

  return { titleInput, editor, saveAllNotes };
}

let originalRequestAnimationFrame;

beforeEach(() => {
  jest.useFakeTimers();
  originalRequestAnimationFrame = window.requestAnimationFrame;
  document.body.innerHTML = `
    <input id="noteTitleMobile" />
    <div id="notebook-editor-body" contenteditable="true"></div>
    <button id="noteSaveMobile" type="button">Save</button>
  `;
});

afterEach(() => {
  jest.useRealTimers();
  window.requestAnimationFrame = originalRequestAnimationFrame;
  document.body.innerHTML = '';
});

test('moving from the title into the body does not force a synchronous notebook save', () => {
  const { titleInput, saveAllNotes } = createHarness();

  titleInput.value = 'Updated title';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  titleInput.dispatchEvent(new Event('blur'));

  expect(saveAllNotes).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1499);
  expect(saveAllNotes).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(saveAllNotes).toHaveBeenCalledTimes(1);
});

test('backgrounding the PWA flushes a pending local autosave once', () => {
  const { titleInput, saveAllNotes } = createHarness();
  const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  titleInput.value = 'Saved before suspension';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));

  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(saveAllNotes).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pagehide'));
    jest.advanceTimersByTime(1500);
    expect(saveAllNotes).toHaveBeenCalledTimes(1);
  } finally {
    if (originalVisibilityState) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityState);
    }
  }
});

test('input and keyup bursts coalesce toolbar inspection to one animation frame', () => {
  window.requestAnimationFrame = (callback) => setTimeout(callback, 16);
  const updateToolbarState = jest.fn();
  const { editor } = createHarness({ updateToolbarState });

  for (let index = 0; index < 20; index += 1) {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('keyup', { bubbles: true }));
  }

  expect(updateToolbarState).not.toHaveBeenCalled();
  jest.advanceTimersByTime(16);
  expect(updateToolbarState).toHaveBeenCalledTimes(1);
});
