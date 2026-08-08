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
  expect(openAiBody.reasoning).toEqual({ effort: 'minimal' });
  expect(openAiBody.max_output_tokens).toBe(1200);
  expect(openAiBody.text.format).toMatchObject({
    type: 'json_schema',
    name: 'word_rescue_fast',
    strict: true,
  });
  expect(openAiBody.text.format.schema.properties.candidates).toMatchObject({
    minItems: 1,
    maxItems: 3,
  });
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

test('gives the general assistant enough output budget to return visible text', async () => {
  let openAiBody = null;
  const fetchMock = jest.fn(async (_url, options) => {
    openAiBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ output_text: 'Hello.' }),
    };
  });
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    message: 'Reply with hello.',
  }));
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.reply).toBe('Hello.');
  expect(openAiBody.reasoning).toEqual({ effort: 'minimal' });
  expect(openAiBody.max_output_tokens).toBe(1200);
  expect(openAiBody.text).toBeUndefined();
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
  let openAiBody = null;
  const fetchMock = jest.fn(async (_url, options) => {
    openAiBody = JSON.parse(options.body);
    return {
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
    };
  });
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
  expect(payload.wordRescue.hints[2]).toBe('It starts with "E" and has 10 letters.');
  expect(openAiBody.max_output_tokens).toBe(1600);
  expect(openAiBody.text.format).toMatchObject({
    type: 'json_schema',
    name: 'word_rescue_coach',
    strict: true,
  });
  expect(openAiBody.text.format.schema.properties.hints).toMatchObject({
    minItems: 3,
    maxItems: 3,
  });
});

test('retries once when reasoning exhausts the first Word Rescue output allowance', async () => {
  const requestBodies = [];
  const fetchMock = jest.fn(async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    if (requestBodies.length === 1) {
      return {
        ok: true,
        json: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'reasoning', summary: [] }],
          usage: {
            output_tokens: 1200,
            output_tokens_details: { reasoning_tokens: 1200 },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          candidates: [{
            word: 'meticulous',
            meaning: 'very careful and exact',
            example: 'She kept meticulous notes.',
          }],
        }),
      }),
    };
  });
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'fast',
    message: 'very careful and exact',
  }));
  const payload = await response.json();

  expect(response.status).toBe(200);
  expect(payload.reply).toContain('meticulous');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(requestBodies[0].max_output_tokens).toBe(1200);
  expect(requestBodies[1].max_output_tokens).toBe(2400);
  expect(requestBodies[1].text.format.name).toBe('word_rescue_fast');
});

test('does not report a generic assistant success when OpenAI returns no visible text', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ status: 'completed', output: [] }),
  }));
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    message: 'Reply with hello.',
  }));
  const payload = await response.json();

  expect(response.status).toBe(500);
  expect(payload.error).toBe('Assistant is temporarily unavailable. Please try again.');
  expect(JSON.stringify(payload)).not.toContain('OpenAI returned no usable text');
});

test('replaces a coach hint that accidentally reveals the answer', async () => {
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

  expect(response.status).toBe(200);
  expect(payload.wordRescue.answer.word).toBe('equivocate');
  expect(payload.wordRescue.hints).toHaveLength(3);
  payload.wordRescue.hints.forEach((hint) => {
    expect(hint.toLowerCase()).not.toContain('equivocate');
  });
  expect(payload.wordRescue.hints[0]).toContain('Avoid a direct answer.');
});

test('keeps provider failure details out of a Word Rescue error', async () => {
  const fetchMock = jest.fn(async () => ({
    ok: false,
    status: 429,
  }));
  const { onRequestPost } = loadAssistantChat(fetchMock);

  const response = await onRequestPost(makeContext({
    assistantTask: 'word_rescue',
    mode: 'fast',
    message: 'careful and exact',
  }));
  const payload = await response.json();

  expect(response.status).toBe(502);
  expect(payload.error).toBe('Word help is temporarily unavailable. Please try again.');
  expect(payload.code).toBe('provider_request_failed');
  expect(JSON.stringify(payload)).not.toContain('429');
});
