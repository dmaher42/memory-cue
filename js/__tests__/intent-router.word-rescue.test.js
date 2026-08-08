/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadIntentRouter(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/services/intentRouter.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { classifyIntentLocally, intentRouter, routeIntent, DECISION_TYPES };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Set,
    predictIntent: overrides.predictIntent || (() => null),
    recordPattern: overrides.recordPattern || (() => null),
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('routes explicit Word Rescue modes before capture heuristics', () => {
  const { intentRouter } = loadIntentRouter();

  const result = intentRouter('avoids giving a direct answer', {
    assistantTask: 'word_rescue',
    assistantMode: 'coach',
  });

  expect(result.type).toBe('assistant_query');
  expect(result.payload).toEqual(expect.objectContaining({
    decisionType: 'assistant_query',
    parsedType: 'word_rescue',
    assistantTask: 'word_rescue',
    mode: 'coach',
  }));
});

test.each([
  ['I need another word for careful', 'fast'],
  ['Use a thesaurus for happy', 'fast'],
  ["I can't remember the word for avoiding a clear answer", 'fast'],
  ['Help me discover a word for avoiding a clear answer and give me a clue', 'coach'],
  ['It is on the tip of my tongue - coach me', 'coach'],
])('routes natural word-finding language to Word Rescue (%s)', (text, mode) => {
  const { intentRouter } = loadIntentRouter();
  const result = intentRouter(text);

  expect(result.type).toBe('assistant_query');
  expect(result.payload.assistantTask).toBe('word_rescue');
  expect(result.payload.mode).toBe(mode);
});

test.each([
  'What reminders do I have today?',
  'What did I write about the excursion?',
  'Show me my notes about pre-game routines',
  'when is m pdp',
  'What is my PDP date?',
  'What did I need to do tomorrow?',
  'Which notes mention football?',
  'Where is the note about Egypt?',
  "What's on my reminders today?",
])('keeps personal recall on the notes and reminders query path (%s)', (text) => {
  const { intentRouter } = loadIntentRouter();
  expect(intentRouter(text).type).toBe('query_memory');
});

test.each([
  'What is spaced retrieval practice?',
  'Explain spaced retrieval practice',
  'When is Easter?',
  'What is a reminder?',
])('routes general questions to the assistant instead of searching personal storage (%s)', (text) => {
  const { intentRouter } = loadIntentRouter();
  const result = intentRouter(text);
  expect(result.type).toBe('assistant_query');
  expect(result.payload.assistantTask).toBe('general');
});

test('keeps ordinary reminder and note classification unchanged', () => {
  const { intentRouter } = loadIntentRouter();

  expect(intentRouter('remind me to call the dentist tomorrow').type).toBe('persist_reminder');
  expect(intentRouter('lesson idea for teaching retrieval practice').type).toBe('persist_note');
  expect(intentRouter('Remind me tomorrow to find another word for careful').type).toBe('persist_reminder');
  expect(intentRouter('Note: another word for happy is joyful').type).toBe('persist_note');
  expect(intentRouter('Please remind me tomorrow to find another word for careful').type).toBe('persist_reminder');
  expect(intentRouter('Could you remind me tomorrow about a better word for careful?').type).toBe('persist_reminder');
  expect(intentRouter('Please save this as a note: another word for happy is joyful').type).toBe('persist_note');
});

test('advertises assistant_query as a canonical decision type', () => {
  const { DECISION_TYPES } = loadIntentRouter();
  expect(Array.from(DECISION_TYPES)).toContain('assistant_query');
});
