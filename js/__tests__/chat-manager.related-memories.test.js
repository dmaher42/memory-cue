/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadChatManager(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/chat/chatManager.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { handleChatMessage };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Math,
    Set,
    crypto: { randomUUID: () => `message-${Math.random()}` },
    addMessage: overrides.addMessage || (() => null),
    captureInput: overrides.captureInput || (async () => ({ message: 'Saved for later review.' })),
    executeCommand: async () => ({}),
    saveInboxEntry: () => ({}),
    suggestNotebookAndTags: async () => ({}),
    classifyIntentLocally: () => ({}),
    createChatIntentInput: () => ({}),
    routeIntent: () => ({}),
    semanticSearch: async () => [],
    ensureFolderExistsByName: () => '',
    saveNote: () => ({}),
    generateDailyPlan: async () => ({}),
    renderDailyPlan: () => '',
    buildMemoryAssistantRequest: () => ({}),
    requestAssistantChat: async () => '',
    answerFromActiveLesson: async () => '',
    looksLikeActiveLessonPrompt: () => false,
    findRelatedMemories: overrides.findRelatedMemories || (() => []),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('stores exact related-note references with the assistant message', async () => {
  const savedMessages = [];
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    captureInput: async () => ({ message: 'Reminder created.', quickActions: [] }),
    findRelatedMemories: () => [
      {
        noteId: 'curriculum-map',
        title: 'Curriculum map',
        noteTitle: 'Curriculum map',
        preview: 'Sequence and achievement standards.',
        score: 3,
      },
      {
        noteId: 'lesson-notes',
        title: 'Assessment ideas',
        noteTitle: 'Prior lesson notes',
        preview: 'Exit ticket and source analysis prompts.',
        score: 2,
      },
      {
        noteId: 'lesson-notes',
        title: 'Duplicate section',
        noteTitle: 'Prior lesson notes',
        score: 1,
      },
    ],
  });

  const response = await handleChatMessage('Prepare the lesson sequence');
  const assistantMessage = savedMessages[1];

  expect(savedMessages).toHaveLength(2);
  expect(response.relatedMemories).toEqual([
    {
      noteId: 'curriculum-map',
      label: 'Curriculum map',
      score: 3,
      preview: 'Sequence and achievement standards.',
    },
    {
      noteId: 'lesson-notes',
      label: 'Assessment ideas (Prior lesson notes)',
      score: 2,
      preview: 'Exit ticket and source analysis prompts.',
    },
  ]);
  expect(assistantMessage.relatedMemories).toEqual(response.relatedMemories);
  expect(assistantMessage.content).toContain([
    'Related from your memory:',
    '- Curriculum map',
    '- Assessment ideas (Prior lesson notes)',
  ].join('\n'));
});
