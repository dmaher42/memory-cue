/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPlanningService() {
  const filePath = path.resolve(__dirname, '../../src/services/planningService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { loadInbox, generateDailyPlan };\n';

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
    Boolean,
    Math,
    JSON,
    Promise,
    localStorage,
    globalThis: {},
    pullChanges: jest.fn(() => Promise.resolve()),
    isMemoryCoachInboxEntry: (entry) => entry?.metadata?.type === 'memory-card',
  });
  context.globalThis = context;
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

beforeEach(() => {
  localStorage.clear();
});

test('daily planning excludes hidden Memory Coach cards from Suggested Tasks', async () => {
  localStorage.setItem('memoryCueInbox', JSON.stringify([
    { id: 'ordinary', text: 'Plan the school meeting', metadata: {} },
    {
      id: 'coach',
      text: 'evasive: avoiding a direct answer',
      metadata: {
        type: 'memory-card',
        memoryCoach: { prompt: 'Avoiding a direct answer', answer: 'evasive' },
      },
    },
  ]));
  localStorage.setItem('memoryCueNotes', '[]');
  localStorage.setItem('memoryCue:offlineReminders', '[]');
  const service = loadPlanningService();

  const inbox = await service.loadInbox('user-1');
  const plan = await service.generateDailyPlan('user-1');

  expect(inbox.map((entry) => entry.id)).toEqual(['ordinary']);
  expect(plan.suggestedTasks.map((entry) => entry.title)).toEqual(['Plan the school meeting']);
  expect(JSON.stringify(plan)).not.toMatch(/evasive/i);
});
