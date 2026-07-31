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

test('turns note and reminder query data into a readable message with tappable result references', async () => {
  const savedMessages = [];
  const findRelatedMemories = jest.fn(() => []);
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    findRelatedMemories,
    captureInput: async () => ({
      message: '',
      data: {
        type: 'mixed_results',
        memories: [
          { id: 'note-1', type: 'note', title: 'Excursion checklist', text: 'Forms and medical details.' },
        ],
        reminders: [
          { id: 'reminder-1', type: 'reminder', title: 'Return excursion forms', due: '2026-08-04T09:00:00.000Z' },
        ],
      },
    }),
  });

  const response = await handleChatMessage('What notes and reminders mention the excursion?');
  const assistantMessage = savedMessages[1];

  expect(response.message).toBe('I found 1 note and 1 reminder.');
  expect(response.resultItems).toEqual([
    { id: 'note-1', type: 'note', title: 'Excursion checklist' },
    {
      id: 'reminder-1',
      type: 'reminder',
      title: 'Return excursion forms',
      due: '2026-08-04T09:00:00.000Z',
    },
  ]);
  expect(assistantMessage.resultItems).toEqual(response.resultItems);
  expect(findRelatedMemories).not.toHaveBeenCalled();
});

test('drops blank markup-only query results and shortens raw note bodies used as titles', async () => {
  const savedMessages = [];
  const longBody = 'This is a long pre-game note about supporting teammates, showing bravery, staying connected, and playing your role for the whole match.';
  const { handleChatMessage } = loadChatManager({
    addMessage: (message) => savedMessages.push(message),
    captureInput: async () => ({
      message: '',
      data: {
        type: 'memory_results',
        items: [
          { id: 'blank-note', type: 'note', text: '<br>' },
          { id: 'long-note', type: 'note', text: longBody },
        ],
      },
    }),
  });

  const response = await handleChatMessage('What did I write about pre-game?');

  expect(response.message).toBe('I found 1 note.');
  expect(response.resultItems).toHaveLength(1);
  expect(response.resultItems[0]).toEqual(expect.objectContaining({ id: 'long-note', type: 'note' }));
  expect(response.resultItems[0].title).not.toContain('<br>');
  expect(response.resultItems[0].title.length).toBeLessThanOrEqual(80);
  expect(response.resultItems[0].title.endsWith('…')).toBe(true);
  expect(savedMessages[1].resultItems).toEqual(response.resultItems);
});
