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

test('persists urgent appointment state and defaults only timed reminders to urgent', () => {
  const { normalizeReminder } = loadReminderNormalizer();
  const acknowledgedAt = Date.parse('2026-09-03T09:46:00.000Z');

  const timed = normalizeReminder({
    id: 'timed',
    title: 'Timed appointment',
    due: '2026-09-03T10:00:00.000Z',
    urgentAcknowledgedAt: new Date(acknowledgedAt).toISOString(),
    urgentStartedAt: acknowledgedAt + 1000,
  });
  const dateOnly = normalizeReminder({
    id: 'date-only',
    title: 'Date-only reminder',
    due: '2026-09-03',
  });
  const explicitlyDisabled = normalizeReminder({
    id: 'disabled',
    title: 'Ordinary timed reminder',
    due: '2026-09-03T11:00:00.000Z',
    hasExplicitTime: true,
    urgentAlert: false,
  });

  expect(timed).toEqual(expect.objectContaining({
    hasExplicitTime: true,
    urgentAlert: true,
    urgentAcknowledgedAt: acknowledgedAt,
    urgentStartedAt: acknowledgedAt + 1000,
  }));
  expect(dateOnly.hasExplicitTime).toBe(false);
  expect(dateOnly.urgentAlert).toBe(false);
  expect(explicitlyDisabled.hasExplicitTime).toBe(true);
  expect(explicitlyDisabled.urgentAlert).toBe(false);
});
