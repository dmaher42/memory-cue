/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadQueryEngine(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/brain/queryEngine.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { detectIntent, handleQuery };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Promise,
    RegExp,
    intentRouter: overrides.intentRouter || (() => ({
      type: 'query_memory',
      payload: { intentType: 'query' },
    })),
    getMemories: overrides.getMemories || (() => []),
    getReminderList: overrides.getReminderList || (() => []),
    loadAllNotes: overrides.loadAllNotes || (() => []),
    generateEmbedding: overrides.generateEmbedding || (async () => []),
    isEmbeddingEnabled: overrides.isEmbeddingEnabled || (() => false),
    semanticSearch: overrides.semanticSearch || (async () => []),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 7, 1, 9, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

test('answers a natural reminder question without treating the whole sentence as a title', async () => {
  const { handleQuery } = loadQueryEngine({
    getReminderList: () => [
      { id: 'today', type: 'reminder', title: 'Return excursion forms', due: '2026-08-01T10:00:00.000Z' },
      { id: 'later', type: 'reminder', title: 'Book the bus', due: '2026-08-03T10:00:00.000Z' },
    ],
  });

  const result = await handleQuery('What reminders do I have today?');

  expect(result.type).toBe('reminder_results');
  expect(result.items.map((item) => item.id)).toEqual(['today']);
});

test('searches real notebook notes with the meaningful words from a question', async () => {
  const { handleQuery } = loadQueryEngine({
    loadAllNotes: () => [
      { id: 'excursion-note', type: 'note', title: 'Excursion checklist', bodyText: 'Permission forms and medical details.' },
      { id: 'training-note', type: 'note', title: 'Football training', bodyText: 'Passing drill.' },
    ],
  });

  const result = await handleQuery('What did I write in my notes about the excursion?');

  expect(result.type).toBe('memory_results');
  expect(result.items.map((item) => item.id)).toEqual(['excursion-note']);
});

test('returns both notes and reminders for a mixed question', async () => {
  const { handleQuery } = loadQueryEngine({
    getReminderList: () => [
      { id: 'football-reminder', type: 'reminder', title: 'Pack football bibs', due: '2026-08-02T09:00:00.000Z' },
    ],
    loadAllNotes: () => [
      { id: 'football-note', type: 'note', title: 'Football session', bodyText: 'Warm-up and passing drill.' },
    ],
  });

  const result = await handleQuery('What notes and reminders mention football?');

  expect(result.type).toBe('mixed_results');
  expect(result.memories.map((item) => item.id)).toEqual(['football-note']);
  expect(result.reminders.map((item) => item.id)).toEqual(['football-reminder']);
});
