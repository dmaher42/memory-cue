/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderPayloadBuilder() {
  const filePath = path.resolve(__dirname, '../../src/services/reminderService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { buildReminderPayload };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    Date,
    Number,
    String,
    Array,
    Object,
    console,
    window: undefined,
  });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('payload builder preserves supplied urgency flags', () => {
  const { buildReminderPayload } = loadReminderPayloadBuilder();

  expect(buildReminderPayload({
    text: 'Dentist appointment',
    dueAt: '2026-09-03T10:00:00.000Z',
    hasExplicitTime: true,
    urgentAlert: true,
  })).toEqual(expect.objectContaining({
    hasExplicitTime: true,
    urgentAlert: true,
  }));

  expect(buildReminderPayload({
    text: 'Return permission form',
    dueAt: '2026-09-03T09:00:00.000Z',
    hasExplicitTime: false,
    urgentAlert: false,
  })).toEqual(expect.objectContaining({
    hasExplicitTime: false,
    urgentAlert: false,
  }));
});

test.each([
  ['2026-09-03T10:00:00.000Z'],
  [Date.parse('2026-09-03T10:00:00.000Z')],
])('payload builder keeps dueAt %p but leaves missing urgency flags for the controller', (dueAt) => {
  const { buildReminderPayload } = loadReminderPayloadBuilder();
  const payload = buildReminderPayload({ text: 'Legacy reminder', dueAt });

  expect(payload.dueAt).toBe(Date.parse('2026-09-03T10:00:00.000Z'));
  expect(Object.prototype.hasOwnProperty.call(payload, 'hasExplicitTime')).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(payload, 'urgentAlert')).toBe(false);
});
