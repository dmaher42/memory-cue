/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load notes-sync.js with its ES imports stripped so we can unit-test the pure merge helper
// without pulling in the Firebase / storage modules it depends on at runtime.
function loadNotesSync(overrides = {}) {
  const filePath = path.resolve(__dirname, '../modules/notes-sync.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { initNotesSync, mergeRemoteIntoLocal };\n';

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
    setTimeout,
    clearTimeout,
    ...overrides,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const { mergeRemoteIntoLocal } = loadNotesSync();

const byId = (notes) => Object.fromEntries(notes.map((note) => [note.id, note]));

test('remote wins when local has no unsynced edits', () => {
  const local = [{ id: 'a', bodyText: 'old', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: false }];
  const remote = [{ id: 'a', bodyText: 'new', updatedAt: '2026-01-02T00:00:00.000Z', pendingSync: false }];

  const merged = byId(mergeRemoteIntoLocal(local, remote));
  expect(merged.a.bodyText).toBe('new');
});

test('a freshly autosaved local note is not reverted by an older remote snapshot', () => {
  const local = [{ id: 'a', bodyText: 'just typed', updatedAt: '2026-01-03T00:00:00.000Z', pendingSync: true }];
  const remote = [{ id: 'a', bodyText: 'stale remote', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: false }];

  const merged = byId(mergeRemoteIntoLocal(local, remote));
  expect(merged.a.bodyText).toBe('just typed');
});

test('a newer remote edit still wins over an older pending local note', () => {
  const local = [{ id: 'a', bodyText: 'local pending', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: true }];
  const remote = [{ id: 'a', bodyText: 'newer remote', updatedAt: '2026-01-05T00:00:00.000Z', pendingSync: false }];

  const merged = byId(mergeRemoteIntoLocal(local, remote));
  expect(merged.a.bodyText).toBe('newer remote');
});

test('notes that exist only on another device are added', () => {
  const local = [{ id: 'a', bodyText: 'mine', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: false }];
  const remote = [
    { id: 'a', bodyText: 'mine', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: false },
    { id: 'b', bodyText: 'from other device', updatedAt: '2026-01-02T00:00:00.000Z', pendingSync: false },
  ];

  const merged = byId(mergeRemoteIntoLocal(local, remote));
  expect(merged.b.bodyText).toBe('from other device');
});

test('a local-only note with unsynced edits is kept (not yet pushed)', () => {
  const local = [{ id: 'a', bodyText: 'new note not pushed yet', updatedAt: '2026-01-03T00:00:00.000Z', pendingSync: true }];
  const remote = [];

  const merged = byId(mergeRemoteIntoLocal(local, remote));
  expect(merged.a.bodyText).toBe('new note not pushed yet');
});

test('a synced local note absent from remote is treated as deleted and not resurrected', () => {
  const local = [{ id: 'a', bodyText: 'deleted elsewhere', updatedAt: '2026-01-01T00:00:00.000Z', pendingSync: false }];
  const remote = [];

  const merged = mergeRemoteIntoLocal(local, remote);
  expect(merged).toHaveLength(0);
});

test('signing out cancels deferred memory work from the previous user', async () => {
  let idleCallback = null;
  const stopSubscription = jest.fn();
  const memoryCacheSyncHandler = jest.fn();
  const windowStub = {
    addEventListener: jest.fn(),
    requestIdleCallback: jest.fn((callback) => {
      idleCallback = callback;
      return 17;
    }),
    cancelIdleCallback: jest.fn(),
  };
  const remoteNotes = [{
    id: 'remote-note',
    bodyText: 'Private note from user A',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }];
  const { initNotesSync } = loadNotesSync({
    window: windowStub,
    loadAllNotes: jest.fn(() => []),
    saveAllNotes: jest.fn(() => true),
    setRemoteSyncHandler: jest.fn(),
    syncNotes: jest.fn(async () => remoteNotes),
    subscribeToNotesChanges: jest.fn(async () => stopSubscription),
  });
  const sync = initNotesSync({ memoryCacheSyncHandler });

  await sync.handleSessionChange({ id: 'user-a' });
  expect(windowStub.requestIdleCallback).toHaveBeenCalledTimes(1);
  expect(typeof idleCallback).toBe('function');

  await sync.handleSessionChange(null);
  expect(windowStub.cancelIdleCallback).toHaveBeenCalledWith(17);
  expect(stopSubscription).toHaveBeenCalledTimes(1);

  idleCallback();
  await Promise.resolve();
  expect(memoryCacheSyncHandler).not.toHaveBeenCalled();
});

test('in-flight deferred memory work rechecks the session before writing', async () => {
  let idleCallback = null;
  let releaseHandler = null;
  let finishHandler = null;
  const handlerGate = new Promise((resolve) => { releaseHandler = resolve; });
  const handlerFinished = new Promise((resolve) => { finishHandler = resolve; });
  const cacheWrites = [];
  const windowStub = {
    addEventListener: jest.fn(),
    requestIdleCallback: jest.fn((callback) => {
      idleCallback = callback;
      return 23;
    }),
    cancelIdleCallback: jest.fn(),
  };
  const { initNotesSync } = loadNotesSync({
    window: windowStub,
    loadAllNotes: jest.fn(() => []),
    saveAllNotes: jest.fn(() => true),
    setRemoteSyncHandler: jest.fn(),
    syncNotes: jest.fn(async () => [{
      id: 'remote-note',
      bodyText: 'Private note from user A',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }]),
    subscribeToNotesChanges: jest.fn(async () => () => {}),
  });
  const memoryCacheSyncHandler = jest.fn(async (notes, userId, isSessionCurrent) => {
    await handlerGate;
    if (isSessionCurrent()) {
      cacheWrites.push({ notes, userId });
    }
    finishHandler();
  });
  const sync = initNotesSync({ memoryCacheSyncHandler });

  await sync.handleSessionChange({ id: 'user-a' });
  idleCallback();
  await Promise.resolve();

  await sync.handleSessionChange(null);
  releaseHandler();
  await handlerFinished;

  expect(memoryCacheSyncHandler).toHaveBeenCalledTimes(1);
  expect(cacheWrites).toHaveLength(0);
});
