/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal stand-in for the Web Response used by Cloudflare Pages Functions.
class MockResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.headers = init.headers || {};
  }

  async json() {
    return JSON.parse(this.body);
  }
}

function loadParseEntry(fetchImpl) {
  const filePath = path.resolve(__dirname, '../../functions/api/parse-entry.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { onRequestPost };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Response: MockResponse,
    fetch: fetchImpl,
    JSON,
    Date,
    Number,
    String,
    Array,
    Object,
    Set,
    Boolean,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const makeContext = (body, env = { OPENAI_API_KEY: 'test-key' }) => ({
  request: { json: async () => body },
  env,
});

const openAiReply = (content) => async () => ({
  ok: true,
  json: async () => ({ id: 'cmpl-1', choices: [{ message: { content } }], usage: {} }),
});

test('returns a structured entry, not the raw OpenAI envelope', async () => {
  const { onRequestPost } = loadParseEntry(openAiReply(JSON.stringify({
    type: 'Reminder',
    title: 'Call the dentist',
    reminderDate: '2026-03-05T09:00:00.000Z',
    tags: ['Health', 'Calls'],
  })));

  const res = await onRequestPost(makeContext({ text: 'call the dentist tomorrow at 9am' }));
  const out = await res.json();

  expect(res.status).toBe(200);
  expect(out.choices).toBeUndefined(); // not the raw envelope
  expect(out.type).toBe('reminder'); // normalized to lowercase
  expect(out.title).toBe('Call the dentist');
  expect(out.reminderDate).toBe('2026-03-05T09:00:00.000Z');
  expect(out.tags).toEqual(['health', 'calls']);
});

test('falls back to unknown when the model returns non-JSON', async () => {
  const { onRequestPost } = loadParseEntry(openAiReply('Sure! Here is what I think...'));
  const res = await onRequestPost(makeContext({ text: 'some rambling thought' }));
  const out = await res.json();

  expect(res.status).toBe(200);
  expect(out.type).toBe('unknown');
  expect(out.title).toBe('some rambling thought');
  expect(out.reminderDate).toBeNull();
});

test('coerces an out-of-range type to unknown', async () => {
  const { onRequestPost } = loadParseEntry(openAiReply(JSON.stringify({ type: 'spaceship', title: 'x' })));
  const res = await onRequestPost(makeContext({ text: 'x' }));
  const out = await res.json();
  expect(out.type).toBe('unknown');
});

test('returns 400 for empty text', async () => {
  const { onRequestPost } = loadParseEntry(openAiReply('{}'));
  const res = await onRequestPost(makeContext({ text: '   ' }));
  expect(res.status).toBe(400);
});

test('returns 500 when the API key is missing', async () => {
  const { onRequestPost } = loadParseEntry(openAiReply('{}'));
  const res = await onRequestPost(makeContext({ text: 'hi' }, {}));
  expect(res.status).toBe(500);
});

test('returns 500 when OpenAI request fails', async () => {
  const { onRequestPost } = loadParseEntry(async () => ({ ok: false, status: 429, json: async () => ({}) }));
  const res = await onRequestPost(makeContext({ text: 'hi' }));
  expect(res.status).toBe(500);
});
