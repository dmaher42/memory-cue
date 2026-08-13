/** @jest-environment node */

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
  MEMORY_COACH_SCHEMA_VERSION,
  MEMORY_COACH_INTERVAL_DAYS,
  MEMORY_COACH_HISTORY_LIMIT,
  MEMORY_COACH_RATINGS,
  maskPracticeAnswer,
  normalizeMemoryCoachMetadata,
  isMemoryCoachEntry,
  getMemoryCoachItems,
  getDuePracticeItems,
  createPracticeSession,
  recordPracticeResult,
  setPracticeItemEnabled,
  getPracticeSummary,
  addMemoryPracticeEntry,
  addVocabularyPracticeEntry,
  getRecallItems,
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

const service = loadRecallService();
const NOW = Date.UTC(2026, 7, 9, 10, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

const makeCoachEntry = (id, overrides = {}) => ({
  id,
  text: `Practice word: ${overrides.answer || id}`,
  type: 'inbox',
  source: 'assistant',
  parsedType: 'unknown',
  createdAt: NOW - 10 * DAY_MS,
  updatedAt: NOW - 10 * DAY_MS,
  pendingSync: false,
  metadata: {
    type: 'memory-card',
    source: 'word-rescue',
    memoryCoach: {
      kind: 'vocabulary',
      prompt: `Recall ${id}`,
      answer: overrides.answer || id,
      explanation: 'A useful meaning',
      enabled: overrides.enabled !== false,
      createdAt: new Date(NOW - 10 * DAY_MS).toISOString(),
      updatedAt: new Date(NOW - 10 * DAY_MS).toISOString(),
      dueAt: overrides.dueAt || new Date(NOW - DAY_MS).toISOString(),
      lastReviewedAt: overrides.lastReviewedAt || null,
      lastRating: overrides.lastRating || null,
      stage: overrides.stage ?? 0,
      reviewCount: overrides.reviewCount ?? 1,
      streak: overrides.streak ?? 0,
      lapses: overrides.lapses ?? 0,
      history: overrides.history || [],
    },
  },
});

test('keeps the legacy age-based recall helper deterministic', () => {
  const items = [
    { id: 'recent', createdAt: new Date(NOW - 2 * DAY_MS).toISOString() },
    { id: 'older', createdAt: new Date(NOW - 9 * DAY_MS).toISOString() },
    { id: 'oldest', createdAt: new Date(NOW - 20 * DAY_MS).toISOString() },
  ];

  expect(service.getRecallItems(items, { now: NOW, limit: 3 }).map((item) => item.id))
    .toEqual(['older', 'oldest']);
});

test('creates an opt-in Inbox practice entry without changing existing entries', () => {
  const existing = { id: 'normal-inbox', text: 'Leave me alone', metadata: {} };
  const createEntry = jest.fn((payload) => ({ id: 'word-card', type: 'inbox', ...payload }));

  const result = service.addVocabularyPracticeEntry([existing], {
    word: 'Evasive',
    cue: 'Someone who avoids giving a clear answer',
    explanation: 'Avoiding a direct answer.',
    example: 'The manager was evasive about the deadline.',
    hints: ['It starts with E.', 'The answer is evasive.'],
  }, { now: NOW, createEntry });

  expect(result.status).toBe('created');
  expect(result.entries[1]).toBe(existing);
  expect(result.entry.metadata.type).toBe('memory-card');
  expect(result.entry.metadata.memoryCoach.prompt).not.toMatch(/evasive/i);
  expect(result.entry.metadata.memoryCoach.hints[1]).toContain('_____');
  expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({
    source: 'assistant',
    entryPoint: 'memoryCoach.saveVocabulary',
  }));
});

