/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderService(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { createReminder, updateReminder, deleteReminder, completeReminder, loadReminderList, getReminderList };\n';

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
    Set,
    Map,
    Math,
    RegExp,
    JSON,
    createReminderInStore: overrides.createReminderInStore || (() => null),
    updateReminderInStore: overrides.updateReminderInStore || (() => null),
    deleteReminderInStore: overrides.deleteReminderInStore || (() => null),
    loadReminders: overrides.loadReminders || (() => []),
    getReminders: overrides.getReminders || (() => []),
    normalizeReminder: overrides.normalizeReminder || ((value) => value),
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2024, 4, 15, 9, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

test('createReminder applies weekday and compact time parsing for all reminder adds', () => {
  const saved = [];
  const { createReminder } = loadReminderService({
    createReminderInStore: (reminder) => {
      saved.push(reminder);
      return reminder;
    },
  });

  const reminder = createReminder({
    title: 'Archer Basketball Sunday 330-530',
  }, {
    createId: () => 'reminder-1',
  });

  expect(saved).toHaveLength(1);
  expect(reminder.title).toBe('Archer Basketball');
  expect(reminder.text).toBe('Archer Basketball');
  expect(reminder.due).toBe('2024-05-19T06:00:00.000Z');
  expect(reminder.dueAt).toBe('2024-05-19T06:00:00.000Z');
});
