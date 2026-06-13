/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCapturePipeline(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/core/capturePipeline.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { analyzeCaptureInput, captureInput };\n';

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
    Math,
    RegExp,
    Promise,
    JSON,
    Boolean,
    saveMemory: overrides.saveMemory || (async (payload) => payload),
    createReminder: overrides.createReminder || (async (payload) => payload),
    semanticSearch: overrides.semanticSearch || (async () => []),
    handleQuery: overrides.handleQuery || (async () => ({})),
    saveInboxEntry: overrides.saveInboxEntry || (async (payload) => payload),
    buildMemoryAssistantRequest: overrides.buildMemoryAssistantRequest || (() => ({})),
    requestAssistantChat: overrides.requestAssistantChat || (async () => ({ reply: '' })),
    resolveShorthandText: overrides.resolveShorthandText || ((value) => value),
    getUnknownShorthandToken: overrides.getUnknownShorthandToken || (() => null),
    rememberShorthand: overrides.rememberShorthand || (() => null),
    intentRouter: overrides.intentRouter || (() => ({
      payload: {
        decisionType: 'persist_inbox',
        parsedType: 'unknown',
        parsedEntry: { type: 'unknown', title: '' },
      },
    })),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2024, 4, 15, 9, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

test('capture pipeline parses weekday time ranges and cleans reminder titles', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
  });

  const result = await captureInput({
    text: '! Archer Basketball Sunday 330-530',
    source: 'capture',
  });

  expect(result.message).toBe('Reminder created.');
  expect(createdReminders).toHaveLength(1);

  const expected = new Date();
  expected.setDate(expected.getDate() + 4);
  expected.setHours(15, 30, 0, 0);

  expect(createdReminders[0].text).toBe('Archer Basketball');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline expands known shorthand into a dated reminder', async () => {
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
    resolveShorthandText: (value) => String(value || '')
      .replace(/\bCC\b/g, 'Classroom conversation with')
      .replace(/\bNR8\b/g, 'Year 8 Noria'),
  });

  const result = await captureInput({
    text: 'next wednesday CC NR8 8:30',
    source: 'capture',
  });

  const expected = new Date();
  expected.setDate(expected.getDate() + 7);
  expected.setHours(8, 30, 0, 0);

  expect(result.message).toBe('Reminder created.');
  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].text).toBe('Classroom conversation with Year 8 Noria');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});

test('capture pipeline asks about unknown shorthand then remembers the answer', async () => {
  const learned = {};
  const createdReminders = [];
  const { captureInput } = loadCapturePipeline({
    createReminder: async (payload = {}) => {
      createdReminders.push(payload);
      return { id: 'reminder-1', ...payload };
    },
    resolveShorthandText: (value) => String(value || '')
      .replace(/\bCC\b/g, 'Classroom conversation with')
      .replace(/\bY8N\b/g, learned.Y8N || 'Y8N'),
    getUnknownShorthandToken: (value) => (/\bY8N\b/.test(String(value || '')) ? 'Y8N' : null),
    rememberShorthand: (phrase, expansion) => {
      learned[phrase] = expansion;
      return { phrase, expansion };
    },
  });

  const clarification = await captureInput({
    text: 'next wednesday CC Y8N 8:30',
    source: 'capture',
  });

  expect(clarification.message).toBe('What does Y8N mean?');
  expect(createdReminders).toHaveLength(0);

  const result = await captureInput({
    text: 'Year 8 Noria',
    source: 'capture',
  });

  const expected = new Date();
  expected.setDate(expected.getDate() + 7);
  expected.setHours(8, 30, 0, 0);

  expect(learned.Y8N).toBe('Year 8 Noria');
  expect(result.message).toBe('Got it - I will remember Y8N means "Year 8 Noria". Reminder created.');
  expect(createdReminders).toHaveLength(1);
  expect(createdReminders[0].text).toBe('Classroom conversation with Year 8 Noria');
  expect(createdReminders[0].dueAt).toBe(expected.toISOString());
});
