const DEFAULT_LOOKAHEAD_MINUTES = 15;
const MINUTE_MS = 60 * 1000;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReminderUpdatedAt(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function normalizeReminderRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const userId = normalizeText(record.userId);
  const reminderId = normalizeText(record.id);
  if (!userId || !reminderId) {
    return null;
  }
  return {
    ...record,
    id: reminderId,
    userId,
  };
}

function normalizeDeviceRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const id = normalizeText(record.id);
  const token = normalizeText(record.token);
  if (!id || !token) {
    return null;
  }
  return {
    ...record,
    id,
    token,
  };
}

function deviceUpdatedAt(record) {
  const value = record?.updatedAt;
  if (value === null || typeof value === 'undefined' || value === '') {
    return Number.NEGATIVE_INFINITY;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}

function deduplicateDevicesByToken(records) {
  const byToken = new Map();
  records.forEach((record) => {
    const device = normalizeDeviceRecord(record);
    if (!device) {
      return;
    }
    const existing = byToken.get(device.token);
    if (!existing) {
      byToken.set(device.token, {
        ...device,
        registrationIds: [device.id],
      });
      return;
    }
    const registrationIds = [...new Set([
      ...(Array.isArray(existing.registrationIds) ? existing.registrationIds : [existing.id]),
      device.id,
    ])];
    const preferred = deviceUpdatedAt(device) > deviceUpdatedAt(existing)
      ? device
      : existing;
    byToken.set(device.token, {
      ...preferred,
      registrationIds,
    });
  });
  return [...byToken.values()];
}

function resolveBudget(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1, Math.floor(numeric))
    : Number.POSITIVE_INFINITY;
}

function rotateForRun(items, nowMs, stride) {
  if (items.length < 2 || !Number.isFinite(stride)) {
    return items;
  }
  const greatestCommonDivisor = (left, right) => {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  };
  let rotationStride = Math.max(1, Math.floor(stride) % items.length);
  while (rotationStride > 1 && greatestCommonDivisor(rotationStride, items.length) !== 1) {
    rotationStride -= 1;
  }
  const minuteBucket = Math.floor(nowMs / MINUTE_MS);
  const offset = (
    (minuteBucket * rotationStride) % items.length + items.length
  ) % items.length;
  return offset ? [...items.slice(offset), ...items.slice(0, offset)] : items;
}

function defaultLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createSummary(nowMs, reminderCount) {
  return {
    nowMs,
    reminderCount,
    alertCount: 0,
    badgeCounts: {},
    usersWithNoDevices: 0,
    deviceAttempts: 0,
    delivered: 0,
    deduplicated: 0,
    failed: 0,
    budgetExhausted: false,
  };
}

function groupUrgencyStates(reminders, evaluateUrgency, nowMs) {
  const byUser = new Map();
  reminders.forEach((rawReminder) => {
    const reminder = normalizeReminderRecord(rawReminder);
    if (!reminder) {
      return;
    }
    const urgency = evaluateUrgency(reminder, nowMs);
    if (!urgency || typeof urgency !== 'object') {
      return;
    }
    if (!byUser.has(reminder.userId)) {
      byUser.set(reminder.userId, []);
    }
    byUser.get(reminder.userId).push({
      reminder,
      urgency,
    });
  });
  return byUser;
}

export function getSchedulerQueryCutoff(
  nowMs = Date.now(),
  lookaheadMinutes = DEFAULT_LOOKAHEAD_MINUTES
) {
  const resolvedNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const resolvedLookahead = Number.isFinite(Number(lookaheadMinutes))
    ? Math.max(0, Number(lookaheadMinutes))
    : DEFAULT_LOOKAHEAD_MINUTES;
  return resolvedNow + (resolvedLookahead * MINUTE_MS);
}

