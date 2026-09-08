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
          isRetry: review.isRetry === true,
          isApplication: review.isApplication === true,
          applicationContext: normalizeText(review.applicationContext, 40),
          missedItems: normalizeTextList(review.missedItems, 20, 120),
          orderMissed: review.orderMissed === true,
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

  const items = normalizeTextList(value.items, 20, 120);
  const answer = normalizeText(value.answer, 120)
    || (items.length ? normalizeText(items.join(' • '), 120) : '');
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
    kind: ['vocabulary', 'expression', 'list'].includes(value.kind) ? value.kind : 'memory',
    prompt,
    answer,
    items,
    orderMatters: value.kind === 'list' && value.orderMatters === true,
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
    lastMissedItems: normalizeTextList(value.lastMissedItems, 20, 120).filter((item) => items.includes(item)),
    lastOrderMissed: value.kind === 'list' && value.orderMatters === true && value.lastOrderMissed === true,
    applicationCount: clampInteger(value.applicationCount, 0, 100000, 0),
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
  let failureReason = '';
  const nextEntries = entries.map((entry) => {
    if (entry?.id !== normalizedId) {
      return entry;
    }

    const current = normalizeMemoryCoachMetadata(entry?.metadata?.memoryCoach, { now });
    if (!current) {
      return entry;
    }

    const isApplication = options.isApplication === true;
    if (isApplication && (!['vocabulary', 'expression'].includes(current.kind)
      || (options.expectedUpdatedAt && options.expectedUpdatedAt !== current.updatedAt))) {
      failureReason = 'changed';
      return entry;
    }

    const missedItems = current.kind === 'list'
      ? normalizeTextList(options.missedItems, 20, 120).filter((item) => current.items.includes(item))
      : [];
    const orderMissed = current.orderMatters && options.orderMissed === true;
    const effectiveRating = missedItems.length || orderMissed
      ? MEMORY_COACH_RATINGS.FORGOT
      : normalizedRating === MEMORY_COACH_RATINGS.GOT_IT && options.hintUsed === true
      ? MEMORY_COACH_RATINGS.HARD
      : normalizedRating;
    const dueAtBefore = current.dueAt;
    const dueTimestampBefore = toTimestamp(dueAtBefore) ?? now;
    const isRetry = options.isRetry === true;
    const wasEarly = isRetry || isApplication || dueTimestampBefore > now;
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
      isRetry,
      isApplication,
      applicationContext: isApplication ? options.applicationContext : '',
      missedItems,
      orderMissed,
      stageBefore: current.stage,
      stageAfter: nextStage,
      intervalDays,
    };
    const nextCoach = normalizeMemoryCoachMetadata({
      ...current,
      updatedAt: now,
      dueAt: nextDueAt,
      lastReviewedAt: isRetry || isApplication ? current.lastReviewedAt : now,
      lastRating: nextLastRating,
      stage: nextStage,
      reviewCount: current.reviewCount + (isRetry || isApplication ? 0 : 1),
      applicationCount: current.applicationCount + (isApplication ? 1 : 0),
      streak: nextStreak,
      lapses: nextLapses,
      history: [...current.history, review],
      lastMissedItems: wasEarly ? current.lastMissedItems : missedItems,
      lastOrderMissed: wasEarly ? current.lastOrderMissed : orderMissed,
    }, { now });
    const nextEntry = withMemoryCoachMetadata(entry, nextCoach, now);
    updated = true;
    updatedItem = toPracticeItem(nextEntry, { now });
    return nextEntry;
  });

  return { entries: nextEntries, updated, item: updatedItem, ...(failureReason ? { reason: failureReason } : {}) };
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

