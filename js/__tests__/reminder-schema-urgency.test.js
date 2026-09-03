const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderSchemaHelpers() {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderSchemaHelpers.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { normalizeReminderRecord };\n';

  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, Date, Number, String, Array, Object, Set });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('controller schema preserves urgent state across local and Firestore normalization', () => {
  const { normalizeReminderRecord } = loadReminderSchemaHelpers();
  const acknowledgedAt = Date.parse('2026-09-03T09:46:00.000Z');
  const startedAt = Date.parse('2026-09-03T09:55:00.000Z');

  const normalized = normalizeReminderRecord({
    id: 'appointment',
    title: 'Dentist appointment',
    due: '2026-09-03T10:00:00.000Z',
    urgentAlert: true,
    hasExplicitTime: true,
    urgentAcknowledgedAt: acknowledgedAt,
    urgentStartedAt: new Date(startedAt).toISOString(),
  });

  expect(normalized).toEqual(expect.objectContaining({
    urgentAlert: true,
    hasExplicitTime: true,
    urgentAcknowledgedAt: acknowledgedAt,
    urgentStartedAt: startedAt,
  }));
});

test('controller schema defaults timed reminders to urgent and date-only reminders to ordinary', () => {
  const { normalizeReminderRecord } = loadReminderSchemaHelpers();

  const timed = normalizeReminderRecord({
    id: 'timed',
    title: 'Meeting',
    due: '2026-09-03T10:00:00.000Z',
  });
  const dateOnly = normalizeReminderRecord({
    id: 'date-only',
    title: 'Return form',
    due: '2026-09-03',
  });
  const invalidDateOnlyOverride = normalizeReminderRecord({
    id: 'invalid-date-only-override',
    title: 'Return form',
    due: '2026-09-03',
    urgentAlert: true,
    hasExplicitTime: false,
  });

  expect(timed.hasExplicitTime).toBe(true);
  expect(timed.urgentAlert).toBe(true);
  expect(dateOnly.hasExplicitTime).toBe(false);
  expect(dateOnly.urgentAlert).toBe(false);
  expect(invalidDateOnlyOverride.urgentAlert).toBe(false);
});

test('controller schema keeps explicit-time state when dueAt arrives as epoch milliseconds', () => {
  const { normalizeReminderRecord } = loadReminderSchemaHelpers();
  const dueAt = Date.parse('2026-09-03T10:00:00.000Z');

  const normalized = normalizeReminderRecord({
    id: 'capture-path',
    title: 'Captured appointment',
    dueAt,
  });

  expect(normalized.due).toBe('2026-09-03T10:00:00.000Z');
  expect(normalized.hasExplicitTime).toBe(true);
  expect(normalized.urgentAlert).toBe(true);
});