export async function dispatchUrgentReminders({
  reminders = [],
  nowMs = Date.now(),
  evaluateUrgency,
  adapter,
  logger = defaultLogger(),
  maxDeviceAttempts = Number.POSITIVE_INFINITY,
  maxUserLookups = Number.POSITIVE_INFINITY,
} = {}) {
  if (typeof evaluateUrgency !== 'function') {
    throw new TypeError('evaluateUrgency must be a function');
  }
  const requiredMethods = [
    'listPushDevices',
    'claimDelivery',
    'sendReminderPush',
    'markDeliveryDelivered',
    'markDeliveryFailed',
  ];
  requiredMethods.forEach((method) => {
    if (!adapter || typeof adapter[method] !== 'function') {
      throw new TypeError('adapter.' + method + ' must be a function');
    }
  });

  const resolvedNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const normalizedReminders = Array.isArray(reminders) ? reminders : [];
  const deviceAttemptBudget = resolveBudget(maxDeviceAttempts);
  const userLookupBudget = resolveBudget(maxUserLookups);
  let userLookups = 0;
  const summary = createSummary(resolvedNow, normalizedReminders.length);
  const statesByUser = groupUrgencyStates(
    normalizedReminders,
    evaluateUrgency,
    resolvedNow
  );

  const userEntries = rotateForRun(
    [...statesByUser.entries()],
    resolvedNow,
    1
  );
  userLoop:
  for (const [userId, states] of userEntries) {
    const badgeCount = states.filter(({ urgency }) => urgency.shouldBadge).length;
    summary.badgeCounts[userId] = badgeCount;
    const alerts = states.filter(({ urgency }) => (
      urgency.shouldAlert
      && urgency.stage
      && Number.isFinite(Number(urgency.dueAt))
    ));
    summary.alertCount += alerts.length;
    if (!alerts.length) {
      continue;
    }

    if (userLookups >= userLookupBudget) {
      summary.budgetExhausted = true;
      break;
    }
    userLookups += 1;

    let devices = [];
    try {
      const listedDevices = await adapter.listPushDevices(userId);
      devices = deduplicateDevicesByToken(
        Array.isArray(listedDevices) ? listedDevices : []
      );
    } catch (error) {
      summary.failed += alerts.length;
      logger.error('Unable to list reminder push devices', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!devices.length) {
      summary.usersWithNoDevices += 1;
      continue;
    }

    const deliveryCandidates = rotateForRun(
      alerts.flatMap(({ reminder, urgency }) => (
        devices.map((device) => ({ reminder, urgency, device }))
      )),
      resolvedNow,
      deviceAttemptBudget
    );
    for (const { reminder, urgency, device } of deliveryCandidates) {
      if (summary.deviceAttempts >= deviceAttemptBudget) {
        summary.budgetExhausted = true;
        break userLoop;
      }
      summary.deviceAttempts += 1;
      const delivery = {
          userId,
          reminderId: reminder.id,
          dueAt: Number(urgency.dueAt),
          stageKey: urgency.stage.key,
          deviceId: device.id,
          reminderUpdatedAt: normalizeReminderUpdatedAt(reminder.updatedAt),
          nowMs: resolvedNow,
      };

      let claim = null;
      try {
        claim = await adapter.claimDelivery(delivery);
      } catch (error) {
        summary.failed += 1;
        logger.error('Unable to claim urgent reminder delivery', {
          ...delivery,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!claim || claim.claimed !== true) {
        summary.deduplicated += 1;
        continue;
      }

      let sendResult;
      try {
        sendResult = await adapter.sendReminderPush({
          claim,
          device,
          reminder,
          urgency,
          badgeCount,
        });
      } catch (error) {
        sendResult = {
          ok: false,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (sendResult?.ok === true) {
        try {
          await adapter.markDeliveryDelivered(claim, sendResult);
          summary.delivered += 1;
        } catch (error) {
          summary.failed += 1;
          logger.error('Urgent reminder push sent but delivery record was not finalised', {
            deliveryId: claim.deliveryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      summary.failed += 1;
      try {
        await adapter.markDeliveryFailed(claim, sendResult || {
          ok: false,
          retryable: true,
          error: 'Unknown push delivery failure',
        }, device);
      } catch (error) {
        logger.error('Unable to record urgent reminder push failure', {
          deliveryId: claim.deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return summary;
}

export const schedulerDefaults = Object.freeze({
  lookaheadMinutes: DEFAULT_LOOKAHEAD_MINUTES,
});
