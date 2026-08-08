/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load firestoreSyncService with ES imports stripped to unit-test the pure merge helper.
function loadMergeHelper() {
  const filePath = path.resolve(__dirname, '../../src/services/firestoreSyncService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { mergeRemoteWithLocal };\n';

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
    Map,
    Boolean,
    JSON,
    Set,
    globalThis: {},
    window: undefined,
    localStorage: undefined,
    document: undefined,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports.mergeRemoteWithLocal;
}

const mergeRemoteWithLocal = loadMergeHelper();
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

test('a just-typed local chat message survives a snapshot that has not caught up', () => {
  const local = [
    { id: 'm1', content: 'hello', createdAt: '2026-06-17T10:00:00.000Z', pendingSync: false },
    { id: 'm2', content: 'just typed this', createdAt: '2026-06-17T10:05:00.000Z', pendingSync: true },
  ];
  const remoteSnapshot = [
    { id: 'm1', content: 'hello', createdAt: '2026-06-17T10:00:00.000Z', pendingSync: false },
  ];

  const merged = byId(mergeRemoteWithLocal(local, remoteSnapshot, 'createdAt'));
  expect(merged.m2).toBeDefined();
  expect(merged.m2.content).toBe('just typed this');
});

test('remote wins for items with no unsynced local changes', () => {
  const local = [{ id: 'm1', content: 'old', createdAt: '2026-06-17T10:00:00.000Z', pendingSync: false }];
  const remote = [{ id: 'm1', content: 'new from another device', createdAt: '2026-06-17T11:00:00.000Z', pendingSync: false }];
  const merged = byId(mergeRemoteWithLocal(local, remote, 'createdAt'));
  expect(merged.m1.content).toBe('new from another device');
});

test('an equal-timestamp remote copy acknowledges and clears a pending local write', () => {
  const local = [{
    id: 'coach-1',
    text: 'local pending card',
    updatedAt: '2026-06-17T11:00:00.000Z',
    pendingSync: true,
  }];
  const remote = [{
    id: 'coach-1',
    text: 'confirmed remote card',
    updatedAt: '2026-06-17T11:00:00.000Z',
    pendingSync: false,
  }];

  const merged = byId(mergeRemoteWithLocal(local, remote, 'updatedAt'));
  expect(merged['coach-1'].text).toBe('confirmed remote card');
  expect(merged['coach-1'].pendingSync).toBe(false);
});

test('remote-only items are added', () => {
  const merged = byId(mergeRemoteWithLocal([], [{ id: 'm9', content: 'from elsewhere', createdAt: '2026-06-17T09:00:00.000Z' }], 'createdAt'));
  expect(merged.m9).toBeDefined();
});

test('a synced local item absent from remote is treated as deleted, not resurrected', () => {
  const local = [{ id: 'm1', content: 'deleted elsewhere', createdAt: '2026-06-17T10:00:00.000Z', pendingSync: false }];
  const merged = mergeRemoteWithLocal(local, [], 'createdAt');
  expect(merged).toHaveLength(0);
});

function loadServiceForAppend(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/services/firestoreSyncService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { appendChatMessage };\n';

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
    Map,
    Set,
    Boolean,
    JSON,
    crypto: { randomUUID: () => 'generated-id' },
    getFirebaseContext: overrides.getFirebaseContext,
    requireUid: (value) => value,
    localStorage: overrides.localStorage,
    document: undefined,
    window: undefined,
    globalThis: {},
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports.appendChatMessage;
}

test('appendChatMessage pushes one message and does NOT rewrite the local chat cache', async () => {
  const setDocCalls = [];
  const setItemKeys = [];
  const appendChatMessage = loadServiceForAppend({
    getFirebaseContext: async () => ({
      db: {},
      doc: (...args) => ({ args }),
      setDoc: async (ref, data) => { setDocCalls.push(data); },
    }),
    localStorage: {
      getItem: () => null,
      setItem: (key) => { setItemKeys.push(key); },
      removeItem: () => {},
    },
  });

  await appendChatMessage({ id: 'm1', role: 'assistant', content: 'Saved note.' }, 'default', { uid: 'u1' });

  expect(setDocCalls).toHaveLength(1);
  expect(setDocCalls[0].id).toBe('m1');
  // The local cache must be left untouched so the message keeps its pendingSync flag.
  expect(setItemKeys).not.toContain('memoryCueChatHistory');
});

function loadServiceForInboxDelete(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/services/firestoreSyncService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { deleteInboxEntry };\n';

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
    Map,
    Set,
    Boolean,
    JSON,
    Promise,
    globalThis: {},
    document: undefined,
    window: undefined,
    localStorage: overrides.localStorage,
    getFirebaseContext: overrides.getFirebaseContext,
    requireUid: (value) => value,
    normalizeMemory: (entry = {}) => entry,
    normalizeMemoryList: (items) => items,
    normalizeReminderList: (items) => items,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports.deleteInboxEntry;
}

test('offline Inbox deletion preserves a pending hidden Memory Coach card', async () => {
  const pendingCard = {
    id: 'coach-offline',
    text: 'evasive: avoiding a direct answer',
    createdAt: 10,
    updatedAt: 20,
    pendingSync: true,
    metadata: {
      type: 'memory-card',
      memoryCoach: { answer: 'evasive' },
    },
  };
  const storage = new Map([
    ['memoryCueInbox', JSON.stringify([
      { id: 'ordinary', text: 'Process me', pendingSync: false, customStatus: 'keep-fields' },
      pendingCard,
    ])],
    ['memoryCueNotes', '[{"id":"note-1"}]'],
    ['memoryCue:offlineReminders', '[{"id":"reminder-1"}]'],
    ['scheduledReminders', '{"reminder-1":{"dueAt":123}}'],
  ]);
  const protectedBefore = {
    notes: storage.get('memoryCueNotes'),
    reminders: storage.get('memoryCue:offlineReminders'),
    scheduled: storage.get('scheduledReminders'),
  };
  const deleteInboxEntry = loadServiceForInboxDelete({
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    getFirebaseContext: async () => null,
  });

  await deleteInboxEntry('ordinary');

  expect(JSON.parse(storage.get('memoryCueInbox'))).toEqual([pendingCard]);
  expect(JSON.parse(storage.get('memoryCueInbox'))[0].pendingSync).toBe(true);
  expect(storage.get('memoryCueNotes')).toBe(protectedBefore.notes);
  expect(storage.get('memoryCue:offlineReminders')).toBe(protectedBefore.reminders);
  expect(storage.get('scheduledReminders')).toBe(protectedBefore.scheduled);
});

function loadServiceForInboxSubscription(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/services/firestoreSyncService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { subscribeToInboxChanges };\n';

  const normalizeMemory = (entry = {}) => ({
    id: entry.id,
    text: entry.text,
    type: 'inbox',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    source: entry.source || 'capture',
    entryPoint: entry.entryPoint || 'test',
    pendingSync: entry.pendingSync === true,
  });
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
    Map,
    Set,
    Boolean,
    JSON,
    Promise,
    globalThis: {},
    document: undefined,
    window: undefined,
    localStorage: overrides.localStorage,
    getFirebaseContext: overrides.getFirebaseContext,
    requireUid: (value) => value,
    normalizeMemory,
    normalizeMemoryList: (items) => items,
    normalizeReminderList: (items) => items,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports.subscribeToInboxChanges;
}

test('Inbox sign-in flush uploads only pending local entries and does not resurrect synced deletions', async () => {
  const localEntries = [
    { id: 'pending-card', text: 'practice', createdAt: 10, updatedAt: 20, pendingSync: true },
    { id: 'synced-deleted', text: 'deleted elsewhere', createdAt: 5, updatedAt: 5, pendingSync: false },
  ];
  const writes = [];
  const storageWrites = [];
  const subscribeToInboxChanges = loadServiceForInboxSubscription({
    localStorage: {
      getItem: (key) => key === 'memoryCueInbox' ? JSON.stringify(localEntries) : null,
      setItem: (key, value) => { storageWrites.push([key, value]); },
      removeItem: () => {},
    },
    getFirebaseContext: async () => ({
      db: {},
      collection: () => ({}),
      query: (value) => value,
      orderBy: () => ({}),
      getDocs: async () => ({ docs: [] }),
      doc: (...args) => ({ args }),
      setDoc: async (_ref, data) => { writes.push(data); },
      onSnapshot: () => () => {},
    }),
  });

  await subscribeToInboxChanges({ uid: 'user-1' });

  expect(writes.map((entry) => entry.id)).toEqual(['pending-card']);
  expect(writes.map((entry) => entry.id)).not.toContain('synced-deleted');
  expect(storageWrites).toHaveLength(0);
});

test('Inbox sign-in flush leaves pending local data intact when Firebase is unavailable', async () => {
  const raw = JSON.stringify([
    { id: 'pending-card', text: 'practice', createdAt: 10, updatedAt: 20, pendingSync: true },
  ]);
  const storageWrites = [];
  const subscribeToInboxChanges = loadServiceForInboxSubscription({
    localStorage: {
      getItem: (key) => key === 'memoryCueInbox' ? raw : null,
      setItem: (key, value) => { storageWrites.push([key, value]); },
      removeItem: () => {},
    },
    getFirebaseContext: async () => null,
  });

  await subscribeToInboxChanges({ uid: 'user-1' });

  expect(storageWrites).toHaveLength(0);
});
