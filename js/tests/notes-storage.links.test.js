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
    .replace(/export\s+\{[^}]*\};?/g, '')
    // Keep this storage unit test focused on the canonical Notes record. The derived
    // memory/embedding mirrors use dynamic imports that are covered by their own tests.
    .replace('syncNoteToMemoryService(note, normalizedPayload);', '')
    .replace('ensureNoteEmbedding(note, [note, ...notes], options);', '');
  source += '\nmodule.exports = { createAndSaveNote, createNote, loadAllNotes, saveAllNotes, setRemoteSyncHandler, linkEntries };\n';

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

test('createAndSaveNote keeps a programmatic class note pending until remote sync confirms it', () => {
  const {
    createAndSaveNote,
    loadAllNotes,
    setRemoteSyncHandler,
  } = loadNotesStorageModule();
  const remoteSyncHandler = jest.fn();
  setRemoteSyncHandler(remoteSyncHandler);

  const note = createAndSaveNote({
    title: 'Outdoor lesson follow-up',
    text: 'Speak to the students next lesson.',
    folderId: 'class-year-8-hpe',
    source: 'assistant',
  });

  expect(note).toMatchObject({
    folderId: 'class-year-8-hpe',
    pendingSync: true,
  });
  expect(loadAllNotes()).toEqual([
    expect.objectContaining({
      id: note.id,
      folderId: 'class-year-8-hpe',
      pendingSync: true,
    }),
  ]);
  expect(remoteSyncHandler).toHaveBeenCalledTimes(1);
  expect(remoteSyncHandler).toHaveBeenCalledWith([
    expect.objectContaining({ id: note.id, pendingSync: true }),
  ]);
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

test('canonical bodyText avoids reparsing every stored note body', () => {
  const { loadAllNotes, saveAllNotes } = loadNotesStorageModule();
  localStorage.setItem('memoryCueNotes', JSON.stringify([
    {
      id: 'large-note',
      title: 'Planning',
      body: '<p>Already indexed planning text</p>',
      bodyHtml: '<p>Already indexed planning text</p>',
      bodyText: 'Already indexed planning text',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      semanticEmbedding: [0.1, 0.2, 0.3],
    },
    {
      id: 'formatted-note',
      title: 'Formatted planning',
      body: '<p><strong>Plan</strong> tomorrow</p><ul><li>Pack bag</li><li>Call school</li></ul>',
      bodyHtml: '<p><strong>Plan</strong> tomorrow</p><ul><li>Pack bag</li><li>Call school</li></ul>',
      bodyText: 'Plan tomorrow Pack bag Call school',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    },
  ]));

  const createElementSpy = jest.spyOn(document, 'createElement');
  try {
    const notes = loadAllNotes();
    expect(notes[0].bodyText).toBe('Already indexed planning text');
    expect(notes[1].bodyText).toBe('Plan tomorrow Pack bag Call school');
    expect(saveAllNotes(notes, { skipNotesUpdatedEvent: true, skipRemoteSync: true })).toBe(true);
    expect(createElementSpy).not.toHaveBeenCalled();
  } finally {
    createElementSpy.mockRestore();
  }
});

test('stale bodyText is repaired when bodyHtml was changed by an older writer', () => {
  const { loadAllNotes } = loadNotesStorageModule();
  localStorage.setItem('memoryCueNotes', JSON.stringify([
    {
      id: 'updated-elsewhere',
      title: 'Planning',
      body: '<p>New planning details</p>',
      bodyHtml: '<p>New planning details</p>',
      bodyText: 'Old planning details',
      semanticEmbedding: [0.8, 0.2],
      keywords: ['old', 'planning', 'details'],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
  ]));

  const notes = loadAllNotes();

  expect(notes[0].bodyText).toBe('New planning details');
  expect(notes[0].keywords).toEqual(expect.arrayContaining(['new', 'planning', 'details']));
  expect(notes[0].keywords).not.toContain('old');
  expect(notes[0].semanticEmbedding).toBeNull();
});

test('an explicitly cleared body does not retain stale searchable text', () => {
  const { loadAllNotes } = loadNotesStorageModule();
  localStorage.setItem('memoryCueNotes', JSON.stringify([
    {
      id: 'cleared-note',
      title: 'Cleared planning',
      body: '',
      bodyHtml: '',
      bodyText: 'Old private planning details',
      semanticEmbedding: [0.6, 0.4],
      keywords: ['old', 'private', 'planning', 'details'],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    },
  ]));

  const notes = loadAllNotes();

  expect(notes[0].body).toBe('');
  expect(notes[0].bodyHtml).toBe('');
  expect(notes[0].bodyText).toBe('');
  expect(notes[0].keywords).not.toEqual(expect.arrayContaining(['old', 'private', 'details']));
  expect(notes[0].semanticEmbedding).toBeNull();
});
