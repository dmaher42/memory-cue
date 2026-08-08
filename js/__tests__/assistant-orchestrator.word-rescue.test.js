/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAssistantOrchestrator(fetchImpl = async () => ({ ok: true, json: async () => ({ reply: '' }) })) {
  const filePath = path.resolve(__dirname, '../../src/services/assistantOrchestrator.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { buildWordRescueAssistantRequest, requestAssistantChat, requestAssistantChatResult };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Set,
    fetch: fetchImpl,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('builds a minimal private Word Rescue request and defaults to fast mode', () => {
  const { buildWordRescueAssistantRequest } = loadAssistantOrchestrator();
  const result = buildWordRescueAssistantRequest(`  ${'x'.repeat(700)}  `);

  expect(Object.keys(result).sort()).toEqual(['assistantTask', 'message', 'mode']);
  expect(result.assistantTask).toBe('word_rescue');
  expect(result.mode).toBe('fast');
  expect(result.message).toHaveLength(500);
});

test('preserves coach mode without attaching notes, reminders, or chat history', () => {
  const { buildWordRescueAssistantRequest } = loadAssistantOrchestrator();
  const result = buildWordRescueAssistantRequest('avoids a direct answer', {
    mode: 'coach',
    notes: ['private note'],
    reminders: ['private reminder'],
    history: ['private chat'],
  });

  expect(result).toEqual({
    assistantTask: 'word_rescue',
    mode: 'coach',
    message: 'avoids a direct answer',
  });
});

test('can return structured coach data without changing existing string callers', async () => {
  const payload = {
    reply: 'Hint 1 of 3: meaning clue',
    wordRescue: { mode: 'coach', hints: ['one', 'two', 'three'] },
  };
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => payload }));
  const { requestAssistantChat, requestAssistantChatResult } = loadAssistantOrchestrator(fetchMock);

  await expect(requestAssistantChatResult({ message: 'test' })).resolves.toEqual(payload);
  await expect(requestAssistantChat({ message: 'test' })).resolves.toBe(payload.reply);
});
