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

test('remote-only items are added', () => {
  const merged = byId(mergeRemoteWithLocal([], [{ id: 'm9', content: 'from elsewhere', createdAt: '2026-06-17T09:00:00.000Z' }], 'createdAt'));
  expect(merged.m9).toBeDefined();
});

test('a synced local item absent from remote is treated as deleted, not resurrected', () => {
  const local = [{ id: 'm1', content: 'deleted elsewhere', createdAt: '2026-06-17T10:00:00.000Z', pendingSync: false }];
  const merged = mergeRemoteWithLocal(local, [], 'createdAt');
  expect(merged).toHaveLength(0);
});
