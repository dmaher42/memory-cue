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
  source += '\nmodule.exports = { getFolders, saveFolders };\n';

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

test('getFolders always includes Lesson – Reflections', () => {
  const { getFolders } = loadNotesStorageModule();

  const folders = getFolders();

  expect(Array.isArray(folders)).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Lesson – Reflections')).toBe(true);
});

test('saveFolders keeps Lesson – Reflections in storage', () => {
  const { saveFolders, getFolders } = loadNotesStorageModule();

  const saved = saveFolders([{ id: 'unsorted', name: 'Unsorted', order: 0 }]);

  expect(saved).toBe(true);
  const folders = getFolders();
  expect(folders.some((folder) => folder?.name === 'Lesson – Reflections')).toBe(true);
});
