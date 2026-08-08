const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

export const MEMORY_COACH_SCHEMA_VERSION = 1;
export const MEMORY_COACH_INTERVAL_DAYS = Object.freeze([1, 3, 7, 14, 30, 60]);
export const MEMORY_COACH_HISTORY_LIMIT = 50;
export const MEMORY_COACH_RATINGS = Object.freeze({
  FORGOT: 'forgot',
  HARD: 'hard',
  GOT_IT: 'got_it',
});

const normalizeText = (value, maxLength = 1200) => (
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
);

const normalizeTextList = (value, limit = 3, maxLength = 320) => (
  Array.isArray(value)
    ? value
      .map((item) => normalizeText(item, maxLength))
      .filter((item, index, list) => item && list.indexOf(item) === index)
      .slice(0, limit)
    : []
);

const clampInteger = (value, min, max, fallback = min) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
};

const toIsoString = (value, fallback = null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  return fallback;
};

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizeReviewHistory = (value) => (
  Array.isArray(value)
    ? value
      .map((review) => {
        if (!review || typeof review !== 'object') {
          return null;
        }
        const rating = Object.values(MEMORY_COACH_RATINGS).includes(review.rating)
          ? review.rating
          : null;
        const effectiveRating = Object.values(MEMORY_COACH_RATINGS).includes(review.effectiveRating)
          ? review.effectiveRating
          : rating;
        const reviewedAt = toIsoString(review.reviewedAt, null);
        if (!rating || !reviewedAt) {
          return null;
        }
        return {
          reviewedAt,
          dueAtBefore: toIsoString(review.dueAtBefore, null),
          rating,
          effectiveRating,
          hintUsed: review.hintUsed === true,
          wasEarly: review.wasEarly === true,
          stageBefore: clampInteger(review.stageBefore, 0, MEMORY_COACH_INTERVAL_DAYS.length - 1, 0),
          stageAfter: clampInteger(review.stageAfter, 0, MEMORY_COACH_INTERVAL_DAYS.length - 1, 0),
          intervalDays: clampInteger(review.intervalDays, 0, 365, 0),
        };
      })
      .filter(Boolean)
      .slice(-MEMORY_COACH_HISTORY_LIMIT)
    : []
);

const normalizeAnswerKey = (value) => normalizeText(value, 120).toLocaleLowerCase();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const maskPracticeAnswer = (value, answer) => {
  const text = normalizeText(value);
  const normalizedAnswer = normalizeText(answer, 120);
  if (!text || !normalizedAnswer) {
    return text;
  }
  return text.replace(new RegExp(escapeRegExp(normalizedAnswer), 'gi'), '_____');
};

export const normalizeMemoryCoachMetadata = (value, options = {}) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const answer = normalizeText(value.answer, 120);
  const explanation = normalizeText(value.explanation, 600);
  const fallbackPrompt = explanation ? `Which word means: ${explanation}` : '';
  const prompt = maskPracticeAnswer(normalizeText(value.prompt, 600) || fallbackPrompt, answer);
  if (!answer || !prompt) {
    return null;
  }

  const fallbackNow = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const createdAt = toIsoString(value.createdAt, new Date(fallbackNow).toISOString());
  const dueAt = toIsoString(value.dueAt, createdAt);
  const updatedAt = toIsoString(value.updatedAt, createdAt);
  const lastReviewedAt = toIsoString(value.lastReviewedAt, null);
  const lastRating = Object.values(MEMORY_COACH_RATINGS).includes(value.lastRating)
    ? value.lastRating
    : null;

  return {
    schemaVersion: MEMORY_COACH_SCHEMA_VERSION,
    kind: value.kind === 'vocabulary' ? 'vocabulary' : 'memory',
    prompt,
    answer,
    explanation,
    example: normalizeText(value.example, 600),
    hints: normalizeTextList(value.hints).map((hint) => maskPracticeAnswer(hint, answer)),
    alternatives: normalizeTextList(value.alternatives, 5, 120),
    enabled: value.enabled !== false,
    createdAt,
    updatedAt,
    dueAt,
    lastReviewedAt,
    lastRating,
    stage: clampInteger(value.stage, 0, MEMORY_COACH_INTERVAL_DAYS.length - 1, 0),
    reviewCount: clampInteger(value.reviewCount, 0, 100000, 0),
    streak: clampInteger(value.streak, 0, 100000, 0),
    lapses: clampInteger(value.lapses, 0, 100000, 0),
    history: normalizeReviewHistory(value.history),
  };
};

export const isMemoryCoachEntry = (entry) => Boolean(
  entry
  && typeof entry === 'object'
  && typeof entry.id === 'string'
  && normalizeMemoryCoachMetadata(entry?.metadata?.memoryCoach)
);

const toPracticeItem = (entry, options = {}) => {
  const coach = normalizeMemoryCoachMetadata(entry?.metadata?.memoryCoach, options);
  if (!coach || typeof entry?.id !== 'string' || !entry.id.trim()) {
    return null;
  }
  return {
    id: entry.id.trim(),
    entry,
    ...coach,
    dueTimestamp: toTimestamp(coach.dueAt) ?? 0,
    isNew: coach.reviewCount === 0,
  };
};

