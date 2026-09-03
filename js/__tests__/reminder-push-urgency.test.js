const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPrivateFunctions(relativePath, names) {
  const filePath = path.join(__dirname, '..', '..', relativePath);
  let source = fs.readFileSync(filePath, 'utf8')
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += `\nmodule.exports = { ${names.join(', ')} };\n`;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    Math,
    URL,
  }, { filename: filePath });
  return module.exports;
}

describe('cross-device urgent reminder payloads', () => {
  test('preserves urgency state without turning missing timestamps into zero', () => {
    const client = loadPrivateFunctions(
      'src/reminders/reminderPushSync.js',
      ['buildReminderSyncPayload']
    );
    const api = loadPrivateFunctions(
      'functions/api/push-reminder-sync.js',
      ['normalizeReminderPayload']
    );
    const acknowledgedAt = '2026-09-03T10:15:00+09:30';
    const source = {
      id: 'appointment-42',
      title: 'Dentist appointment',
      due: '2026-09-03T10:30:00+09:30',
      urgentAlert: true,
      hasExplicitTime: true,
      urgentAcknowledgedAt: acknowledgedAt,
      urgentStartedAt: null,
      updatedAt: null,
      done: true,
      notes: 'Join at https://meet.example.test/appointment-42',
    };

    const clientPayload = client.buildReminderSyncPayload(source);
    const apiPayload = api.normalizeReminderPayload(clientPayload);

    expect(clientPayload).toEqual(expect.objectContaining({
      urgentAlert: true,
      hasExplicitTime: true,
      urgentAcknowledgedAt: Date.parse(acknowledgedAt),
      urgentStartedAt: null,
      updatedAt: expect.any(Number),
      done: true,
      meetingUrl: 'https://meet.example.test/appointment-42',
    }));
    expect(apiPayload).toEqual(expect.objectContaining({
      urgentAlert: true,
      hasExplicitTime: true,
      urgentAcknowledgedAt: Date.parse(acknowledgedAt),
      urgentStartedAt: null,
      updatedAt: expect.any(Number),
      done: true,
      meetingUrl: 'https://meet.example.test/appointment-42',
    }));
    expect(clientPayload.updatedAt).toBeGreaterThan(0);
    expect(apiPayload.updatedAt).toBeGreaterThan(0);
  });
});
