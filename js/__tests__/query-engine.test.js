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
    Date: overrides.Date || Date,
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

test('uses the local calendar date for today near a UTC date boundary', async () => {
  const RealDate = Date;
  const ADELAIDE_OFFSET_MINUTES = 9 * 60 + 30;
  class AdelaideBoundaryDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : ['2026-08-01T22:30:00.000Z']));
    }

    getLocalDate() {
      return new RealDate(this.getTime() + ADELAIDE_OFFSET_MINUTES * 60 * 1000);
    }

    getFullYear() {
      return this.getLocalDate().getUTCFullYear();
    }

    getMonth() {
      return this.getLocalDate().getUTCMonth();
    }

    getDate() {
      return this.getLocalDate().getUTCDate();
    }
  }

  const { handleQuery } = loadQueryEngine({
    Date: AdelaideBoundaryDate,
    getReminderList: () => [
      { id: 'today-local', type: 'reminder', title: 'Audit local date', due: '2026-08-02T06:30:00.000Z' },
      { id: 'tomorrow-local', type: 'reminder', title: 'Late task', due: '2026-08-02T15:00:00.000Z' },
    ],
  });

  const result = await handleQuery('What reminders do I have today?');

  expect(result.items.map((item) => item.id)).toEqual(['today-local']);
});

test('excludes completed reminders from keyword and semantic results', async () => {
  const { handleQuery } = loadQueryEngine({
    getReminderList: () => [
      {
        id: 'active-excursion',
        type: 'reminder',
        title: 'Return excursion forms',
        due: '2026-08-03T10:00:00.000Z',
        completed: false,
        semanticEmbedding: [1, 0],
      },
      {
        id: 'done-excursion',
        type: 'reminder',
        title: 'Book excursion bus',
        due: '2026-08-03T11:00:00.000Z',
        done: true,
        semanticEmbedding: [1, 0],
      },
    ],
    isEmbeddingEnabled: () => true,
    generateEmbedding: async () => [1, 0],
  });

  const result = await handleQuery('What reminders mention excursion?');

  expect(result.items.map((item) => item.id)).toEqual(['active-excursion']);
});

test('treats a when-is question as a reminder lookup even without the word reminder', async () => {
  const { handleQuery } = loadQueryEngine({
    getReminderList: () => [
      { id: 'pdp', type: 'reminder', title: 'PDP Paul', due: '2026-08-04T09:00:00.000Z' },
      { id: 'training', type: 'reminder', title: 'Football training', due: '2026-08-05T10:00:00.000Z' },
    ],
    loadAllNotes: () => [
      { id: 'unrelated-note', type: 'note', title: 'Gridiron Netball', bodyText: 'Pre-game notes.' },
    ],
  });

  const result = await handleQuery('when is m pdp');

  expect(result.type).toBe('reminder_results');
  expect(result.items.map((item) => item.id)).toEqual(['pdp']);
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

test('does not return weak semantic note matches', async () => {
  const { handleQuery } = loadQueryEngine({
    semanticSearch: async () => [
      { id: 'weak-note', type: 'note', title: 'Unrelated sport notes', score: 0.41 },
      { id: 'strong-note', type: 'note', title: 'Coaching session', score: 0.83 },
    ],
  });

  const result = await handleQuery('What did I write in my notes about coaching?');

  expect(result.items.map((item) => item.id)).toEqual(['strong-note']);
});