export const updatePracticeEntry = (entries = [], entryId, payload = {}, options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const existing = (Array.isArray(entries) ? entries : []).find((entry) => entry?.id === entryId);
  const current = normalizeMemoryCoachMetadata(existing?.metadata?.memoryCoach, { now });
  if (!current) return { status: 'missing', entry: null };
  if (options.expectedUpdatedAt && options.expectedUpdatedAt !== current.updatedAt) {
    return { status: 'conflict', entry: null };
  }
  const rawPrompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const rawAnswer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const isList = current.kind === 'list';
  const items = isList ? normalizeTextList(rawItems, 20, 120) : [];
  if (!rawPrompt || rawPrompt.length > 600 || (isList
    ? items.length < 2 || rawItems.length > 20 || rawItems.some((item) => typeof item !== 'string' || item.trim().length > 120)
    : !rawAnswer || rawAnswer.length > 120)) {
    return { status: 'invalid', entry: null };
  }
  const answer = isList ? normalizeText(items.join(' • '), 120) : normalizeText(rawAnswer, 120);
  const prompt = maskPracticeAnswer(rawPrompt, answer);
  const orderMatters = isList && payload.orderMatters === true;
  if (current.prompt === prompt && current.answer === answer
    && JSON.stringify(current.items) === JSON.stringify(items) && current.orderMatters === orderMatters) {
    return { status: 'unchanged', entry: existing };
  }
  // A changed question/answer is new learning. Keep identity, sync metadata and pause state.
  const memoryCoach = normalizeMemoryCoachMetadata({
    ...current, prompt, answer, items, orderMatters,
    explanation: '', example: '', hints: [], alternatives: [],
    updatedAt: now, dueAt: now, lastReviewedAt: null, lastRating: null,
    stage: 0, reviewCount: 0, streak: 0, lapses: 0, history: [], applicationCount: 0,
    lastMissedItems: [], lastOrderMissed: false,
  }, { now });
  const entry = withMemoryCoachMetadata(existing, memoryCoach, now);
  entry.text = isList ? `Practise list: ${prompt}` : `Practise remembering: ${answer}`;
  return { status: 'updated', entry };
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

export const addMemoryPracticeEntry = (entries = [], payload = {}, options = {}) => {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const items = normalizeTextList(payload.items, 20, 120);
  const isList = payload.kind === 'list';
  if (isList && Array.isArray(payload.items) && (payload.items.length > 20
    || payload.items.some((item) => typeof item !== 'string' || item.trim().length > 120))) {
    return { entries, entry: null, status: 'invalid' };
  }
  const answer = normalizeText(
    payload.answer || payload.word || (isList ? items.join(' • ') : ''),
    120,
  );
  const explanation = normalizeText(payload.explanation || payload.meaning, 600);
  const promptSource = normalizeText(payload.prompt || payload.cue, 600);
  const prompt = maskPracticeAnswer(
    promptSource || (explanation ? `What are you trying to remember about: ${explanation}` : ''),
    answer,
  );
  if (!answer || !prompt || (isList && items.length < 2) || typeof options.createEntry !== 'function') {
    return { entries: Array.isArray(entries) ? entries : [], entry: null, status: 'invalid' };
  }

  const existing = getMemoryCoachItems(entries, { includePaused: true, now })
    .find((item) => (
      (isList
        ? item.kind === 'list'
          && item.items.map(normalizeAnswerKey).join('|') === items.map(normalizeAnswerKey).join('|')
        : normalizeAnswerKey(item.answer) === normalizeAnswerKey(answer))
      && (
        options.matchAnswerOnly === true
        || normalizeAnswerKey(item.prompt) === normalizeAnswerKey(prompt)
      )
    ));
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
  const kind = ['vocabulary', 'expression', 'list'].includes(payload.kind) ? payload.kind : 'memory';
  const memoryCoach = normalizeMemoryCoachMetadata({
    schemaVersion: MEMORY_COACH_SCHEMA_VERSION,
    kind,
    prompt,
    answer,
    items,
    orderMatters: kind === 'list' && payload.orderMatters === true,
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
    text: explanation
      ? `${answer}: ${explanation}`
      : kind === 'list'
        ? `Practise list: ${prompt}`
        : `Practise remembering: ${answer}`,
    source: options.source === 'word-rescue' ? 'assistant' : 'user',
    parsedType: 'unknown',
    tags: ['memory-coach', kind],
    createdAt: now,
    updatedAt: now,
    entryPoint: options.entryPoint || 'memoryCoach.saveMemory',
    metadata: {
      type: 'memory-card',
      source: options.source || 'memory-coach',
      memoryCoach,
    },
  });
  if (!entry || typeof entry !== 'object') {
    return { entries: Array.isArray(entries) ? entries : [], entry: null, status: 'invalid' };
  }
  return { entries: [entry, ...(Array.isArray(entries) ? entries : [])], entry, status: 'created' };
};

export const addVocabularyPracticeEntry = (entries = [], payload = {}, options = {}) => (
  addMemoryPracticeEntry(entries, {
    ...payload,
    answer: payload.word,
    kind: payload.kind === 'expression' ? 'expression' : 'vocabulary',
  }, {
    ...options,
    matchAnswerOnly: true,
    entryPoint: 'memoryCoach.saveVocabulary',
    source: 'word-rescue',
  })
);

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
