const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderUrgency() {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderUrgency.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ');
  source += `
    module.exports = {
      URGENT_ALERT_LEAD_MINUTES,
      URGENT_OVERDUE_INTERVAL_MINUTES,
      URGENT_STAGE_KINDS,
      isUrgentTimedReminder,
      getReminderUrgency,
      getUrgentReminderState,
    };
  `;

  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, Date, Number, Object, Array });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const MINUTE = 60 * 1000;
const DUE_AT = Date.parse('2026-09-03T10:00:00.000Z');

const urgentReminder = (overrides = {}) => ({
  id: 'appointment-1',
  title: 'Appointment',
  due: new Date(DUE_AT).toISOString(),
  hasExplicitTime: true,
  urgentAlert: true,
  done: false,
  urgentAcknowledgedAt: null,
  urgentStartedAt: null,
  snoozedUntil: null,
  ...overrides,
});

test('timed reminders default to urgent while date-only reminders do not', () => {
  const { isUrgentTimedReminder } = loadReminderUrgency();

  expect(isUrgentTimedReminder({ due: new Date(DUE_AT).toISOString() })).toBe(true);
  expect(isUrgentTimedReminder({ due: '2026-09-03' })).toBe(false);
  expect(isUrgentTimedReminder(urgentReminder({ urgentAlert: false }))).toBe(false);
  expect(isUrgentTimedReminder(urgentReminder({ hasExplicitTime: false }))).toBe(false);
  expect(isUrgentTimedReminder(urgentReminder({ metadata: { suppressNotification: true } }))).toBe(false);
});

test.each([
  [16, null, null],
  [15, 't-15', 'upcoming'],
  [5, 't-5', 'upcoming'],
  [1, 't-1', 'upcoming'],
  [0, 'due', 'due'],
  [-4, 'due', 'due'],
  [-5, 'overdue-5', 'overdue'],
  [-12, 'overdue-10', 'overdue'],
])('selects the canonical urgency stage at %i minutes before due', (minutesBefore, key, kind) => {
  const { getReminderUrgency } = loadReminderUrgency();
  const state = getReminderUrgency(urgentReminder(), DUE_AT - (minutesBefore * MINUTE));

  expect(state.stage?.key || null).toBe(key);
  expect(state.stage?.kind || null).toBe(kind);
  if (state.stage) {
    expect(state.stage).toEqual(expect.objectContaining({
      key,
      kind,
      startAt: expect.any(Number),
      dueAt: DUE_AT,
    }));
  }
});

test('acknowledgement suppresses only the current stage', () => {
  const { getReminderUrgency } = loadReminderUrgency();
  const acknowledgedAt = DUE_AT - (14 * MINUTE);
  const reminder = urgentReminder({ urgentAcknowledgedAt: acknowledgedAt });

  const currentStage = getReminderUrgency(reminder, DUE_AT - (6 * MINUTE));
  expect(currentStage.stage.key).toBe('t-15');
  expect(currentStage.shouldBadge).toBe(true);
  expect(currentStage.shouldAlert).toBe(false);
  expect(currentStage.suppressionReason).toBe('acknowledged');

  const nextStage = getReminderUrgency(reminder, DUE_AT - (5 * MINUTE));
  expect(nextStage.stage.key).toBe('t-5');
  expect(nextStage.shouldAlert).toBe(true);
});

test('snooze suppresses alerts until expiry and then creates a fresh stage', () => {
  const { getReminderUrgency } = loadReminderUrgency();
  const snoozedUntil = DUE_AT - (10 * MINUTE);
  const reminder = urgentReminder({
    urgentAcknowledgedAt: DUE_AT - (14 * MINUTE),
    snoozedUntil: new Date(snoozedUntil).toISOString(),
  });

  const sleeping = getReminderUrgency(reminder, DUE_AT - (11 * MINUTE));
  expect(sleeping.stage.key).toBe('t-15');
  expect(sleeping.shouldBadge).toBe(true);
  expect(sleeping.shouldAlert).toBe(false);
  expect(sleeping.suppressionReason).toBe('snoozed');

  const awake = getReminderUrgency(reminder, snoozedUntil);
  expect(awake.stage.key).toBe(`snooze-${snoozedUntil}`);
  expect(awake.stage.startAt).toBe(snoozedUntil);
  expect(awake.shouldBadge).toBe(true);
  expect(awake.shouldAlert).toBe(true);

  const nextScheduledStage = getReminderUrgency(reminder, DUE_AT - (5 * MINUTE));
  expect(nextScheduledStage.stage.key).toBe('t-5');
});

test('Start or Join stops interruptions, while Done alone removes an active badge', () => {
  const { getReminderUrgency } = loadReminderUrgency();
  const now = DUE_AT - (5 * MINUTE);

  const started = getReminderUrgency(urgentReminder({ urgentStartedAt: now }), now);
  expect(started.shouldAlert).toBe(false);
  expect(started.shouldBadge).toBe(true);
  expect(started.suppressionReason).toBe('started');

  const done = getReminderUrgency(urgentReminder({ done: true, urgentStartedAt: now }), now);
  expect(done.shouldAlert).toBe(false);
  expect(done.shouldBadge).toBe(false);
  expect(done.suppressionReason).toBe('done');
});

test('aggregates badge and alert items without counting date-only or completed reminders', () => {
  const { getUrgentReminderState } = loadReminderUrgency();
  const now = DUE_AT - (5 * MINUTE);
  const state = getUrgentReminderState([
    urgentReminder({ id: 'alerting' }),
    urgentReminder({ id: 'started', urgentStartedAt: now }),
    urgentReminder({ id: 'done', done: true }),
    { id: 'date-only', due: '2026-09-03', hasExplicitTime: false, urgentAlert: false },
  ], now);

  expect(state.badgeCount).toBe(2);
  expect(state.badgeItems.map((item) => item.reminderId)).toEqual(['alerting', 'started']);
  expect(state.alertItems.map((item) => item.reminderId)).toEqual(['alerting']);
});