test('creates a general recall card without a parallel store', () => {
  const result = service.addMemoryPracticeEntry([], {
    prompt: 'What is the capital of South Australia?',
    answer: 'Adelaide',
  }, {
    now: NOW,
    createEntry: (payload) => ({ id: 'memory-gate', type: 'inbox', ...payload }),
  });

  expect(result.status).toBe('created');
  expect(result.entry).toMatchObject({
    type: 'inbox',
    metadata: {
      type: 'memory-card',
      source: 'memory-coach',
      memoryCoach: {
        kind: 'memory',
        prompt: 'What is the capital of South Australia?',
        answer: 'Adelaide',
      },
    },
  });
});

test('stores coached phrasing as an expression card using the original communication situation', () => {
  const createEntry = jest.fn((payload) => ({ id: 'expression-card', type: 'inbox', ...payload }));

  const result = service.addVocabularyPracticeEntry([], {
    kind: 'expression',
    word: 'usability issues or opportunities for improvement',
    cue: 'Check wording, settings, and other aspects that need fixing.',
    explanation: 'Invites a broader review beyond the examples already listed.',
    example: 'Identify any other usability issues or opportunities for improvement.',
    hints: ['What broader effect might unlisted menu problems have?'],
  }, { now: NOW, createEntry });

  expect(result.status).toBe('created');
  expect(result.entry.metadata.memoryCoach).toMatchObject({
    kind: 'expression',
    prompt: 'Check wording, settings, and other aspects that need fixing.',
    answer: 'usability issues or opportunities for improvement',
  });
  expect(result.entry.tags).toEqual(['memory-coach', 'expression']);
});

test('prevents duplicate vocabulary cards regardless of case', () => {
  const existing = makeCoachEntry('word-card', { answer: 'Evasive' });
  const createEntry = jest.fn();

  const result = service.addVocabularyPracticeEntry([existing], {
    word: 'evasive',
    cue: 'Avoiding a direct answer',
  }, { now: NOW, createEntry });

  expect(result.status).toBe('existing');
  expect(result.entries).toHaveLength(1);
  expect(createEntry).not.toHaveBeenCalled();
});

test('due sessions prioritise reviewed cards, cap new cards, and never pull a future card early', () => {
  const entries = [
    makeCoachEntry('reviewed', { reviewCount: 4, lapses: 2 }),
    makeCoachEntry('new-1', { reviewCount: 0 }),
    makeCoachEntry('new-2', { reviewCount: 0 }),
    makeCoachEntry('new-3', { reviewCount: 0 }),
    makeCoachEntry('future', { dueAt: new Date(NOW + DAY_MS).toISOString(), reviewCount: 2 }),
  ];

  const session = service.createPracticeSession(entries, { now: NOW, limit: 4, maxNew: 2, includeNext: true });
  expect(session.itemIds).toEqual(['reviewed', 'new-1', 'new-2']);
  expect(service.createPracticeSession([entries[4]], { now: NOW, includeNext: true }).itemIds).toEqual([]);
});

test('a first clear recall returns tomorrow before advancing to longer spacing', () => {
  const entry = makeCoachEntry('new-word', { stage: 0, reviewCount: 0, streak: 0 });
  const result = service.recordPracticeResult([entry], 'new-word', 'got_it', { now: NOW });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.stage).toBe(0);
  expect(Date.parse(coach.dueAt)).toBe(NOW + DAY_MS);
  expect(coach.streak).toBe(1);
});

test('a later clear recall advances one stage', () => {
  const entry = makeCoachEntry('practice', { stage: 2, reviewCount: 4, streak: 2 });
  const result = service.recordPracticeResult([entry], 'practice', 'got_it', { now: NOW });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.stage).toBe(3);
  expect(Date.parse(coach.dueAt)).toBe(NOW + 14 * DAY_MS);
  expect(coach.streak).toBe(3);
});

test('effortful unaided recall keeps the current stage and interval', () => {
  const entry = makeCoachEntry('effort', { stage: 2, reviewCount: 4, streak: 2 });
  const result = service.recordPracticeResult([entry], 'effort', 'hard', { now: NOW });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.stage).toBe(2);
  expect(Date.parse(coach.dueAt)).toBe(NOW + 7 * DAY_MS);
  expect(coach.streak).toBe(2);
});

