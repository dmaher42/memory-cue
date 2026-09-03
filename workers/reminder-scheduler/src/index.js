import { getReminderUrgency } from '../../../src/reminders/reminderUrgency.js';
import {
  createFirebaseRestAdapter,
  firebaseRestDefaults,
} from './firebase-rest.js';
import {
  dispatchUrgentReminders,
  getSchedulerQueryCutoff,
} from './scheduler.js';

const DEFAULT_DELIVERY_BUDGET = 6;

function readPositiveInteger(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(maximum, Math.floor(numeric));
}

function publicSummary(summary, queryMayBeTruncated) {
  return {
    reminderCount: summary.reminderCount,
    alertCount: summary.alertCount,
    usersWithBadges: Object.values(summary.badgeCounts)
      .filter((count) => count > 0)
      .length,
    usersWithNoDevices: summary.usersWithNoDevices,
    deviceAttempts: summary.deviceAttempts,
    delivered: summary.delivered,
    deduplicated: summary.deduplicated,
    failed: summary.failed,
    budgetExhausted: summary.budgetExhausted,
    queryMayBeTruncated,
  };
}

export async function runSchedulerOnce(
  env,
  {
    nowMs = Date.now(),
    fetchImpl = fetch,
    cryptoImpl = crypto,
    logger = console,
  } = {}
) {
  const queryLimit = readPositiveInteger(
    env?.SCHEDULER_QUERY_LIMIT,
    firebaseRestDefaults.queryLimit,
    1000
  );
  const deliveryBudget = readPositiveInteger(
    env?.SCHEDULER_DELIVERY_BUDGET,
    DEFAULT_DELIVERY_BUDGET,
    150
  );
  const adapter = await createFirebaseRestAdapter(env, {
    fetchImpl,
    cryptoImpl,
    logger,
  });
  const reminders = await adapter.queryUrgentReminders(
    nowMs,
    getSchedulerQueryCutoff(nowMs),
    queryLimit
  );
  const summary = await dispatchUrgentReminders({
    reminders,
    nowMs,
    evaluateUrgency: getReminderUrgency,
    adapter,
    logger,
    maxDeviceAttempts: deliveryBudget,
    maxUserLookups: deliveryBudget,
  });
  const queryMayBeTruncated = reminders.length >= queryLimit;
  const safeSummary = publicSummary(summary, queryMayBeTruncated);
  safeSummary.subrequests = adapter.getBudgetState();
  if (summary.budgetExhausted) {
    logger.warn(
      'Urgent reminder run reached its delivery budget; remaining work is deferred',
      safeSummary
    );
  }
  if (queryMayBeTruncated) {
    logger.warn(
      'Urgent reminder query reached its safety limit; a larger limit or paging may be required',
      safeSummary
    );
  } else {
    logger.info('Urgent reminder scheduler run complete', safeSummary);
  }
  return summary;
}

export default {
  scheduled(controller, env, context) {
    const actualNow = Date.now();
    const scheduledNow = Number(controller?.scheduledTime);
    const nowMs = Number.isFinite(scheduledNow)
      ? Math.max(actualNow, scheduledNow)
      : actualNow;
    context.waitUntil(runSchedulerOnce(env, { nowMs }));
  },
};
