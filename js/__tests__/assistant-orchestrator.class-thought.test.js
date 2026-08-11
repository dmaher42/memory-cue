/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadAssistantOrchestrator(fetchImpl = async () => ({ ok: true, json: async () => ({ reply: '' }) })) {
  const filePath = path.resolve(__dirname, '../../src/services/assistantOrchestrator.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { buildClassThoughtAssistantRequest, requestAssistantChatResult };\n';

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

test('builds a minimal class thought request without attaching personal context', () => {
  const { buildClassThoughtAssistantRequest } = loadAssistantOrchestrator();
  const result = buildClassThoughtAssistantRequest('  Two students left the lesson.  ', {
    classHubName: '  Year 8 HPE  ',
    notes: ['CANARY_PRIVATE_NOTE'],
    reminders: ['CANARY_PRIVATE_REMINDER'],
    history: ['CANARY_PRIVATE_HISTORY'],
  });

  expect(result).toEqual({
    assistantTask: 'organise_class_thought',
    message: 'Two students left the lesson.',
    classHubName: 'Year 8 HPE',
  });
  expect(Object.keys(result).sort()).toEqual(['assistantTask', 'classHubName', 'message']);
});

test('preserves a structured class thought draft for review callers', async () => {
  const payload = {
    success: true,
    reply: 'Draft ready. Review it before saving.',
    classThoughtDraft: {
      note: { title: 'Outdoor lesson', body: 'Two students left.', tags: [] },
      followUps: [{ text: 'Speak to the students next lesson' }],
    },
  };
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => payload }));
  const { requestAssistantChatResult } = loadAssistantOrchestrator(fetchMock);

  await expect(requestAssistantChatResult({
    assistantTask: 'organise_class_thought',
    message: 'Two students left.',
    classHubName: 'Year 8 HPE',
  })).resolves.toEqual(payload);
});
