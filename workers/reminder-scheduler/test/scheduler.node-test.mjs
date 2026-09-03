import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { dispatchUrgentReminders } from '../src/scheduler.js';
import { loadCanonicalUrgency } from './load-canonical-urgency.js';

const MINUTE_MS = 60 * 1000;
const DUE_AT = Date.parse('2026-09-03T10:30:00+09:30');

let getReminderUrgency;

before(async () => {
  ({ getReminderUrgency } = await loadCanonicalUrgency());
});

function urgentReminder(overrides = {}) {
  return {
    id: 'appointment-42',
    userId: 'teacher-1',
    title: 'Dentist appointment',
    due: new Date(DUE_AT).toISOString(),
    urgentAlert: true,
    hasExplicitTime: true,
    done: false,
    updatedAt: DUE_AT - (60 * MINUTE_MS),
    ...overrides,
  };
}

function createMemoryAdapter({
  devices = [{ id: 'phone-1', token: 'secret-phone-token' }],
  send,
} = {}) {
  const deliveries = new Map();
  const sends = [];
  const claimKey = (delivery) => [
    delivery.userId,
    delivery.reminderId,
    delivery.dueAt,
    delivery.stageKey,
    delivery.deviceId,
  ].join('|');

  return {
    deliveries,
    sends,
    async listPushDevices() {
      return devices;
    },
    async claimDelivery(delivery) {
      const key = claimKey(delivery);
      const existing = deliveries.get(key);
      if (existing?.status === 'delivered' || existing?.status === 'permanent-failure') {
        return { claimed: false, deliveryId: key, reason: existing.status };
      }
      if (existing?.status === 'claimed') {
        return { claimed: false, deliveryId: key, reason: 'active-lease' };
      }
      const claim = {
        ...delivery,
        claimed: true,
        deliveryId: key,
        claimToken: 'claim-' + ((existing?.attemptCount || 0) + 1),
        attemptCount: (existing?.attemptCount || 0) + 1,
      };
      deliveries.set(key, {
        status: 'claimed',
        attemptCount: claim.attemptCount,
      });
      return claim;
    },
    async sendReminderPush(input) {
      sends.push(input);
      if (typeof send === 'function') {
        return send(input, sends.length);
      }
      return { ok: true, status: 200, messageName: 'sent-' + sends.length };
    },
    async markDeliveryDelivered(claim) {
      deliveries.set(claim.deliveryId, {
        status: 'delivered',
        attemptCount: claim.attemptCount,
      });
    },
    async markDeliveryFailed(claim, result) {
      deliveries.set(claim.deliveryId, {
        status: result.retryable === false ? 'permanent-failure' : 'failed',
        attemptCount: claim.attemptCount,
      });
    },
  };
}

async function run(reminders, nowMs, adapter) {
  return dispatchUrgentReminders({
    reminders,
    nowMs,
    evaluateUrgency: getReminderUrgency,
    adapter,
  });
}

test('delivers T-15 and T-5 once per device with deterministic stage deduplication', async () => {
  const adapter = createMemoryAdapter({
    devices: [
      { id: 'phone-1', token: 'phone-token' },
      { id: 'laptop-1', token: 'laptop-token' },
    ],
  });
  const reminder = urgentReminder();

  const first = await run([reminder], DUE_AT - (15 * MINUTE_MS), adapter);
  const duplicate = await run([reminder], DUE_AT - (14 * MINUTE_MS), adapter);
  const nextStage = await run([reminder], DUE_AT - (5 * MINUTE_MS), adapter);

  assert.equal(first.delivered, 2);
  assert.equal(duplicate.delivered, 0);
  assert.equal(duplicate.deduplicated, 2);
  assert.equal(nextStage.delivered, 2);
  assert.deepEqual(
    adapter.sends.map(({ urgency }) => urgency.stage.key),
    ['t-15', 't-15', 't-5', 't-5']
  );
});

