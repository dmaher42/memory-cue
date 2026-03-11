/** @jest-environment jsdom */

const { beforeEach, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadNotesStorageModule() {
  const filePath = path.resolve(__dirname, '../modules/notes-storage.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+const/g, 'const')
    .replace(/export\s+\{\s*NOTES_STORAGE_KEY\s*\};/g, '')
    .replace(/export\s+\{\s*NOTES_STORAGE_KEY\s*\}/g, '')
    .replace(/export\s+\{[^}]*\};?/g, '');
  source += '\nmodule.exports = { createNote, loadAllNotes, saveAllNotes, linkEntries };\n';

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    localStorage,
    document,
    window,
    crypto: window.crypto,
    Date,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

beforeEach(() => {
  localStorage.clear();
});

test('createNote initializes links to an empty array', () => {
  const { createNote } = loadNotesStorageModule();

  const note = createNote('Idea', 'Dodgeball zones');

  expect(Array.isArray(note.links)).toBe(true);
  expect(note.links).toHaveLength(0);
});

test('linkEntries stores links on both source and target notes', () => {
  const { createNote, saveAllNotes, loadAllNotes, linkEntries } = loadNotesStorageModule();

  const source = createNote('Idea', 'Dodgeball zones', { id: 'chaos-ball' });
  const target = createNote('Idea', 'Bench ball', { id: 'bench-ball' });
  saveAllNotes([source, target]);

  const linked = linkEntries('chaos-ball', 'bench-ball');

  expect(linked).toBe(true);

  const [updatedSource, updatedTarget] = loadAllNotes();
  expect(updatedSource.links).toContain('bench-ball');
  expect(updatedTarget.links).toContain('chaos-ball');
});