test('a hinted clear recall returns sooner and moves back one stage', () => {
  const entry = makeCoachEntry('hinted', { stage: 2, reviewCount: 3, streak: 2 });
  const result = service.recordPracticeResult([entry], 'hinted', 'got_it', {
    now: NOW,
    hintUsed: true,
  });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.lastRating).toBe('hard');
  expect(coach.stage).toBe(1);
  expect(coach.streak).toBe(0);
  expect(Date.parse(coach.dueAt)).toBe(NOW + DAY_MS);
  expect(coach.history[0]).toMatchObject({
    rating: 'got_it',
    effectiveRating: 'hard',
    hintUsed: true,
    stageBefore: 2,
    stageAfter: 1,
  });
});

test('a forgotten word moves back, increments lapses, and returns tomorrow', () => {
  const entry = makeCoachEntry('forgotten', { stage: 4, reviewCount: 8, streak: 4, lapses: 1 });
  const result = service.recordPracticeResult([entry], 'forgotten', 'forgot', { now: NOW });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.stage).toBe(2);
  expect(coach.streak).toBe(0);
  expect(coach.lapses).toBe(2);
  expect(Date.parse(coach.dueAt)).toBe(NOW + DAY_MS);
});

test('an early review is recorded but cannot advance or postpone the existing schedule', () => {
  const dueAt = new Date(NOW + 7 * DAY_MS).toISOString();
  const entry = makeCoachEntry('early', { stage: 2, reviewCount: 4, streak: 2, dueAt });
  const result = service.recordPracticeResult([entry], 'early', 'got_it', { now: NOW });
  const coach = result.entries[0].metadata.memoryCoach;

  expect(coach.stage).toBe(2);
  expect(coach.dueAt).toBe(dueAt);
  expect(coach.streak).toBe(2);
  expect(coach.history[0].wasEarly).toBe(true);
});

test('paused cards leave the due queue and can be resumed for immediate review', () => {
  const entry = makeCoachEntry('pause-me');
  const paused = service.setPracticeItemEnabled([entry], 'pause-me', false, { now: NOW });
  expect(service.getDuePracticeItems(paused.entries, { now: NOW })).toHaveLength(0);

  const resumed = service.setPracticeItemEnabled(paused.entries, 'pause-me', true, { now: NOW + 1000 });
  expect(resumed.updated).toBe(true);
  expect(service.getDuePracticeItems(resumed.entries, { now: NOW + 1000 })).toHaveLength(1);
});

test('summary counts only clearly recalled mature cards as established', () => {
  const entries = [
    { id: 'broken', metadata: { memoryCoach: { answer: '' } } },
    makeCoachEntry('learning', { stage: 1, lastRating: 'got_it' }),
    makeCoachEntry('mature-but-forgotten', { stage: 3, lastRating: 'forgot' }),
    makeCoachEntry('established', {
      stage: 4,
      lastRating: 'got_it',
      dueAt: new Date(NOW + DAY_MS).toISOString(),
    }),
  ];

  const summary = service.getPracticeSummary(entries, { now: NOW });
  expect(summary).toMatchObject({ total: 3, due: 2, learning: 2, established: 1 });
  expect(summary.nextDueAt).toBe(new Date(NOW + DAY_MS).toISOString());
});

test('review history stays bounded for future adaptive scheduling', () => {
  const history = Array.from({ length: 55 }, (_, index) => ({
    reviewedAt: new Date(NOW - (55 - index) * DAY_MS).toISOString(),
    rating: 'got_it',
    effectiveRating: 'got_it',
    stageBefore: 1,
    stageAfter: 2,
    intervalDays: 7,
  }));
  const normalized = service.normalizeMemoryCoachMetadata(
    makeCoachEntry('history', { history }).metadata.memoryCoach,
    { now: NOW },
  );

  expect(normalized.history).toHaveLength(service.MEMORY_COACH_HISTORY_LIMIT);
  expect(normalized.history[0].reviewedAt).toBe(history[5].reviewedAt);
});
