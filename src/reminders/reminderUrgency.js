const MINUTE_MS = 60 * 1000;

export const URGENT_ALERT_LEAD_MINUTES = Object.freeze([15, 5, 1]);
export const URGENT_OVERDUE_INTERVAL_MINUTES = 5;
export const URGENT_STAGE_KINDS = Object.freeze({
  UPCOMING: 'upcoming',
  DUE: 'due',
  OVERDUE: 'overdue',
});

function readTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readDueAt(reminder) {
  if (!reminder || typeof reminder !== 'object') {
    return null;
  }
  return readTimestamp(reminder.dueAt ?? reminder.due ?? reminder.dueDate);
}

function isCompleted(reminder) {
  return reminder?.done === true
    || reminder?.completed === true
    || reminder?.isDone === true
    || reminder?.status === 'done';
}

function inferHasExplicitTime(reminder, dueAt) {
  if (!Number.isFinite(dueAt)) {
    return false;
  }
  // A timestamp proves when a reminder is due, but not that the user supplied
  // a time. Older date-only reminders were also stored as full ISO timestamps,
  // so urgency must rely on the explicit provenance flag.
  return reminder?.hasExplicitTime === true;
}

function buildUpcomingStage(minutes, dueAt) {
  return {
    key: `t-${minutes}`,
    label: minutes === 1 ? '1 minute to go' : `${minutes} minutes to go`,
    kind: URGENT_STAGE_KINDS.UPCOMING,
    startAt: dueAt - (minutes * MINUTE_MS),
    dueAt,
  };
}

function getCurrentStage(dueAt, nowMs) {
  if (nowMs < dueAt) {
    for (let index = URGENT_ALERT_LEAD_MINUTES.length - 1; index >= 0; index -= 1) {
      const minutes = URGENT_ALERT_LEAD_MINUTES[index];
      const stage = buildUpcomingStage(minutes, dueAt);
      if (nowMs >= stage.startAt) {
        return stage;
      }
    }
    return null;
  }

  const overdueMinutes = Math.floor((nowMs - dueAt) / (URGENT_OVERDUE_INTERVAL_MINUTES * MINUTE_MS))
    * URGENT_OVERDUE_INTERVAL_MINUTES;
  if (overdueMinutes < URGENT_OVERDUE_INTERVAL_MINUTES) {
    return {
      key: 'due',
      label: 'Due now',
      kind: URGENT_STAGE_KINDS.DUE,
      startAt: dueAt,
      dueAt,
    };
  }

  return {
    key: `overdue-${overdueMinutes}`,
    label: `${overdueMinutes} minutes overdue`,
    kind: URGENT_STAGE_KINDS.OVERDUE,
    startAt: dueAt + (overdueMinutes * MINUTE_MS),
    dueAt,
  };
}

export function isUrgentTimedReminder(reminder) {
  if (reminder?.metadata?.suppressNotification === true) {
    return false;
  }
  const dueAt = readDueAt(reminder);
  const hasExplicitTime = inferHasExplicitTime(reminder, dueAt);
  const urgentAlert = reminder?.urgentAlert === true;
  return Boolean(urgentAlert && hasExplicitTime && Number.isFinite(dueAt));
}

export function getReminderUrgency(reminder, nowMs = Date.now()) {
  const resolvedNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const dueAt = readDueAt(reminder);
  const urgent = isUrgentTimedReminder(reminder);
  const baseStage = urgent && Number.isFinite(dueAt) ? getCurrentStage(dueAt, resolvedNow) : null;
  const done = isCompleted(reminder);
  const startedAt = readTimestamp(reminder?.urgentStartedAt);
  const acknowledgedAt = readTimestamp(reminder?.urgentAcknowledgedAt);
  const snoozedUntil = readTimestamp(reminder?.snoozedUntil);
  const stage = baseStage
    && snoozedUntil !== null
    && snoozedUntil <= resolvedNow
    && snoozedUntil > baseStage.startAt
    ? {
        ...baseStage,
        key: `snooze-${snoozedUntil}`,
        label: 'Snooze finished',
        startAt: snoozedUntil,
      }
    : baseStage;
  const shouldBadge = Boolean(stage && !done);

  let suppressionReason = null;
  if (!urgent) {
    suppressionReason = 'not-urgent';
  } else if (done) {
    suppressionReason = 'done';
  } else if (!stage) {
    suppressionReason = 'not-in-window';
  } else if (startedAt !== null) {
    suppressionReason = 'started';
  } else if (snoozedUntil !== null && snoozedUntil > resolvedNow) {
    suppressionReason = 'snoozed';
  } else if (acknowledgedAt !== null && acknowledgedAt >= stage.startAt) {
    suppressionReason = 'acknowledged';
  }

  return {
    reminder,
    reminderId: typeof reminder?.id === 'string' ? reminder.id : null,
    urgent,
    dueAt,
    stage,
    shouldBadge,
    shouldAlert: Boolean(shouldBadge && suppressionReason === null),
    suppressionReason,
  };
}

export function getUrgentReminderState(reminders = [], nowMs = Date.now()) {
  const items = (Array.isArray(reminders) ? reminders : [])
    .map((reminder) => getReminderUrgency(reminder, nowMs));
  const badgeItems = items.filter((item) => item.shouldBadge);
  const alertItems = items.filter((item) => item.shouldAlert);

  return {
    items,
    badgeItems,
    alertItems,
    badgeCount: badgeItems.length,
  };
}
