/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRecallService() {
  const filePath = path.resolve(__dirname, '../services/recall-service.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += `
module.exports = {
  addMemoryPracticeEntry,
  addVocabularyPracticeEntry,
  createPracticeSession,
  getMemoryCoachItems,
  getPracticeSummary,
  maskPracticeAnswer,
  recordPracticeResult,
  setPracticeItemEnabled,
};`;
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    Date,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Math,
    RegExp,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

function loadMemoryCoachUi(recallApi) {
  const filePath = path.resolve(__dirname, '../../src/ui/mobileMemoryCoachUi.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source = `
const {
  addMemoryPracticeEntry,
  addVocabularyPracticeEntry,
  createPracticeSession,
  getMemoryCoachItems,
  getPracticeSummary,
  maskPracticeAnswer,
  recordPracticeResult,
  setPracticeItemEnabled,
} = globalThis.__recallApi;
${source}
module.exports = { createMemoryCoachUi };
`;

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    __recallApi: recallApi,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Math,
    RegExp,
    document,
    window,
    CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLFormElement: window.HTMLFormElement,
    Element: window.Element,
  });
  context.globalThis = context;
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const recallApi = loadRecallService();
const { createMemoryCoachUi } = loadMemoryCoachUi(recallApi);
const NOW = Date.UTC(2026, 7, 9, 10, 0, 0);

const createStoredEntry = (payload = {}) => ({
  id: payload.id || 'entry-evasive',
  type: 'inbox',
  pendingSync: true,
  ...payload,
});

const makePracticeEntry = () => recallApi.addVocabularyPracticeEntry([], {
  word: 'evasive',
  cue: 'Someone who avoids giving a clear or direct answer',
  explanation: 'Avoiding a direct answer.',
  example: 'The manager was evasive about the deadline.',
  hints: ['A word for someone who dodges a straight answer.'],
}, {
  now: NOW,
  createEntry: (payload) => createStoredEntry(payload),
}).entry;

function setup(entries = []) {
  document.body.innerHTML = `
    <button id="memoryCoachLauncher" type="button" aria-expanded="false">Memory coach</button>
    <section id="chatConversationContainer" aria-live="polite"></section>
    <section id="thinkingBarContainer" aria-label="AI reminder, note, and question capture">
      <div id="memoryCoachModeBar" class="hidden">
        <strong id="memoryCoachModeLabel">Practice</strong>
        <button id="memoryCoachExitButton" type="button">Back to Capture</button>
      </div>
      <form id="thinkingBarForm"><textarea id="thinkingBarInput"></textarea></form>
      <div id="thinkingBarStatus"></div>
    </section>
  `;
  document.body.dataset.activeView = 'capture';
  let storedEntries = [...entries];
  const createEntry = jest.fn((payload) => {
    const entry = createStoredEntry({ id: `entry-${storedEntries.length + 1}`, ...payload });
    storedEntries = [entry, ...storedEntries];
    return entry;
  });
  const updateEntry = jest.fn((entry) => {
    const index = storedEntries.findIndex((candidate) => candidate.id === entry?.id);
    if (index < 0) return null;
    storedEntries = storedEntries.map((candidate) => candidate.id === entry.id ? entry : candidate);
    return entry;
  });
  const setStatus = jest.fn();
  const beforeActivate = jest.fn();
  const onFindWord = jest.fn();
  let controller;
  controller = createMemoryCoachUi({
    container: document.getElementById('chatConversationContainer'),
    launcher: document.getElementById('memoryCoachLauncher'),
    controlsRegion: document.getElementById('thinkingBarContainer'),
    modeBar: document.getElementById('memoryCoachModeBar'),
    modeLabel: document.getElementById('memoryCoachModeLabel'),
    exitButton: document.getElementById('memoryCoachExitButton'),
    loadEntries: () => storedEntries,
    createEntry,
    updateEntry,
    setStatus,
    requestRender: () => controller.render(),
    beforeActivate,
    onFindWord,
    now: () => NOW,
  });
  return {
    controller,
    createEntry,
    updateEntry,
    setStatus,
    beforeActivate,
    onFindWord,
    getStoredEntries: () => storedEntries,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

test('opens an empty coach with one existing textarea and a direct Word Help path', () => {
  const { controller, beforeActivate, onFindWord } = setup();

  controller.activate();

  expect(beforeActivate).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains('memory-coach-mode-active')).toBe(true);
  expect(document.querySelectorAll('textarea')).toHaveLength(1);
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Choose something meaningful to remember');
  expect(document.getElementById('thinkingBarContainer').getAttribute('aria-label')).toBe('Memory Coach controls');
  document.querySelector('[data-memory-coach-action="find-word"]').click();
  expect(onFindWord).toHaveBeenCalledTimes(1);
  expect(controller.isActive()).toBe(false);
});

test('creates a general memory card from a prompt and hidden answer', () => {
  const { controller, getStoredEntries } = setup();
  controller.activate();

  document.querySelector('[data-memory-coach-action="add-memory"]').click();
  document.getElementById('memoryCoachNewPrompt').value = 'What is my new colleague’s name?';
  document.getElementById('memoryCoachNewAnswer').value = 'Priya Shah';
  document.querySelector('[data-memory-coach-form="create"]').dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true,
  }));

  const entry = getStoredEntries()[0];
  expect(entry.metadata.memoryCoach).toMatchObject({
    kind: 'memory',
    prompt: 'What is my new colleague’s name?',
    answer: 'Priya Shah',
  });
  expect(document.querySelector('.memory-coach-prompt').textContent).toContain('new colleague');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('Priya Shah');
});

test('saves a Word Rescue result as a hidden Inbox practice entry and prevents duplicates', () => {
  const { controller, createEntry, getStoredEntries } = setup();
  const payload = {
    word: 'evasive',
    cue: 'Someone who avoids a clear answer',
    explanation: 'Avoiding a direct answer.',
    example: 'The answer was evasive.',
  };

  const first = controller.saveVocabulary(payload);
  const second = controller.saveVocabulary({ ...payload, word: 'EVASIVE' });

  expect(first.status).toBe('created');
  expect(second.status).toBe('existing');
  expect(createEntry).toHaveBeenCalledTimes(1);
  expect(getStoredEntries()).toHaveLength(1);
  expect(getStoredEntries()[0]).toMatchObject({
    type: 'inbox',
    metadata: { type: 'memory-card' },
  });
  expect(controller.getVocabularyState('evasive')).toBe('saved');
});

test('keeps the answer out of the coach DOM until reveal, then records a hinted review', () => {
  const entry = makePracticeEntry();
  const { controller, getStoredEntries, updateEntry } = setup([entry]);
  controller.activate();

  const card = () => document.querySelector('.memory-coach-card');
  expect(document.querySelector('.memory-coach-prompt').textContent).toContain('avoids giving');
  expect(card().textContent).not.toMatch(/\bevasive\b/i);

  document.querySelector('[data-memory-coach-action="hint"]').click();
  expect(document.querySelector('.memory-coach-hint')).not.toBeNull();
  expect(card().textContent).not.toMatch(/\bevasive\b/i);

  document.querySelector('[data-memory-coach-action="reveal"]').click();
  expect(document.querySelector('.memory-coach-answer-word').textContent).toBe('evasive');
  document.querySelector('[data-memory-coach-action="rate-got_it"]').click();

  expect(document.querySelector('.memory-coach-title').textContent).toBe('Good retrieval work');
  const coach = getStoredEntries()[0].metadata.memoryCoach;
  expect(coach.lastRating).toBe('hard');
  expect(coach.reviewCount).toBe(1);
  expect(coach.history[0]).toMatchObject({ hintUsed: true, rating: 'got_it', effectiveRating: 'hard' });
  expect(updateEntry).toHaveBeenCalledTimes(1);
});

test('pausing offers an immediate undo and returns the word to practice', () => {
  const { controller } = setup([makePracticeEntry()]);
  controller.activate();

  document.querySelector('[data-memory-coach-action="pause"]').click();
  expect(controller.getVocabularyState('evasive')).toBe('paused');
  const undo = document.querySelector('[data-memory-coach-action="resume-paused"]');
  expect(undo.textContent).toContain('Undo pause');

  undo.click();
  expect(controller.getVocabularyState('evasive')).toBe('saved');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Retrieve it before revealing');
});

test('navigation closes practice and restores the Capture controls label', () => {
  const { controller } = setup([makePracticeEntry()]);
  controller.activate();

  window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
    detail: { view: 'reminders' },
  }));

  expect(controller.isActive()).toBe(false);
  expect(document.body.classList.contains('memory-coach-mode-active')).toBe(false);
  expect(document.getElementById('memoryCoachModeBar').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('thinkingBarContainer').getAttribute('aria-label'))
    .toBe('AI reminder, note, and question capture');
});
