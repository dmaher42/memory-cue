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
  source += '\nmodule.exports = { CLASS_HUB_FOLDER_KIND, assignNoteToFolder, createClassHubFolder, getClassHubFolders, getFolderNameById, getFolders, isClassHubFolder, loadAllNotes, saveFolders };\n';

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    localStorage,
    document,
    window,
    CustomEvent: window.CustomEvent,
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

test('getFolders always includes the core notebooks', () => {
  const { getFolders } = loadNotesStorageModule();

  const folders = getFolders();

  expect(Array.isArray(folders)).toBe(true);
  expect(folders.some((folder) => folder?.name === 'School')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Coaching')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Everyday')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Archive')).toBe(true);
});

test('saveFolders keeps core notebooks in storage', () => {
  const { saveFolders, getFolders } = loadNotesStorageModule();

  const saved = saveFolders([{ id: 'school', name: 'School', order: 0 }]);

  expect(saved).toBe(true);
  const folders = getFolders();
  expect(folders.some((folder) => folder?.name === 'School')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Coaching')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Everyday')).toBe(true);
  expect(folders.some((folder) => folder?.name === 'Archive')).toBe(true);
});

test('saveFolders announces same-tab folder changes', () => {
  const { saveFolders } = loadNotesStorageModule();
  const listener = jest.fn();
  document.addEventListener('memoryCue:foldersUpdated', listener);

  saveFolders([{ id: 'class-year-8-hpe', name: 'Year 8 HPE', kind: 'class-hub' }]);

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0][0].detail.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'class-year-8-hpe',
      name: 'Year 8 HPE',
      kind: 'class-hub',
    }),
  ]));
  document.removeEventListener('memoryCue:foldersUpdated', listener);
});

test('createClassHubFolder persists a reusable Notes folder record', () => {
  const {
    CLASS_HUB_FOLDER_KIND,
    createClassHubFolder,
    getClassHubFolders,
    isClassHubFolder,
  } = loadNotesStorageModule();

  const result = createClassHubFolder('  Year 8 HPE  ', {
    id: 'class-year-8-hpe',
    metadata: { colour: 'teal' },
  });

  expect(result.status).toBe('created');
  expect(result.folder).toEqual(expect.objectContaining({
    id: 'class-year-8-hpe',
    name: 'Year 8 HPE',
    kind: CLASS_HUB_FOLDER_KIND,
    colour: 'teal',
  }));
  expect(isClassHubFolder(result.folder)).toBe(true);
  expect(getClassHubFolders()).toEqual([result.folder]);
});

test('createClassHubFolder reports invalid, duplicate, and storage errors', () => {
  const { createClassHubFolder } = loadNotesStorageModule();

  expect(createClassHubFolder('   ')).toEqual({ status: 'invalid', folder: null });

  const created = createClassHubFolder('Year 8 HPE', { id: 'class-year-8-hpe' });
  expect(created.status).toBe('created');

  const duplicate = createClassHubFolder('year 8 hpe');
  expect(duplicate.status).toBe('duplicate');
  expect(duplicate.folder.id).toBe('class-year-8-hpe');

  const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  expect(createClassHubFolder('Year 9 HPE')).toEqual({ status: 'error', folder: null });
  setItemSpy.mockRestore();
});

test('createClassHubFolder upgrades an existing custom folder without moving its notes', () => {
  const { createClassHubFolder, getFolders, saveFolders } = loadNotesStorageModule();
  saveFolders([
    { id: 'existing-hpe', name: 'Year 8 HPE', order: 0, colour: 'blue' },
  ]);

  const result = createClassHubFolder('Year 8 HPE');

  expect(result).toEqual(expect.objectContaining({ status: 'created', upgraded: true }));
  expect(result.folder).toEqual(expect.objectContaining({
    id: 'existing-hpe',
    name: 'Year 8 HPE',
    kind: 'class-hub',
    colour: 'blue',
  }));
  expect(getFolders().filter((folder) => folder.name === 'Year 8 HPE')).toHaveLength(1);
});

test('createClassHubFolder does not convert a standard Notes folder', () => {
  const { createClassHubFolder } = loadNotesStorageModule();

  const result = createClassHubFolder('School');

  expect(result.status).toBe('reserved');
  expect(result.folder).toEqual(expect.objectContaining({ id: 'school', name: 'School' }));
});

test('saveFolders preserves class-hub and future folder metadata', () => {
  const { getFolders, saveFolders } = loadNotesStorageModule();

  const saved = saveFolders([
    {
      id: 'class-year-8-hpe',
      name: 'Year 8 HPE',
      order: 0,
      kind: 'class-hub',
      colour: 'teal',
      preferences: { quickThoughts: true },
    },
  ]);

  expect(saved).toBe(true);
  const classHub = getFolders().find((folder) => folder.id === 'class-year-8-hpe');
  expect(classHub).toEqual({
    id: 'class-year-8-hpe',
    name: 'Year 8 HPE',
    order: 0,
    kind: 'class-hub',
    colour: 'teal',
    preferences: { quickThoughts: true },
  });
});

test('notes can be moved to no category without being forced into Everyday', () => {
  const { assignNoteToFolder, getFolderNameById, loadAllNotes } = loadNotesStorageModule();
  localStorage.setItem('memoryCueNotes', JSON.stringify([{
    id: 'note-1',
    title: 'Loose thought',
    body: 'Remember this',
    bodyHtml: 'Remember this',
    bodyText: 'Remember this',
    folderId: 'school',
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T01:00:00.000Z',
  }]));

  expect(assignNoteToFolder('note-1', null)).toBe(true);
  expect(loadAllNotes()[0].folderId).toBeNull();
  expect(getFolderNameById(null)).toBe('No category');
  expect(getFolderNameById('unsorted')).toBe('No category');
  expect(getFolderNameById('deleted-category')).toBe('No category');
});