test('duplicate device records for one push token produce only one alert', async () => {
  const adapter = createMemoryAdapter({
    devices: [
      { id: 'old-phone-record', token: 'same-phone-token', updatedAt: DUE_AT - 1000 },
      { id: 'current-phone-record', token: ' same-phone-token ', updatedAt: DUE_AT },
      { id: 'tablet-1', token: 'tablet-token', updatedAt: DUE_AT - 500 },
    ],
  });

  const summary = await run([
    urgentReminder(),
  ], DUE_AT - (15 * MINUTE_MS), adapter);

  assert.equal(summary.deviceAttempts, 2);
  assert.equal(summary.delivered, 2);
  assert.deepEqual(
    adapter.sends.map(({ device }) => device.id),
    ['current-phone-record', 'tablet-1']
  );
});

test('a finite delivery budget defers safely and rotates devices across runs', async () => {
  const adapter = createMemoryAdapter({
    devices: Array.from({ length: 8 }, (_, index) => ({
      id: 'phone-' + index,
      token: 'phone-token-' + index,
    })),
  });
  const reminder = urgentReminder();

  const first = await dispatchUrgentReminders({
    reminders: [reminder],
    nowMs: DUE_AT - (15 * MINUTE_MS),
    evaluateUrgency: getReminderUrgency,
    adapter,
    maxDeviceAttempts: 3,
    maxUserLookups: 3,
  });
  const second = await dispatchUrgentReminders({
    reminders: [reminder],
    nowMs: DUE_AT - (14 * MINUTE_MS),
    evaluateUrgency: getReminderUrgency,
    adapter,
    maxDeviceAttempts: 3,
    maxUserLookups: 3,
  });

  assert.equal(first.deviceAttempts, 3);
  assert.equal(first.budgetExhausted, true);
  assert.equal(second.deviceAttempts, 3);
  assert.equal(new Set(adapter.sends.map(({ device }) => device.id)).size, 6);
});

test('a finite budget does not starve a later reminder or user on the next run', async () => {
  const reminderAdapter = createMemoryAdapter();
  const reminders = Array.from({ length: 7 }, (_, index) => urgentReminder({
    id: 'appointment-' + index,
  }));
  const userAdapter = createMemoryAdapter();
  const userReminders = Array.from({ length: 7 }, (_, index) => urgentReminder({
    id: 'user-appointment-' + index,
    userId: 'teacher-' + index,
  }));
  const options = {
    nowMs: DUE_AT - (15 * MINUTE_MS),
    evaluateUrgency: getReminderUrgency,
    maxDeviceAttempts: 6,
    maxUserLookups: 6,
  };

  await dispatchUrgentReminders({
    ...options,
    reminders,
    adapter: reminderAdapter,
  });
  await dispatchUrgentReminders({
    ...options,
    nowMs: options.nowMs + MINUTE_MS,
    reminders,
    adapter: reminderAdapter,
  });
  await dispatchUrgentReminders({
    ...options,
    reminders: userReminders,
    adapter: userAdapter,
  });
  await dispatchUrgentReminders({
    ...options,
    nowMs: options.nowMs + MINUTE_MS,
    reminders: userReminders,
    adapter: userAdapter,
  });

  assert.equal(
    new Set(reminderAdapter.sends.map(({ reminder }) => reminder.id)).size,
    7
  );
  assert.equal(
    new Set(userAdapter.sends.map(({ claim }) => claim.userId)).size,
    7
  );
});

test('Seen suppresses only the current stage and the next stage alerts again', async () => {
  const adapter = createMemoryAdapter();
  const acknowledgedAt = DUE_AT - (14 * MINUTE_MS);
  const reminder = urgentReminder({ urgentAcknowledgedAt: acknowledgedAt });

  const sameStage = await run([reminder], DUE_AT - (10 * MINUTE_MS), adapter);
  const nextStage = await run([reminder], DUE_AT - (5 * MINUTE_MS), adapter);

  assert.equal(sameStage.alertCount, 0);
  assert.equal(sameStage.badgeCounts['teacher-1'], 1);
  assert.equal(nextStage.delivered, 1);
  assert.equal(adapter.sends[0].urgency.stage.key, 't-5');
});