export const getMemoryCoachItems = (entries = [], options = {}) => (
  (Array.isArray(entries) ? entries : [])
    .map((entry) => toPracticeItem(entry, options))
    .filter((item) => item && (options.includePaused === true || item.enabled))
    .sort((a, b) => (
      a.dueTimestamp - b.dueTimestamp
      || b.lapses - a.lapses
      || a.createdAt.localeCompare(b.createdAt)
    ))
);

export const getDuePracticeItems = (entries = [], options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const limit = clampInteger(options.limit, 1, 20, 8);
  const maxNew = clampInteger(options.maxNew, 0, limit, 2);
  const items = getMemoryCoachItems(entries, { now });
  const due = items.filter((item) => item.dueTimestamp <= now);
  const reviewedDue = due.filter((item) => !item.isNew);
  const newDue = due.filter((item) => item.isNew).slice(0, maxNew);
  const selected = [...reviewedDue.slice(0, limit), ...newDue]
    .sort((a, b) => a.dueTimestamp - b.dueTimestamp || b.lapses - a.lapses)
    .slice(0, limit);

  return selected;
};

export const createPracticeSession = (entries = [], options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const items = getDuePracticeItems(entries, { ...options, now });
  return {
    startedAt: new Date(now).toISOString(),
    itemIds: items.map((item) => item.id),
    total: items.length,
  };
};

const withMemoryCoachMetadata = (entry, memoryCoach, now) => ({
  ...entry,
  updatedAt: now,
  pendingSync: true,
  metadata: {
    ...(entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {}),
    type: 'memory-card',
    memoryCoach,
  },
});

