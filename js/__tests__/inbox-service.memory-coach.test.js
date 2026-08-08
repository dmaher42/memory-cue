/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadInboxService(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/services/inboxService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += `
module.exports = {
  INBOX_STORAGE_KEY,
  getInboxEntries,
  isMemoryCoachInboxEntry,
  removeInboxEntry,
  replaceInboxEntries,
  saveInboxEntry,
  updateMemoryCoachInboxEntry,
};`;

  const normalizeMemory = (entry = {}, fallback = {}) => {
    const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now();
    return {
      id: entry.id || 'generated-id',
      text: typeof entry.text === 'string' ? entry.text.trim() : '',
      type: 'inbox',
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      createdAt,
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : createdAt,
      source: entry.source || fallback.source || 'capture',
      entryPoint: entry.entryPoint || fallback.entryPoint || 'capture',
      pendingSync: entry.pendingSync !== false,
    };
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Math,
    JSON,
    Promise,
    localStorage,
    document,
    CustomEvent: window.CustomEvent,
    crypto: { randomUUID: () => `generated-${Date.now()}` },
    normalizeMemory,
    upsertInboxEntry: overrides.upsertInboxEntry || jest.fn(() => Promise.resolve()),
    deleteInboxEntry: overrides.deleteInboxEntry || jest.fn(() => Promise.resolve()),
    indexSourceEmbedding: overrides.indexSourceEmbedding || jest.fn(() => Promise.resolve()),
    saveMemory: overrides.saveMemory || jest.fn(() => Promise.resolve()),
  });
  context.globalThis = context;
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const normalEntry = {
  id: 'normal',
  text: 'Ordinary Inbox thought',
  type: 'inbox',
  tags: [],
  createdAt: 10,
  updatedAt: 10,
  source: 'capture',
  parsedType: 'unknown',
  entryPoint: 'test.seed',
  pendingSync: true,
  metadata: {},
  customStatus: 'preserve-me',
};

const coachEntry = {
  id: 'coach',
  text: 'evasive: avoiding a direct answer',
  type: 'inbox',
  createdAt: 20,
  updatedAt: 20,
  pendingSync: true,
  metadata: {
    type: 'memory-card',
    memoryCoach: {
      prompt: 'Someone avoiding a direct answer',
      answer: 'evasive',
    },
  },
};

beforeEach(() => {
  localStorage.clear();
});

test('normal Inbox readers hide coach cards while the explicit full reader retains them', () => {
  const service = loadInboxService();
  const malformedCoachEntry = {
    id: 'malformed-coach',
    text: 'Incomplete practice data',
    metadata: { type: 'memory-card' },
  };
  localStorage.setItem('memoryCueInbox', JSON.stringify([normalEntry, coachEntry, malformedCoachEntry]));

  expect(service.getInboxEntries().map((entry) => entry.id)).toEqual(['normal']);
  expect(service.getInboxEntries({ includeMemoryCoach: true }).map((entry) => entry.id))
    .toEqual(['normal', 'coach', 'malformed-coach']);
});

test('normal save, remove, and replacement paths preserve hidden coach cards', () => {
  const service = loadInboxService();
  localStorage.setItem('memoryCueInbox', JSON.stringify([coachEntry]));

  const saved = service.saveInboxEntry({ id: 'new-normal', text: 'New normal item' });
  expect(saved.id).toBe('new-normal');
  expect(service.getInboxEntries({ includeMemoryCoach: true }).map((entry) => entry.id))
    .toEqual(['new-normal', 'coach']);

  expect(service.removeInboxEntry('new-normal')).toBe(true);
  expect(service.getInboxEntries({ includeMemoryCoach: true }).map((entry) => entry.id))
    .toEqual(['coach']);

  service.replaceInboxEntries([normalEntry]);
  expect(service.getInboxEntries({ includeMemoryCoach: true }).map((entry) => entry.id))
    .toEqual(['normal', 'coach']);
});

test('a coach update changes only its Inbox entry and leaves Notes and Reminders byte-for-byte untouched', () => {
  const service = loadInboxService();
  const notesBytes = JSON.stringify([{ id: 'note-1', title: 'Untouched note' }]);
  const remindersBytes = JSON.stringify([{ id: 'reminder-1', title: 'Untouched reminder' }]);
  const scheduledBytes = JSON.stringify({ 'reminder-1': { dueAt: 123 } });
  localStorage.setItem('memoryCueNotes', notesBytes);
  localStorage.setItem('memoryCue:offlineReminders', remindersBytes);
  localStorage.setItem('scheduledReminders', scheduledBytes);
  localStorage.setItem('memoryCueInbox', JSON.stringify([normalEntry, coachEntry]));

  const updated = service.updateMemoryCoachInboxEntry({
    ...coachEntry,
    updatedAt: 99,
    metadata: {
      ...coachEntry.metadata,
      memoryCoach: { ...coachEntry.metadata.memoryCoach, reviewCount: 1 },
    },
  });

  expect(updated).toMatchObject({ id: 'coach', updatedAt: 99, pendingSync: true });
  expect(service.getInboxEntries({ includeMemoryCoach: true })
    .find((entry) => entry.id === 'coach').metadata.memoryCoach.reviewCount).toBe(1);
  expect(JSON.parse(localStorage.getItem('memoryCueInbox'))
    .find((entry) => entry.id === 'normal')).toEqual(normalEntry);
  expect(localStorage.getItem('memoryCueNotes')).toBe(notesBytes);
  expect(localStorage.getItem('memoryCue:offlineReminders')).toBe(remindersBytes);
  expect(localStorage.getItem('scheduledReminders')).toBe(scheduledBytes);
});

test('coach cards sync to Inbox but are not embedded or copied into assistant memory', () => {
  const indexSourceEmbedding = jest.fn(() => Promise.resolve());
  const saveMemory = jest.fn(() => Promise.resolve());
  const upsertInboxEntry = jest.fn(() => Promise.resolve());
  const service = loadInboxService({ indexSourceEmbedding, saveMemory, upsertInboxEntry });

  service.saveInboxEntry(coachEntry);

  expect(upsertInboxEntry).toHaveBeenCalledTimes(1);
  expect(indexSourceEmbedding).not.toHaveBeenCalled();
  expect(saveMemory).not.toHaveBeenCalled();
});

test('a local storage failure is returned to the caller instead of reporting a successful save', () => {
  const service = loadInboxService();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('storage full');
  });

  expect(service.saveInboxEntry(coachEntry)).toBeNull();
  expect(service.getInboxEntries({ includeMemoryCoach: true })).toHaveLength(0);

  setItem.mockRestore();
  warn.mockRestore();
});

test('a full backup restore marks coach cards pending and starts their single-entry sync', () => {
  const upsertInboxEntry = jest.fn(() => Promise.resolve());
  const service = loadInboxService({ upsertInboxEntry });

  service.replaceInboxEntries([coachEntry], {
    includeMemoryCoach: true,
    syncMemoryCoach: true,
  });

  const [restored] = service.getInboxEntries({ includeMemoryCoach: true });
  expect(restored.pendingSync).toBe(true);
  expect(restored.updatedAt).toBeGreaterThan(coachEntry.updatedAt);
  expect(upsertInboxEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach' }));
});