test('Snooze suppresses alerts until its exact expiry and gives the expiry a unique stage', async () => {
  const snoozedUntil = DUE_AT - (3 * MINUTE_MS);
  const adapter = createMemoryAdapter();
  const reminder = urgentReminder({
    snoozedUntil: new Date(snoozedUntil).toISOString(),
  });

  const sleeping = await run([reminder], DUE_AT - (4 * MINUTE_MS), adapter);
  const expired = await run([reminder], snoozedUntil, adapter);

  assert.equal(sleeping.alertCount, 0);
  assert.equal(expired.delivered, 1);
  assert.equal(
    adapter.sends[0].urgency.stage.key,
    'snooze-' + snoozedUntil
  );
});

test('due and every five-minute overdue stages each deliver once', async () => {
  const adapter = createMemoryAdapter();
  const reminder = urgentReminder();

  await run([reminder], DUE_AT, adapter);
  await run([reminder], DUE_AT + (4 * MINUTE_MS), adapter);
  await run([reminder], DUE_AT + (5 * MINUTE_MS), adapter);
  await run([reminder], DUE_AT + (10 * MINUTE_MS), adapter);

  assert.deepEqual(
    adapter.sends.map(({ urgency }) => urgency.stage.key),
    ['due', 'overdue-5', 'overdue-10']
  );
});

test('Started keeps the badge but stops interruptions; Done clears both', async () => {
  const startedAdapter = createMemoryAdapter();
  const doneAdapter = createMemoryAdapter();
  const started = await run([
    urgentReminder({ urgentStartedAt: DUE_AT - (16 * MINUTE_MS) }),
  ], DUE_AT - (5 * MINUTE_MS), startedAdapter);
  const done = await run([
    urgentReminder({ done: true }),
  ], DUE_AT - (5 * MINUTE_MS), doneAdapter);

  assert.equal(started.alertCount, 0);
  assert.equal(started.badgeCounts['teacher-1'], 1);
  assert.equal(startedAdapter.sends.length, 0);
  assert.equal(done.alertCount, 0);
  assert.equal(done.badgeCounts['teacher-1'], 0);
  assert.equal(doneAdapter.sends.length, 0);
});

test('a transient failure retries only the failed device', async () => {
  let phoneAttempts = 0;
  const adapter = createMemoryAdapter({
    devices: [
      { id: 'phone-1', token: 'phone-token' },
      { id: 'laptop-1', token: 'laptop-token' },
    ],
    send({ device }) {
      if (device.id === 'phone-1') {
        phoneAttempts += 1;
        if (phoneAttempts === 1) {
          return { ok: false, retryable: true, status: 503 };
        }
      }
      return { ok: true, status: 200 };
    },
  });
  const reminder = urgentReminder();

  const first = await run([reminder], DUE_AT - (15 * MINUTE_MS), adapter);
  const retry = await run([reminder], DUE_AT - (14 * MINUTE_MS), adapter);

  assert.equal(first.delivered, 1);
  assert.equal(first.failed, 1);
  assert.equal(retry.delivered, 1);
  assert.equal(retry.deduplicated, 1);
  assert.deepEqual(
    adapter.sends.map(({ device }) => device.id),
    ['phone-1', 'laptop-1', 'phone-1']
  );
});

test('invalid reminders and devices cannot create delivery attempts', async () => {
  const adapter = createMemoryAdapter({
    devices: [
      { id: '', token: 'token-without-device' },
      { id: 'device-without-token', token: '' },
    ],
  });
  const summary = await run([
    urgentReminder({ id: '' }),
    urgentReminder({ userId: '' }),
    urgentReminder(),
  ], DUE_AT - (15 * MINUTE_MS), adapter);

  assert.equal(summary.reminderCount, 3);
  assert.equal(summary.alertCount, 1);
  assert.equal(summary.usersWithNoDevices, 1);
  assert.equal(summary.deviceAttempts, 0);
});
