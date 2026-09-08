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
  updatePracticeEntry,
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
  updatePracticeEntry,
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

function setup(entries = [], uiOptions = {}) {
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
    ...uiOptions,
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

test('a note opens an editable source-grounded draft without saving until confirmation', () => {
  const { controller, createEntry, getStoredEntries } = setup();
  const source = 'Weather describes short-term atmospheric conditions.\nClimate describes patterns over many years.';
  expect(controller.openNoteDraft({ title: 'Weather and climate', text: source })).toBe(true);
  expect(createEntry).not.toHaveBeenCalled();
  expect(document.querySelector('.memory-coach-source-text').textContent).toBe(source);
  expect(document.getElementById('memoryCoachNewPrompt').value).toContain('Weather and climate');
  document.getElementById('memoryCoachNewPrompt').value = 'What does weather describe?';
  document.getElementById('memoryCoachNewAnswer').value = 'Short-term atmospheric conditions';
  document.querySelector('[data-memory-coach-form="create"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  expect(createEntry).toHaveBeenCalledTimes(1);
  expect(getStoredEntries()[0].metadata.memoryCoach.answer).toBe('Short-term atmospheric conditions');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('Short-term atmospheric conditions');
});

test('cancelled and empty note drafts do not create practice entries', () => {
  const { controller, createEntry } = setup();
  expect(controller.openNoteDraft({ text: '  ' })).toBe(false);
  controller.openNoteDraft({ title: 'Example', text: 'Useful fact' });
  document.querySelector('[data-memory-coach-action="cancel-add-memory"]').click();
  expect(createEntry).not.toHaveBeenCalled();
  expect(document.querySelector('[data-memory-coach-form]')).toBeNull();
});

test('long source notes stay available while the proposed answer is a labelled excerpt', () => {
  const { controller } = setup();
  const text = 'A long source note without punctuation '.repeat(40);
  controller.openNoteDraft({ title: 'Long note', text });
  expect(document.getElementById('memoryCoachNewAnswer').value.length).toBe(120);
  expect(document.querySelector('.memory-coach-source-text').textContent).toBe(text.trim());
  expect(document.querySelector('.memory-coach-card').textContent).toContain('excerpt');
});

test('due cues track reviews, exclude paused cards and refresh as time passes', () => {
  jest.useFakeTimers();
  try {
    const badge = document.createElement('span');
    const prompt = document.createElement('button');
    const navigationButton = document.createElement('button');
    let currentTime = NOW;
    const paused = makePracticeEntry();
    paused.id = 'paused';
    paused.metadata.memoryCoach.enabled = false;
    const { controller } = setup([makePracticeEntry(), paused], {
      dueBadge: badge, duePrompt: prompt, navigationButton, now: () => currentTime,
    });
    expect(badge.textContent).toBe('1');
    expect(prompt.hidden).toBe(false);
    expect(navigationButton.getAttribute('aria-label')).toContain('1 memory ready');
    const navigate = jest.fn();
    window.addEventListener('app:navigate', navigate, { once: true });
    prompt.click();
    expect(navigate.mock.calls[0][0].detail.view).toBe('coach');
    controller.activate();
    document.querySelector('[data-memory-coach-action="reveal"]').click();
    document.querySelector('[data-memory-coach-action="rate-got_it"]').click();
    expect(badge.hidden).toBe(true);
    expect(prompt.hidden).toBe(true);
    currentTime += 24 * 60 * 60 * 1000;
    window.dispatchEvent(new window.Event('focus'));
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
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

test('creates and reviews a list without exposing its items before reveal', () => {
  const { controller, getStoredEntries } = setup();
  controller.activate();

  document.querySelector('[data-memory-coach-action="add-list"]').click();
  document.getElementById('memoryCoachListPrompt').value = 'What do I need for football training?';
  document.getElementById('memoryCoachListItems').value = '1. Boots\n- Water bottle\n• Towel';
  document.getElementById('memoryCoachListOrder').checked = true;
  document.querySelector('[data-memory-coach-form="list"]').dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true,
  }));

  const coach = getStoredEntries()[0].metadata.memoryCoach;
  expect(coach).toMatchObject({
    kind: 'list',
    items: ['Boots', 'Water bottle', 'Towel'],
    orderMatters: true,
  });
  expect(document.querySelector('.memory-coach-prompt').textContent).toContain('football training');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('Water bottle');
  expect(document.querySelector('.memory-coach-copy').textContent).toContain('all 3 items in order');

  document.querySelector('[data-memory-coach-action="reveal"]').click();
  expect([...document.querySelectorAll('.memory-coach-answer-list li')].map((item) => item.textContent))
    .toEqual(['Boots', 'Water bottle', 'Towel']);
  expect(document.querySelector('.memory-coach-answer-list').tagName).toBe('OL');
});

test('keeps a list draft when fewer than two items are supplied', () => {
  const { controller } = setup();
  controller.activate();
  document.querySelector('[data-memory-coach-action="add-list"]').click();
  document.getElementById('memoryCoachListPrompt').value = 'Packing list';
  document.getElementById('memoryCoachListItems').value = 'Boots';
  document.querySelector('[data-memory-coach-form="list"]').dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true,
  }));

  expect(document.querySelector('.memory-coach-create-error').textContent)
    .toBe('Add a prompt and 2–20 list items, up to 120 characters each.');
  expect(document.getElementById('memoryCoachListPrompt').value).toBe('Packing list');
  expect(document.getElementById('memoryCoachListItems').value).toBe('Boots');
});

