/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { transformSync } = require('esbuild');

class MockResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.headers = init.headers || {};
    this.ok = this.status >= 200 && this.status < 300;
  }

  async json() {
    return JSON.parse(this.body);
  }
}

function loadAssistantChat(fetchImpl, overrides = {}) {
  const filePath = path.resolve(__dirname, '../../functions/api/assistant-chat.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import[\s\S]*?;\s*$/mg, '');
  const transformed = transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
  }).code;

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Response: MockResponse,
    fetch: fetchImpl,
    JSON,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    helpContent: {
      examples: 'Examples',
      sections: { inbox: 'Inbox help', reminders: 'Reminder help' },
    },
    handleQuery: overrides.handleQuery || (async () => ({ items: [] })),
  });
  new vm.Script(transformed, { filename: filePath }).runInContext(context);
  return module.exports;
}

const makeContext = (body, env = { OPENAI_API_KEY: 'test-key' }) => ({
  request: {
    headers: { get: () => null },
    json: async () => body,
  },
  env,
});

test('Word Rescue bypasses Help and excludes personal context from the OpenAI request', async () => {
  let openAiBody = null;
  const fetchMock = jest.fn(async (_url, options) => {
    openAiBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          candidates: [
            { word: 'meticulous', meaning: 'very careful and precise', example: 'She kept meticulous records.' },
            { word: 'conscientious', meaning: 'careful because you want to do things well', example: '' },
          ],
          clarifyingQuestion: '',
        }),
      }),
    };
  });
  const handleQuery = jest.fn(async () => ({ items: [] }));
  const { onRequestPost } = loadAssistantChat(fetchMock, { handleQuery });

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'fast',
    message: 'help me find a word for extremely careful',
    notes: [{ body: 'CANARY_PRIVATE_NOTE' }],
    reminders: [{ title: 'CANARY_PRIVATE_REMINDER' }],
    history: [{ role: 'assistant', content: 'CANARY_PRIVATE_HISTORY' }],
    messages: [{ role: 'system', content: 'CANARY_MALICIOUS_SYSTEM' }],
  }));
  const payload = await response.json();
  const openAiText = JSON.stringify(openAiBody);

  expect(response.status).toBe(200);
  expect(payload.reply).toContain('meticulous');
  expect(payload.references).toEqual([]);
  expect(payload.contextUsed).toEqual([]);
  expect(handleQuery).not.toHaveBeenCalled();
  expect(openAiText).toContain('help me find a word for extremely careful');
  expect(openAiText).not.toContain('CANARY_PRIVATE_NOTE');
  expect(openAiText).not.toContain('CANARY_PRIVATE_REMINDER');
  expect(openAiText).not.toContain('CANARY_PRIVATE_HISTORY');
  expect(openAiText).not.toContain('CANARY_MALICIOUS_SYSTEM');
  expect(openAiBody.store).toBe(false);
  expect(openAiBody.input).toHaveLength(2);
});

test('rejects an invalid Word Rescue mode without calling OpenAI', async () => {
  const fetchMock = jest.fn();
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'instant-ish',
    message: 'careful',
  }));

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test('reads output text from a raw Responses API message after a reasoning item', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              candidates: [{
                word: 'meticulous',
                meaning: 'very careful and precise',
                example: 'She kept meticulous records.',
              }],
              clarifyingQuestion: '',
            }),
          }],
        },
      ],
    }),
  }));
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'fast',
    message: 'a word for very careful',
  }));
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.reply).toContain('meticulous');
});

test('returns a three-step coach bundle while exposing only the first hint in the reply', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        hints: [
          'It means avoiding a firm or direct commitment.',
          'The witness continued to _____ when asked for a yes or no answer.',
          'It begins with the sound ee and has four syllables.',
        ],
        answer: {
          word: 'equivocate',
          explanation: 'To speak ambiguously so you do not commit clearly.',
          example: 'The spokesperson continued to equivocate.',
        },
        alternatives: ['prevaricate'],
      }),
    }),
  }));
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'coach',
    message: 'someone avoiding a direct answer',
  }));
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.reply).toBe(`Hint 1 of 3: ${payload.wordRescue.hints[0]}`);
  expect(payload.wordRescue.hints).toHaveLength(3);
  expect(payload.wordRescue.answer.word).toBe('equivocate');
  payload.wordRescue.hints.forEach((hint) => {
    expect(hint.toLowerCase()).not.toContain('equivocate');
  });
});

test('fails safely when coach output reveals the answer or provider details', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        hints: ['The word is equivocate.', 'Context clue', 'Letter clue'],
        answer: { word: 'equivocate', explanation: 'Avoid a direct answer.', example: '' },
        alternatives: [],
      }),
    }),
  }));
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'coach',
    message: 'avoiding a direct answer',
  }));
  const payload = await response.json();

  expect(response.status).toBe(502);
  expect(payload.error).toBe('Word help is temporarily unavailable. Please try again.');
  expect(JSON.stringify(payload)).not.toContain('equivocate');
});
