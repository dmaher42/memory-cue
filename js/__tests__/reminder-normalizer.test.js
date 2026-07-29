const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderNormalizer() {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderNormalizer.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { normalizeReminder, normalizeReminderList, normalizeReminderRecord };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    crypto: { randomUUID: () => 'test-id' },
    Date,
    Number,
    String,
    Array,
    Object,
    Set,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('normalizes reminders with serializable title, notes, due, and completion fields', () => {
  const { normalizeReminder } = loadReminderNormalizer();

  const normalized = normalizeReminder({
    id: 'basketball-trials',
    title: 'Basketball Trials',
    notes: 'Trial 1 - School gym\nTrial 2 - Rec centre',
    due: '2026-05-06T06:30:00.000Z',
    priority: 'medium',
    category: 'School - Events',
    done: false,
    createdAt: 1776944260978,
    updatedAt: 1776944260978,
  });

  const serialized = JSON.parse(JSON.stringify(normalized));

  expect(serialized.title).toBe('Basketball Trials');
  expect(serialized.text).toBe('Basketball Trials');
  expect(serialized.notes).toBe('Trial 1 - School gym\nTrial 2 - Rec centre');
  expect(serialized.due).toBe('2026-05-06T06:30:00.000Z');
  expect(serialized.done).toBe(false);
  expect(serialized.completed).toBe(false);
  expect(serialized.priority).toBe('Medium');
});

test('keeps a completion timestamp and backfills older completed reminders from updatedAt', () => {
  const { normalizeReminder } = loadReminderNormalizer();

  const completed = normalizeReminder({
    id: 'registered-basketball',
    title: 'Registered for basketball',
    done: true,
    createdAt: 1000,
    updatedAt: 2000,
    completedAt: 3000,
  });
  const legacyCompleted = normalizeReminder({
    id: 'legacy-done',
    title: 'Older completed item',
    completed: true,
    createdAt: 1000,
    updatedAt: 2000,
  });
  const active = normalizeReminder({
    id: 'active',
    title: 'Next competition registration',
    done: false,
    createdAt: 1000,
    updatedAt: 2000,
    completedAt: 3000,
  });

  expect(completed.completedAt).toBe(3000);
  expect(legacyCompleted.completedAt).toBe(2000);
  expect(active.completedAt).toBeNull();
});