export const recordPracticeResult = (entries = [], entryId, rating, options = {}) => {
  const normalizedId = typeof entryId === 'string' ? entryId.trim() : '';
  const normalizedRating = Object.values(MEMORY_COACH_RATINGS).includes(rating) ? rating : '';
  if (!normalizedId || !normalizedRating || !Array.isArray(entries)) {
    return { entries: Array.isArray(entries) ? entries : [], updated: false, item: null };
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  let updatedItem = null;
  let updated = false;
  const nextEntries = entries.map((entry) => {
    if (entry?.id !== normalizedId) {
      return entry;
    }

    const current = normalizeMemoryCoachMetadata(entry?.metadata?.memoryCoach, { now });
    if (!current) {
      return entry;
    }

    const effectiveRating = normalizedRating === MEMORY_COACH_RATINGS.GOT_IT && options.hintUsed === true
      ? MEMORY_COACH_RATINGS.HARD
      : normalizedRating;
    const dueAtBefore = current.dueAt;
    const dueTimestampBefore = toTimestamp(dueAtBefore) ?? now;
    const wasEarly = dueTimestampBefore > now;
    let nextStage = current.stage;
    let intervalDays = wasEarly
      ? Math.max(0, Math.ceil((dueTimestampBefore - now) / DAY_MS))
      : 1;
    let nextDueAt = wasEarly ? dueAtBefore : now + DAY_MS;
    let nextStreak = current.streak;
    let nextLapses = current.lapses;
    let nextLastRating = current.lastRating;

    if (wasEarly) {
      // An early look can be useful extra practice, but it is not evidence of durable recall.
      // Keep the established schedule unchanged so repeated early reviews cannot inflate it.
    } else if (effectiveRating === MEMORY_COACH_RATINGS.FORGOT) {
      nextStage = Math.max(0, current.stage - 2);
      nextStreak = 0;
      nextLapses += 1;
      nextLastRating = effectiveRating;
    } else if (effectiveRating === MEMORY_COACH_RATINGS.HARD) {
      if (options.hintUsed === true) {
        nextStage = Math.max(0, current.stage - 1);
        nextStreak = 0;
      } else {
        intervalDays = MEMORY_COACH_INTERVAL_DAYS[current.stage];
        nextDueAt = now + intervalDays * DAY_MS;
      }
      nextLastRating = effectiveRating;
    } else {
      nextStage = current.reviewCount === 0
        ? 0
        : Math.min(MEMORY_COACH_INTERVAL_DAYS.length - 1, current.stage + 1);
      intervalDays = MEMORY_COACH_INTERVAL_DAYS[nextStage];
      nextDueAt = now + intervalDays * DAY_MS;
      nextStreak += 1;
      nextLastRating = effectiveRating;
    }

    const review = {
      reviewedAt: now,
      dueAtBefore,
      rating: normalizedRating,
      effectiveRating,
      hintUsed: options.hintUsed === true,
      wasEarly,
      stageBefore: current.stage,
      stageAfter: nextStage,
      intervalDays,
    };
    const nextCoach = normalizeMemoryCoachMetadata({
      ...current,
      updatedAt: now,
      dueAt: nextDueAt,
      lastReviewedAt: now,
      lastRating: nextLastRating,
      stage: nextStage,
      reviewCount: current.reviewCount + 1,
      streak: nextStreak,
      lapses: nextLapses,
      history: [...current.history, review],
    }, { now });
    const nextEntry = withMemoryCoachMetadata(entry, nextCoach, now);
    updated = true;
    updatedItem = toPracticeItem(nextEntry, { now });
    return nextEntry;
  });

  return { entries: nextEntries, updated, item: updatedItem };
};

export const setPracticeItemEnabled = (entries = [], entryId, enabled, options = {}) => {
  const normalizedId = typeof entryId === 'string' ? entryId.trim() : '';
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  let updated = false;
  let updatedItem = null;
  const nextEntries = (Array.isArray(entries) ? entries : []).map((entry) => {
    if (entry?.id !== normalizedId) {
      return entry;
    }
    const current = normalizeMemoryCoachMetadata(entry?.metadata?.memoryCoach, { now });
    if (!current || current.enabled === Boolean(enabled)) {
      return entry;
    }
    const nextCoach = normalizeMemoryCoachMetadata({
      ...current,
      enabled: Boolean(enabled),
      updatedAt: now,
      ...(enabled ? { dueAt: now } : {}),
    }, { now });
    updated = true;
    const nextEntry = withMemoryCoachMetadata(entry, nextCoach, now);
    updatedItem = toPracticeItem(nextEntry, { now });
    return nextEntry;
  });
  return { entries: nextEntries, updated, item: updatedItem };
};

export const getPracticeSummary = (entries = [], options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const items = getMemoryCoachItems(entries, { now });
  const due = items.filter((item) => item.dueTimestamp <= now);
  const future = items.filter((item) => item.dueTimestamp > now);
  const isEstablished = (item) => item.stage >= 3 && item.lastRating === MEMORY_COACH_RATINGS.GOT_IT;
  return {
    total: items.length,
    due: due.length,
    newItems: items.filter((item) => item.isNew).length,
    learning: items.filter((item) => !isEstablished(item)).length,
    established: items.filter(isEstablished).length,
    nextDueAt: future.length ? future[0].dueAt : null,
  };
};

export const addVocabularyPracticeEntry = (entries = [], payload = {}, options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const word = normalizeText(payload.word, 120);
  const explanation = normalizeText(payload.explanation || payload.meaning, 600);
  const promptSource = normalizeText(payload.prompt || payload.cue, 600);
  const prompt = maskPracticeAnswer(
    promptSource || (explanation ? `Which word means: ${explanation}` : ''),
    word,
  );
  if (!word || !prompt || typeof options.createEntry !== 'function') {
    return { entries: Array.isArray(entries) ? entries : [], entry: null, status: 'invalid' };
  }

  const existing = getMemoryCoachItems(entries, { includePaused: true, now })
    .find((item) => normalizeAnswerKey(item.answer) === normalizeAnswerKey(word));
  if (existing) {
    if (!existing.enabled) {
      const resumed = setPracticeItemEnabled(entries, existing.id, true, { now });
      return {
        entries: resumed.entries,
        entry: resumed.item?.entry || existing.entry,
        status: resumed.updated ? 'resumed' : 'existing',
      };
    }
    return { entries: Array.isArray(entries) ? entries : [], entry: existing.entry, status: 'existing' };
  }

  const createdAt = new Date(now).toISOString();
  const example = normalizeText(payload.example, 600);
  const memoryCoach = normalizeMemoryCoachMetadata({
    schemaVersion: MEMORY_COACH_SCHEMA_VERSION,
    kind: 'vocabulary',
    prompt,
    answer: word,
    explanation,
    example,
    hints: payload.hints,
    alternatives: payload.alternatives,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
    dueAt: createdAt,
    stage: 0,
    reviewCount: 0,
    streak: 0,
    lapses: 0,
    history: [],
  }, { now });
  const entry = options.createEntry({
    text: explanation ? `${word}: ${explanation}` : `Practice word: ${word}`,
    source: 'assistant',
    parsedType: 'unknown',
    tags: ['memory-coach', 'vocabulary'],
    createdAt: now,
    updatedAt: now,
    entryPoint: 'memoryCoach.saveVocabulary',
    metadata: {
      type: 'memory-card',
      source: 'word-rescue',
      memoryCoach,
    },
  });
  if (!entry || typeof entry !== 'object') {
    return { entries: Array.isArray(entries) ? entries : [], entry: null, status: 'invalid' };
  }
  return { entries: [entry, ...(Array.isArray(entries) ? entries : [])], entry, status: 'created' };
};

// Compatibility helper for the retired passive recall experiment. Keep this export until
// mobile.js no longer has older callers that expect age-based suggestions.
export function getRecallItems(items = [], options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const maxItems = Math.min(3, Math.max(1, Number(options.limit) || 3));

  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      const createdAt = toTimestamp(item?.createdAt);
      if (!createdAt) {
        return false;
      }

      const age = now - createdAt;
      return age > SEVEN_DAYS_MS;
    })
    .sort((a, b) => toTimestamp(b?.createdAt) - toTimestamp(a?.createdAt))
    .slice(0, maxItems);
}