test('keeps the memory draft when validation fails', () => {
  const { controller } = setup();
  controller.activate();

  document.querySelector('[data-memory-coach-action="add-memory"]').click();
  document.getElementById('memoryCoachNewPrompt').value = 'What is my colleague’s name?';
  document.querySelector('[data-memory-coach-form="create"]').dispatchEvent(new window.Event('submit', {
    bubbles: true,
    cancelable: true,
  }));

  expect(document.querySelector('.memory-coach-create-error').textContent)
    .toBe('Add both a memory prompt and what you want to remember.');
  expect(document.getElementById('memoryCoachNewPrompt').value).toBe('What is my colleague’s name?');
  expect(document.getElementById('memoryCoachNewAnswer').value).toBe('');
});

test('moves from the prompt to the answer when Enter is pressed', () => {
  const { controller } = setup();
  controller.activate();
  document.querySelector('[data-memory-coach-action="add-memory"]').click();
  const prompt = document.getElementById('memoryCoachNewPrompt');
  const answer = document.getElementById('memoryCoachNewAnswer');

  prompt.focus();
  prompt.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  }));

  expect(document.activeElement).toBe(answer);
  expect(document.querySelector('.memory-coach-create-error')).toBeNull();
});

test('re-adding a paused general memory returns it to practice', () => {
  const createEntry = (payload) => createStoredEntry({ id: 'entry-adelaide', ...payload });
  const created = recallApi.addMemoryPracticeEntry([], {
    prompt: 'What is the capital of South Australia?',
    answer: 'Adelaide',
  }, { now: NOW, createEntry }).entry;
  const paused = recallApi.setPracticeItemEnabled([created], created.id, false, { now: NOW }).entries[0];
  const { controller, getStoredEntries, updateEntry } = setup([paused]);

  const result = controller.saveMemory({
    prompt: 'What is the capital of South Australia?',
    answer: 'Adelaide',
  });

  expect(result.status).toBe('resumed');
  expect(getStoredEntries()[0].metadata.memoryCoach.enabled).toBe(true);
  expect(updateEntry).toHaveBeenCalledTimes(1);
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

test('Escape returns a dedicated Coach view to Capture', () => {
  const navigate = jest.fn();
  window.addEventListener('app:navigate', navigate, { once: true });
  const { controller } = setup([makePracticeEntry()], { navigationView: 'coach' });
  controller.activate();

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate.mock.calls[0][0].detail).toEqual({ view: 'capture' });
});

const clickCoach = (action) => document.querySelector(`[data-memory-coach-action="${action}"]`).click();
const makeListEntry = () => recallApi.addMemoryPracticeEntry([], {
  prompt: 'What do I need for training?', kind: 'list', items: ['Boots', 'Water', 'Towel'], orderMatters: true,
}, { now: NOW, createEntry: (payload) => createStoredEntry({ ...payload, id: 'list' }) }).entry;

test('forgotten memories return after the first round and retries never loop or inflate mastery', () => {
  const second = makePracticeEntry();
  second.id = 'second';
  second.metadata.memoryCoach.prompt = 'The second situation';
  const { controller, getStoredEntries } = setup([makePracticeEntry(), second]);
  controller.activate();
  clickCoach('reveal');
  clickCoach('rate-forgot');
  expect(document.querySelector('.memory-coach-prompt').textContent).toBe('The second situation');
  clickCoach('reveal');
  clickCoach('rate-got_it');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Practise what slipped away');
  const before = getStoredEntries()[0].metadata.memoryCoach;
  clickCoach('start-retry');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('evasive');
  clickCoach('reveal');
  clickCoach('rate-forgot');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Good retrieval work');
  expect(document.querySelector('[data-memory-coach-action="start-retry"]')).toBeNull();
  const after = getStoredEntries()[0].metadata.memoryCoach;
  expect(after.dueAt).toBe(before.dueAt);
  expect(after.reviewCount).toBe(before.reviewCount);
  expect(after.history.at(-1).isRetry).toBe(true);
});

test('retry round is optional', () => {
  const { controller, getStoredEntries } = setup([makePracticeEntry()]);
  controller.activate(); clickCoach('reveal'); clickCoach('rate-forgot'); clickCoach('skip-retry');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Good retrieval work');
  expect(getStoredEntries()[0].metadata.memoryCoach.history).toHaveLength(1);
});

test('list retry hides and then reveals only missed items in their original positions', () => {
  const { controller, getStoredEntries } = setup([makeListEntry()]);
  controller.activate(); clickCoach('reveal');
  document.querySelector('[aria-label="I missed Water"]').click();
  expect(document.querySelector('[data-memory-coach-action="rate-got_it"]')).toBeNull();
  clickCoach('rate-forgot');
  expect(getStoredEntries()[0].metadata.memoryCoach.lastMissedItems).toEqual(['Water']);
  clickCoach('start-retry');
  expect(document.querySelector('.memory-coach-card').textContent).not.toMatch(/Boots|Water|Towel/);
  expect(document.querySelector('.memory-coach-copy').textContent).toContain('positions 2');
  clickCoach('reveal');
  expect([...document.querySelectorAll('.memory-coach-answer-list li')].map((li) => li.textContent)).toEqual(['Water']);
  expect(document.querySelector('.memory-coach-answer-list li').value).toBe(2);
  clickCoach('rate-got_it');
  expect(getStoredEntries()[0].metadata.memoryCoach.reviewCount).toBe(1);
});

test('order mistakes retry the whole ordered list', () => {
  const { controller, getStoredEntries } = setup([makeListEntry()]);
  controller.activate(); clickCoach('reveal');
  const order = [...document.querySelectorAll('.memory-coach-list-check')].find((label) => label.textContent === 'I mixed up the order');
  order.querySelector('input').click(); clickCoach('rate-forgot'); clickCoach('start-retry'); clickCoach('reveal');
  expect(document.querySelectorAll('.memory-coach-answer-list li')).toHaveLength(3);
  expect(getStoredEntries()[0].metadata.memoryCoach.lastOrderMissed).toBe(true);
});

test('library finds and resumes paused memories across sessions without creating duplicates', () => {
  const paused = makePracticeEntry();
  paused.metadata.memoryCoach.enabled = false;
  const { controller, getStoredEntries, createEntry } = setup([paused]);
  controller.activate(); clickCoach('library'); clickCoach('filter-paused');
  const search = document.getElementById('memoryCoachLibrarySearch');
  search.value = 'EVA'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
  expect(document.querySelectorAll('.memory-coach-library-item')).toHaveLength(1);
  clickCoach('toggle-memory');
  expect(getStoredEntries()[0].metadata.memoryCoach.enabled).toBe(true);
  expect(document.querySelectorAll('.memory-coach-library-item')).toHaveLength(0);
  controller.deactivate(); controller.activate();
  expect(document.querySelector('.memory-coach-prompt')).not.toBeNull();
  expect(createEntry).not.toHaveBeenCalled();
});

test('library editing saves in place and cancelled edits leave the card unchanged', () => {
  const { controller, getStoredEntries, createEntry } = setup([makePracticeEntry()]);
  controller.activate(); clickCoach('library'); clickCoach('edit-memory');
  const field = document.getElementById('memoryCoachNewAnswer');
  field.value = 'discarded'; field.dispatchEvent(new window.Event('input', { bubbles: true }));
  clickCoach('cancel-add-memory');
  expect(getStoredEntries()[0].metadata.memoryCoach.answer).toBe('evasive');
  clickCoach('edit-memory');
  document.getElementById('memoryCoachNewPrompt').value = 'A clear and direct response';
  document.getElementById('memoryCoachNewAnswer').value = 'forthright';
  document.querySelector('[data-memory-coach-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  expect(getStoredEntries()).toHaveLength(1);
  expect(getStoredEntries()[0].metadata.memoryCoach).toMatchObject({ answer: 'forthright', prompt: 'A clear and direct response', hints: [] });
  expect(document.querySelector('.memory-coach-title').textContent).toBe('My memories');
  expect(createEntry).not.toHaveBeenCalled();
});

test('library list editing preserves draft through renders and keeps ordering', () => {
  const { controller, getStoredEntries } = setup([makeListEntry()]);
  controller.activate(); clickCoach('library'); clickCoach('edit-memory');
  const field = document.getElementById('memoryCoachListItems');
  field.value = 'Boots\nWater\nWhistle'; field.dispatchEvent(new window.Event('input', { bubbles: true }));
  controller.render();
  expect(document.getElementById('memoryCoachListItems').value).toBe('Boots\nWater\nWhistle');
  document.querySelector('[data-memory-coach-form]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  expect(getStoredEntries()[0].metadata.memoryCoach).toMatchObject({ items: ['Boots', 'Water', 'Whistle'], orderMatters: true });
});

test('wording practice hides the reference until an attempt and records a separate self-check', () => {
  const entry = makePracticeEntry();
  entry.metadata.memoryCoach.alternatives = ['avoiding a straight answer'];
  const { controller, getStoredEntries, createEntry } = setup([entry]);
  controller.activate(); clickCoach('library'); clickCoach('practise-wording');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('evasive');
  clickCoach('wording-situation-parent');
  expect(document.querySelector('.memory-coach-card').textContent).toContain('parent or carer');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('evasive');
  expect(document.querySelector('[data-memory-coach-action="wording-rate-got_it"]')).toBeNull();
  const before = JSON.parse(JSON.stringify(getStoredEntries()[0].metadata.memoryCoach));
  clickCoach('wording-compare');
  expect(document.querySelector('.memory-coach-answer').textContent).toContain('evasive');
  expect(document.querySelector('.memory-coach-answer').textContent).toContain('avoiding a straight answer');
  expect(document.querySelector('.memory-coach-card').textContent).toContain('Different wording can be just as good');
  clickCoach('wording-rate-got_it');
  const after = getStoredEntries()[0].metadata.memoryCoach;
  expect(after.dueAt).toBe(before.dueAt);
  expect(after.reviewCount).toBe(before.reviewCount);
  expect(after.applicationCount).toBe(1);
  expect(after.history.at(-1)).toMatchObject({ isApplication: true, applicationContext: 'parent' });
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Self-check saved');
  expect(createEntry).not.toHaveBeenCalled();
});

test('changing situations hides reference again and cancelling does not record an attempt', () => {
  const { controller, getStoredEntries } = setup([makePracticeEntry()]);
  controller.activate(); clickCoach('library'); clickCoach('practise-wording');
  clickCoach('wording-situation-colleague'); clickCoach('wording-choose'); clickCoach('wording-situation-message');
  expect(document.querySelector('.memory-coach-card').textContent).toContain('short message');
  expect(document.querySelector('.memory-coach-card').textContent).not.toContain('evasive');
  clickCoach('wording-back');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('My memories');
  expect(getStoredEntries()[0].metadata.memoryCoach.reviewCount).toBe(0);
  expect(getStoredEntries()[0].metadata.memoryCoach.history).toHaveLength(0);
});

test('review summary offers wording practice after recording recall, then returns to that summary', () => {
  const { controller, getStoredEntries } = setup([makePracticeEntry()]);
  controller.activate(); clickCoach('reveal'); clickCoach('rate-got_it');
  const dueAt = getStoredEntries()[0].metadata.memoryCoach.dueAt;
  clickCoach('practise-wording'); clickCoach('wording-situation-everyday'); clickCoach('wording-compare'); clickCoach('wording-rate-hard');
  clickCoach('wording-back');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Good retrieval work');
  expect(getStoredEntries()[0].metadata.memoryCoach.dueAt).toBe(dueAt);
  expect(getStoredEntries()[0].metadata.memoryCoach.reviewCount).toBe(1);
});

test('lists do not offer expression exercises', () => {
  const { controller } = setup([makeListEntry()]);
  controller.activate(); clickCoach('library');
  expect(document.querySelector('[data-memory-coach-action="practise-wording"]')).toBeNull();
});

test('unsaved wording self-check stays visible on persistence failure', () => {
  const { controller } = setup([makePracticeEntry()], { updateEntry: () => null });
  controller.activate(); clickCoach('library'); clickCoach('practise-wording');
  clickCoach('wording-situation-colleague'); clickCoach('wording-compare'); clickCoach('wording-rate-got_it');
  expect(document.querySelector('.memory-coach-create-error').textContent).toContain('Could not save');
  expect(document.querySelector('.memory-coach-title').textContent).toBe('Compare the meaning');
});
