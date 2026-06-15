/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load notes-sync.js with its ES imports stripped so we can unit-test the pure merge helper
// without pulling in the Firebase / storage modules it depends on at runtime.
function loadNotesSync() {
  const filePath = path.resolve(__dirname, '../modules/notes-sync.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { mergeRemoteIntoLocal };\n';

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
