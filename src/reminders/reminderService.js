import { normalizeReminder } from './reminderNormalizer.js';

import {
  createReminder as createReminderInStore,
  updateReminder as updateReminderInStore,
  deleteReminder as deleteReminderInStore,
  loadReminders,
  getReminders,
} from './reminderStore.js';

function runHook(hook, payload) {
  if (typeof hook === 'function') {
    return hook(payload);
  }
  return payload;
}

const REMINDER_MONTH_NAME_TO_INDEX = Object.freeze({
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
});

const REMINDER_WEEKDAY_NAME_PATTERN = '(?:monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)';
const REMINDER_MONTH_NAME_PATTERN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const REMINDER_DAY_MONTH_DATE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${REMINDER_MONTH_NAME_PATTERN})(?:\\s+(\\d{4}))?\\b`,
  'i',
);
const REMINDER_MONTH_DAY_DATE_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(${REMINDER_MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`,
  'i',
);
const REMINDER_DAY_MONTH_DATE_STRIP_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?(?:\\d{1,2})(?:st|nd|rd|th)?\\s+${REMINDER_MONTH_NAME_PATTERN}(?:\\s+\\d{4})?\\b`,
  'gi',
);
const REMINDER_MONTH_DAY_DATE_STRIP_PATTERN = new RegExp(
  `\\b(?:on\\s+)?(?:${REMINDER_WEEKDAY_NAME_PATTERN}\\s*,?\\s*)?${REMINDER_MONTH_NAME_PATTERN}\\s+(?:\\d{1,2})(?:st|nd|rd|th)?(?:\\s+\\d{4})?\\b`,
  'gi',
);
const REMINDER_TIME_RANGE_PATTERN = /\b(?:at\s*)?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(?:at\s*)?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i;
const REMINDER_TIME_RANGE_STRIP_PATTERN = /\b(?:at\s*)?\d{1,2}(?::?\d{2})?\s*(?:am|pm)?\s*(?:-|–|to)\s*(?:at\s*)?\d{1,2}(?::?\d{2})?\s*(?:am|pm)?\b/gi;

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const stripQuickReminderPrefix = (text) => normalizeText(text).replace(/^\s*!\s*/, '').trim();

const setTimeOnDate = (date, hours, minutes = 0) => {
  const nextDate = new Date(date.getTime());
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
};

const toIsoString = (date) => (date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null);

const parseReminderTimeRangeFromText = (rawText) => {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    return null;
  }

  const match = text.match(REMINDER_TIME_RANGE_PATTERN);
  if (!match) {
    return null;
  }

  let startHours = Number.parseInt(match[1], 10);
  const startMinutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const startMeridiem = typeof match[3] === 'string' ? match[3].toLowerCase() : '';
  let endHours = Number.parseInt(match[4], 10);
  const endMinutes = match[5] ? Number.parseInt(match[5], 10) : 0;
  const endMeridiem = typeof match[6] === 'string' ? match[6].toLowerCase() : '';

  if (!Number.isFinite(startHours) || !Number.isFinite(startMinutes) || !Number.isFinite(endHours) || !Number.isFinite(endMinutes)) {
    return null;
  }

  let inferredMeridiem = startMeridiem || endMeridiem || '';
  if (!inferredMeridiem && startHours <= 6 && endHours <= 6) {
    inferredMeridiem = 'pm';
  }

  if (inferredMeridiem === 'pm') {
    if (!startMeridiem && startHours < 12) {
      startHours += 12;
    }
    if (!endMeridiem && endHours < 12) {
      endHours += 12;
    }
  } else if (inferredMeridiem === 'am') {
    if (!startMeridiem && startHours === 12) {
      startHours = 0;
    }
    if (!endMeridiem && endHours === 12) {
      endHours = 0;
    }
  }

  return {
    start: { hours: startHours, minutes: startMinutes },
    end: { hours: endHours, minutes: endMinutes },
    text: match[0],
  };
};

const parseReminderTimeParts = (rawText) => {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    return null;
  }

  const compactMeridiemMatch = text.match(/\b(?:at\s*)?(\d{3,4})\s*(am|pm)\b/i);
  if (compactMeridiemMatch) {
    const digits = compactMeridiemMatch[1];
    const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const minuteDigits = digits.length === 3 ? digits.slice(1) : digits.slice(2);
    return {
      hours: Number.parseInt(hourDigits, 10),
      minutes: Number.parseInt(minuteDigits, 10),
      meridiem: compactMeridiemMatch[2],
    };
  }

  const meridiemMatch = text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (meridiemMatch) {
    return {
      hours: Number.parseInt(meridiemMatch[1], 10),
      minutes: meridiemMatch[2] ? Number.parseInt(meridiemMatch[2], 10) : 0,
      meridiem: meridiemMatch[3],
    };
  }

  const twentyFourHourMatch = text.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourMatch) {
    return {
      hours: Number.parseInt(twentyFourHourMatch[1], 10),
      minutes: Number.parseInt(twentyFourHourMatch[2], 10),
      meridiem: '',
    };
  }

  const compactTimeMatch = text.match(/\b(?:at\s*)?(\d{3,4})\b/);
  if (compactTimeMatch) {
    const digits = compactTimeMatch[1];
    const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const minuteDigits = digits.length === 3 ? digits.slice(1) : digits.slice(2);
    const hours = Number.parseInt(hourDigits, 10);
    const minutes = Number.parseInt(minuteDigits, 10);
    if (Number.isFinite(hours) && Number.isFinite(minutes) && hours <= 23 && minutes < 60) {
      return {
        hours,
        minutes,
        meridiem: '',
      };
    }
  }

  return null;
};

const cleanReminderTitle = (text) => {
  let cleaned = stripQuickReminderPrefix(text);
  if (!cleaned) {
    return '';
  }

  cleaned = cleaned
    .replace(/\b(?:today|tomorrow|tonight|next week|morning|afternoon|evening|night)\b/gi, ' ')
    .replace(/\b(?:(?:next)\s+)?(?:monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/gi, ' ')
    .replace(REMINDER_DAY_MONTH_DATE_STRIP_PATTERN, ' ')
    .replace(REMINDER_MONTH_DAY_DATE_STRIP_PATTERN, ' ')
    .replace(REMINDER_TIME_RANGE_STRIP_PATTERN, ' ')
    .replace(/\b(?:at\s*)?(?:\d{1,2}(?::\d{2})?|\d{3,4})\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:at\s*)?\d{1,2}:\d{2}\b/gi, ' ')
    .replace(/^[,.\-:;\s]+|[,.\-:;\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(?:and|to)\b\s*/i, '')
    .replace(/\b(?:at|on|by|for)\b\s*$/i, '')
    .trim();

  return cleaned;
};

const parseReminderSchedule = (payload = {}) => {
  const sourceText = typeof payload?.text === 'string' && payload.text.trim()
    ? payload.text.trim()
    : typeof payload?.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : '';
  if (!sourceText) {
    return {
      cleanedText: '',
      dueAt: null,
      notifyAt: null,
    };
  }

  const now = new Date();
  const normalized = normalizeText(sourceText);
  const text = normalized.toLowerCase();
  const timeRange = parseReminderTimeRangeFromText(normalized);
  const timeParts = parseReminderTimeParts(normalized);
  const dayMatch = text.match(/\b(?:(next)\s+)?(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i);
  const weekdayOrder = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  const resolveRelativeDayOffset = () => {
    if (text.includes('tomorrow')) {
      return 1;
    }
    if (text.includes('today') || text.includes('tonight')) {
      return 0;
    }
    if (!dayMatch) {
      return null;
    }
    const targetDay = weekdayOrder[(dayMatch[2] || '').toLowerCase()];
    if (!Number.isFinite(targetDay)) {
      return null;
    }
    let dayOffset = (targetDay - now.getDay() + 7) % 7;
    if (dayOffset === 0 && dayMatch[1]) {
      dayOffset = 7;
    }
    return dayOffset;
  };
  const relativeDayOffset = resolveRelativeDayOffset();

  const buildCandidate = (year, monthIndex, day, timePartsValue) => {
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
      return null;
    }

    const candidate = new Date(now.getTime());
    candidate.setFullYear(year, monthIndex, day);
    candidate.setHours(0, 0, 0, 0);
    if (
      candidate.getFullYear() !== year
      || candidate.getMonth() !== monthIndex
      || candidate.getDate() !== day
    ) {
      return null;
    }

    const resolvedTime = timePartsValue || { hours: 9, minutes: 0 };
    candidate.setHours(resolvedTime.hours, resolvedTime.minutes, 0, 0);
    return candidate;
  };

  let dueDate = null;
  const dayMonthMatch = normalized.match(REMINDER_DAY_MONTH_DATE_PATTERN);
  if (dayMonthMatch) {
    const monthIndex = REMINDER_MONTH_NAME_TO_INDEX[dayMonthMatch[2]];
    const day = Number.parseInt(dayMonthMatch[1], 10);
    const year = dayMonthMatch[3] ? Number.parseInt(dayMonthMatch[3], 10) : now.getFullYear();
    const candidate = buildCandidate(year, monthIndex, day, timeRange?.start || parseReminderTimeParts(normalized));
    if (candidate) {
      dueDate = candidate;
    }
  }

  if (!dueDate) {
    const monthDayMatch = normalized.match(REMINDER_MONTH_DAY_DATE_PATTERN);
    if (monthDayMatch) {
      const monthIndex = REMINDER_MONTH_NAME_TO_INDEX[monthDayMatch[1]];
      const day = Number.parseInt(monthDayMatch[2], 10);
      const year = monthDayMatch[3] ? Number.parseInt(monthDayMatch[3], 10) : now.getFullYear();
      const candidate = buildCandidate(year, monthIndex, day, timeRange?.start || parseReminderTimeParts(normalized));
      if (candidate) {
        dueDate = candidate;
      }
    }
  }

  if (!dueDate && timeRange) {
    const candidate = new Date(now.getTime());
    if (Number.isFinite(relativeDayOffset)) {
      candidate.setDate(candidate.getDate() + relativeDayOffset);
    }
    candidate.setHours(timeRange.start.hours, timeRange.start.minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + (dayMatch ? 7 : 1));
    }
    dueDate = candidate;
  }

  if (!dueDate) {
    if (timeParts) {
      const baseDate = new Date(now.getTime());
      if (Number.isFinite(relativeDayOffset)) {
        baseDate.setDate(baseDate.getDate() + relativeDayOffset);
      } else if (text.includes('next week')) {
        baseDate.setDate(baseDate.getDate() + 7);
      } else if (text.includes('tomorrow')) {
        baseDate.setDate(baseDate.getDate() + 1);
      }

      let hours = timeParts.hours;
      const minutes = timeParts.minutes;
      const meridiem = typeof timeParts.meridiem === 'string' ? timeParts.meridiem.toLowerCase() : '';
      if (meridiem === 'pm' && hours < 12) {
        hours += 12;
      }
      if (meridiem === 'am' && hours === 12) {
        hours = 0;
      }
      baseDate.setHours(hours, minutes, 0, 0);
      dueDate = baseDate;
    }
  }

  const cleanedText = cleanReminderTitle(sourceText);
  const dueAt = toIsoString(dueDate);
  const notifyAt = dueDate instanceof Date && Number.isFinite(dueDate.getTime())
    ? new Date(dueDate.getTime() - 10 * 60 * 1000).toISOString()
    : null;

  return {
    cleanedText,
    dueAt,
    notifyAt,
  };
};

export function createReminder(payload = {}, options = {}) {
  const schedule = parseReminderSchedule(payload);
  const reminderText = schedule.cleanedText || (typeof payload.text === 'string' && payload.text.trim()
    ? payload.text.trim()
    : typeof payload.title === 'string'
      ? payload.title.trim()
      : '');
  if (!reminderText) {
    return null;
  }

  const hasExplicitDue = typeof payload.dueAt === 'string' && payload.dueAt.trim()
    || typeof payload.due === 'string' && payload.due.trim()
    || payload.dueAt instanceof Date
    || payload.due instanceof Date;
  const resolvedDueAt = hasExplicitDue
    ? (typeof payload.dueAt === 'string' && payload.dueAt.trim()
      ? payload.dueAt.trim()
      : typeof payload.due === 'string' && payload.due.trim()
        ? payload.due.trim()
        : payload.dueAt instanceof Date
          ? payload.dueAt.toISOString()
          : payload.due instanceof Date
            ? payload.due.toISOString()
            : null)
    : schedule.dueAt;
  const resolvedNotifyAt = hasExplicitDue
    ? (typeof payload.notifyAt === 'string' && payload.notifyAt.trim()
      ? payload.notifyAt.trim()
      : payload.notifyAt instanceof Date
        ? payload.notifyAt.toISOString()
        : null)
    : schedule.notifyAt;

  const normalizeReminderRecord = typeof options.normalizeReminder === 'function' ? options.normalizeReminder : normalizeReminder;
  const createId = options.createId;
  const category = options.defaultCategory;
  const reminder = normalizeReminderRecord({
    ...payload,
    text: reminderText,
    title: reminderText,
    dueAt: resolvedDueAt || payload.dueAt || payload.due || null,
    due: resolvedDueAt || payload.dueAt || payload.due || null,
    notifyAt: resolvedNotifyAt || payload.notifyAt || null,
    id: typeof createId === 'function' ? createId() : payload.id,
    completed: false,
    pendingSync: !!options.pendingSync,
    category: payload.category ?? category,
    priority: payload.priority || 'medium',
  });

  createReminderInStore(reminder);
  runHook(options.onCreated, reminder);
  return reminder;
}

export function updateReminder(id, updates = {}, options = {}) {
  if (!id) {
    return null;
  }
  const updated = updateReminderInStore(id, updates);
  if (!updated) {
    return null;
  }
  runHook(options.onUpdated, updated);
  return updated;
}

export function deleteReminder(id, options = {}) {
  if (!id) {
    return false;
  }
  const removed = deleteReminderInStore(id);
  if (!removed) {
    return false;
  }
  runHook(options.onDeleted, { id });
  return true;
}

export function completeReminder(id, completed = true, options = {}) {
  if (!id) {
    return null;
  }
  const updated = updateReminderInStore(id, {
    done: !!completed,
    completed: !!completed,
    updatedAt: Date.now(),
  });
  if (!updated) {
    return null;
  }
  runHook(options.onCompleted, updated);
  return updated;
}

export function loadReminderList() {
  return loadReminders();
}

export function getReminderList() {
  return getReminders();
}
