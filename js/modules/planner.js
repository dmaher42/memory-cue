const PLANNER_STORAGE_KEY = 'memoryCue:plannerPlans';
const PLANNER_TEMPLATES_KEY = 'memoryCue:plannerTemplates';
const PLANNER_LAST_TEMPLATE_KEY = 'memoryCue:lastPlannerTemplate';
const PLANNER_UPDATED_EVENT = 'memoryCue:plannerUpdated';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DEFAULT_WEEK_TEMPLATE = [
  {
    dayIndex: 1,
    title: 'Monday',
    summary: 'Co-teach literacy rotations with Mia. Collect exit slips.',
    details: [
      { badge: 'Workshop', text: 'Shared reading focus · 45 mins' },
      { badge: 'Prep', text: 'Print small group checklists' }
    ]
  },
  {
    dayIndex: 2,
    title: 'Tuesday',
    summary: 'STEM lab – robotics challenges for groups A & B.',
    details: [
      { badge: 'Lab', text: 'Calibrate sensors before class' },
      { badge: 'Check-in', text: 'Collect student reflections in Notes' }
    ]
  },
  {
    dayIndex: 3,
    title: 'Wednesday',
    summary: 'Parent interviews from 3 PM. Prepare student snapshots.',
    details: [
      { badge: 'Families', text: 'Finalise progress highlights' },
      { badge: 'Reminder', text: 'Email timetable to staff' }
    ]
  },
  {
    dayIndex: 4,
    title: 'Thursday',
    summary: 'Lesson study · co-design inquiry prompts with team.',
    details: [
      { badge: 'Collab', text: 'Align goals with team rubric' },
      { badge: 'Resource', text: 'Attach planning template' }
    ]
  }
];

const hasLocalStorage = () => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const getStoredValue = (key) => {
  if (!hasLocalStorage() || !key) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStoredValue = (key, value) => {
  if (!hasLocalStorage() || !key) {
    return;
  }
  try {
    if (typeof value === 'string' && value.length) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* noop */
  }
};

const safeParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `planner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clampDayIndex = (index) => {
  if (!Number.isFinite(index)) {
    return 0;
  }
  if (index < 0) {
    return 0;
  }
  if (index > 6) {
    return 6;
  }
  return index;
};

const getWeekStart = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const clone = new Date(date);
  const day = clone.getDay();
  const diff = (day + 6) % 7; // Monday as the first day.
  clone.setHours(0, 0, 0, 0);
  clone.setDate(clone.getDate() - diff);
  return clone;
};

const formatDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseWeekId = (weekId) => {
  if (typeof weekId !== 'string') {
    return null;
  }
  const [yearRaw, monthRaw, dayRaw] = weekId.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
};

const resolveDayIndexFromName = (value) => {
  if (typeof value !== 'string') {
    return 0;
  }
  const target = value.trim().toLowerCase();
  const matchIndex = DAY_NAMES.findIndex((name) => name.toLowerCase() === target);
  return matchIndex >= 0 ? matchIndex : 0;
};

const normaliseDetail = (detail) => {
  if (!detail || typeof detail !== 'object') {
    return null;
  }
  const text = typeof detail.text === 'string' ? detail.text.trim() : '';
  if (!text) {
    return null;
  }
  const badge = typeof detail.badge === 'string' ? detail.badge.trim() : '';
  const id = typeof detail.id === 'string' && detail.id.trim() ? detail.id : generateId();
  return { id, badge, text };
};

const normaliseLesson = (lesson, fallback = {}) => {
  const defaults = typeof fallback === 'object' && fallback ? fallback : {};
  const rawDayIndex = Number.isFinite(lesson?.dayIndex)
    ? lesson.dayIndex
    : Number.isFinite(defaults.dayIndex)
      ? defaults.dayIndex
      : resolveDayIndexFromName(lesson?.dayName || defaults.dayName || defaults.dayLabel);
  const dayIndex = clampDayIndex(rawDayIndex);
  const titleSource = typeof lesson?.title === 'string' && lesson.title.trim().length
    ? lesson.title.trim()
    : typeof defaults.title === 'string' && defaults.title.trim().length
      ? defaults.title.trim()
      : DAY_NAMES[dayIndex];
  const summary = typeof lesson?.summary === 'string'
    ? lesson.summary.trim()
    : typeof defaults.summary === 'string'
      ? defaults.summary
      : '';
  const detailsSource = Array.isArray(lesson?.details)
    ? lesson.details
    : Array.isArray(defaults.details)
      ? defaults.details
      : [];
  const details = detailsSource.map((detail) => normaliseDetail(detail)).filter(Boolean);
  const id = typeof lesson?.id === 'string' && lesson.id.trim()
    ? lesson.id
    : typeof defaults.id === 'string' && defaults.id.trim()
      ? defaults.id
      : generateId();
  const rawPosition = Number.isFinite(lesson?.position)
    ? lesson.position
    : Number.isFinite(defaults.position)
      ? defaults.position
      : Number.NaN;
  return {
    id,
    dayIndex,
    dayLabel: DAY_NAMES[dayIndex] || 'Lesson',
    title: titleSource,
    summary,
    details,
    position: Number.isFinite(rawPosition) ? rawPosition : null
  };
};

const sortLessons = (lessons) => {
  return [...lessons].sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) {
      return a.dayIndex - b.dayIndex;
    }
    const hasPositionA = Number.isFinite(a.position);
    const hasPositionB = Number.isFinite(b.position);
    if (hasPositionA && hasPositionB && a.position !== b.position) {
      return a.position - b.position;
    }
    if (hasPositionA && !hasPositionB) {
      return -1;
    }
    if (!hasPositionA && hasPositionB) {
      return 1;
    }
    return a.title.localeCompare(b.title);
  });
};

const ensureLessonPositions = (lessons) => {
  const dayCounters = new Map();
  lessons.forEach((lesson) => {
    const dayKey = String(lesson.dayIndex);
    const counter = dayCounters.get(dayKey) ?? 0;
    if (Number.isFinite(lesson.position)) {
      dayCounters.set(dayKey, Math.max(counter, lesson.position + 1));
    } else {
      lesson.position = counter;
      dayCounters.set(dayKey, counter + 1);
    }
  });
  return lessons;
};

const getNextPositionForDay = (lessons, dayIndex, excludedLessonId) => {
  const dayLessons = lessons.filter((lesson) => {
    if (lesson.dayIndex !== dayIndex) {
      return false;
    }
    if (excludedLessonId && lesson.id === excludedLessonId) {
      return false;
    }
    return true;
  });
  if (!dayLessons.length) {
    return 0;
  }
  return (
    dayLessons.reduce((max, lesson) => {
      if (Number.isFinite(lesson.position)) {
        return Math.max(max, lesson.position);
      }
      return max;
    }, -1) + 1
  );
};

const normalisePlan = (plan, fallbackWeekId) => {
  const targetWeekId = typeof plan?.weekId === 'string' && plan.weekId ? plan.weekId : fallbackWeekId;
  const weekStartDate = parseWeekId(targetWeekId);
  const lessons = Array.isArray(plan?.lessons)
    ? ensureLessonPositions(plan.lessons.map((lesson) => normaliseLesson(lesson)).filter(Boolean))
    : [];
  const templateId = typeof plan?.templateId === 'string' ? plan.templateId.trim() : '';
  return {
    weekId: targetWeekId,
    startDate: weekStartDate ? weekStartDate.toISOString() : '',
    lessons: sortLessons(lessons),
    updatedAt: typeof plan?.updatedAt === 'string' ? plan.updatedAt : new Date().toISOString(),
    templateId
  };
};

const readLocalPlans = () => {
  if (!hasLocalStorage()) {
    return {};
  }
  try {
    const stored = getStoredValue(PLANNER_STORAGE_KEY);
    if (typeof stored !== 'string' || !stored.length) {
      return {};
    }
    const parsed = safeParseJson(stored);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to read planner data from storage', error);
    return {};
  }
};

const writeLocalPlans = (map) => {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('Unable to persist planner data locally', error);
  }
};

const readTemplateMap = () => {
  if (!hasLocalStorage()) {
    return {};
  }
  try {
    const stored = getStoredValue(PLANNER_TEMPLATES_KEY);
    if (typeof stored !== 'string' || !stored.length) {
      return {};
    }
    const parsed = safeParseJson(stored);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to read planner templates from storage', error);
    return {};
  }
};

const writeTemplateMap = (map) => {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(PLANNER_TEMPLATES_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('Unable to persist planner templates locally', error);
  }
};

const getLocalPlan = (weekId) => {
  if (!weekId) {
    return null;
  }
  const map = readLocalPlans();
  const plan = map[weekId];
  if (!plan) {
    return null;
  }
  return normalisePlan(plan, weekId);
};

const setLocalPlan = (weekId, plan) => {
  if (!weekId || !plan) {
    return plan;
  }
  const map = readLocalPlans();
  map[weekId] = plan;
  writeLocalPlans(map);
  return plan;
};

const plannerCache = new Map();
let ensureFirestoreFn = null;
let plannerFirestorePromise = null;
let shouldUseLocalPlanner = false;
let lastTemplatePreference = null;

const getStoredLastTemplateId = () => {
  if (typeof lastTemplatePreference === 'string') {
    return lastTemplatePreference;
  }
  const stored = getStoredValue(PLANNER_LAST_TEMPLATE_KEY);
  lastTemplatePreference = typeof stored === 'string' ? stored : '';
  return lastTemplatePreference;
};

const rememberLastTemplateId = (templateId) => {
  if (typeof templateId !== 'string' || !templateId.trim()) {
    return;
  }
  const trimmed = templateId.trim();
  lastTemplatePreference = trimmed;
  setStoredValue(PLANNER_LAST_TEMPLATE_KEY, trimmed);
};

const syncTemplatePreferenceFromPlan = (plan) => {
  if (plan?.templateId) {
    rememberLastTemplateId(plan.templateId);
  }
};

const isPermissionDeniedError = (error) => {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  if (code && (code.includes('permission-denied') || code.includes('insufficient-permission'))) {
    return true;
  }
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return Boolean(message && message.includes('permission'));
};

const dispatchPlannerUpdated = (plan) => {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    const event = new CustomEvent(PLANNER_UPDATED_EVENT, { detail: { plan } });
    document.dispatchEvent(event);
  } catch (error) {
    console.warn('Unable to dispatch planner update event', error);
  }
};

const ensurePlannerFirestore = async () => {
  if (!ensureFirestoreFn) {
    return null;
  }
  if (plannerFirestorePromise) {
    return plannerFirestorePromise;
  }
  plannerFirestorePromise = ensureFirestoreFn()
    .then((base) => {
      const { db, getCollection } = base || {};
      const plannerCollection = typeof getCollection === 'function' && db ? getCollection(db, 'plannerPlans') : null;
      return { ...base, plannerCollection };
    })
    .catch((error) => {
      console.error('Failed to initialise Firestore for planner', error);
      throw error;
    });
  return plannerFirestorePromise;
};

const getPlannerDocRef = (firestore, weekId) => {
  if (!firestore) {
    throw new Error('Planner Firestore context is unavailable');
  }
  const { doc, plannerCollection, db } = firestore;
  if (typeof doc !== 'function') {
    throw new Error('Firestore document helper is unavailable');
  }
  if (plannerCollection) {
    return doc(plannerCollection, weekId);
  }
  return doc(db, 'plannerPlans', weekId);
};

const cachePlan = (plan) => {
  if (plan && typeof plan === 'object' && typeof plan.weekId === 'string') {
    plannerCache.set(plan.weekId, plan);
  }
  return plan;
};

const createDefaultPlan = (weekId) => {
  const currentWeekId = getWeekIdFromDate();
  const templateLessons = weekId === currentWeekId ? DEFAULT_WEEK_TEMPLATE : [];
  return normalisePlan({ weekId, lessons: templateLessons }, weekId);
};

const ensureLocalPlan = (weekId) => {
  const existing = getLocalPlan(weekId);
  if (existing) {
    cachePlan(existing);
    return existing;
  }
  const fallback = createDefaultPlan(weekId);
  setLocalPlan(weekId, fallback);
  cachePlan(fallback);
  return fallback;
};

const persistPlan = async (plan) => {
  if (!plan?.weekId) {
    return plan;
  }
  const normalised = normalisePlan(plan, plan.weekId);
  setLocalPlan(normalised.weekId, normalised);
  cachePlan(normalised);
  syncTemplatePreferenceFromPlan(normalised);
  if (shouldUseLocalPlanner || !ensureFirestoreFn) {
    return normalised;
  }
  try {
    const firestore = await ensurePlannerFirestore();
    if (!firestore) {
      return normalised;
    }
    const ref = getPlannerDocRef(firestore, normalised.weekId);
    if (typeof firestore.setDoc === 'function') {
      await firestore.setDoc(ref, normalised, { merge: true });
    } else {
      await firestore.updateDoc(ref, normalised);
    }
    return normalised;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Persisting planner data locally due to permission issue', error);
      shouldUseLocalPlanner = true;
      return normalised;
    }
    console.error('Failed to persist planner plan', error);
    return normalised;
  }
};

export const initPlannerStore = (options = {}) => {
  if (typeof options.ensureFirestore === 'function') {
    ensureFirestoreFn = options.ensureFirestore;
  }
  if (typeof options.forceLocal === 'boolean') {
    shouldUseLocalPlanner = options.forceLocal;
  }
};

export const getWeekIdFromDate = (date = new Date()) => {
  const start = getWeekStart(date);
  return formatDateKey(start);
};

export const getWeekIdFromOffset = (weekId, offset = 0) => {
  const base = parseWeekId(weekId);
  if (!base || !Number.isFinite(offset)) {
    return weekId;
  }
  const next = new Date(base);
  next.setDate(base.getDate() + offset * 7);
  return formatDateKey(next);
};

export const getWeekDateForDayIndex = (weekId = getWeekIdFromDate(), dayIndex = 0) => {
  const weekStart = parseWeekId(weekId);
  if (!weekStart) {
    return null;
  }
  const resolvedIndex = Number.isFinite(dayIndex) ? dayIndex : 0;
  const clampedIndex = clampDayIndex(resolvedIndex);
  const date = new Date(weekStart);
  date.setDate(weekStart.getDate() + clampedIndex);
  return date;
};

export const getWeekLabel = (weekId, { short = false } = {}) => {
  const start = parseWeekId(weekId);
  if (!start) {
    return '';
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });
  const startLabel = monthDayFormatter.format(start);
  const endLabel = monthDayFormatter.format(end);
  const sameYear = start.getFullYear() === end.getFullYear();
  if (short) {
    return `Week of ${startLabel}`;
  }
  const yearLabel = sameYear ? start.getFullYear() : `${start.getFullYear()} – ${end.getFullYear()}`;
  return `${startLabel} – ${endLabel}, ${yearLabel}`;
};

export const getPlannerLessonsForWeek = (weekId = getWeekIdFromDate()) => {
  if (!weekId) {
    return [];
  }
  const cached = plannerCache.get(weekId);
  if (cached && Array.isArray(cached.lessons)) {
    return [...cached.lessons];
  }
  const localPlan = getLocalPlan(weekId);
  if (Array.isArray(localPlan?.lessons)) {
    return [...localPlan.lessons];
  }
  return [];
};

export const loadWeekPlan = async (weekId = getWeekIdFromDate()) => {
  if (!weekId) {
    return null;
  }
  if (plannerCache.has(weekId)) {
    const cachedPlan = plannerCache.get(weekId);
    syncTemplatePreferenceFromPlan(cachedPlan);
    return cachedPlan;
  }
  if (shouldUseLocalPlanner || !ensureFirestoreFn) {
    const localPlan = ensureLocalPlan(weekId);
    syncTemplatePreferenceFromPlan(localPlan);
    return localPlan;
  }
  try {
    const firestore = await ensurePlannerFirestore();
    if (!firestore) {
      const fallbackPlan = ensureLocalPlan(weekId);
      syncTemplatePreferenceFromPlan(fallbackPlan);
      return fallbackPlan;
    }
    const ref = getPlannerDocRef(firestore, weekId);
    const snapshot = await firestore.getDoc(ref);
    if (snapshot.exists()) {
      const data = snapshot.data();
      const plan = normalisePlan({ ...data, weekId }, weekId);
      setLocalPlan(weekId, plan);
      cachePlan(plan);
      shouldUseLocalPlanner = false;
      syncTemplatePreferenceFromPlan(plan);
      return plan;
    }
    const fallback = ensureLocalPlan(weekId);
    if (typeof firestore.setDoc === 'function') {
      await firestore.setDoc(ref, fallback, { merge: true });
    }
    syncTemplatePreferenceFromPlan(fallback);
    return fallback;
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      console.warn('Falling back to local planner data due to permission issue', error);
      shouldUseLocalPlanner = true;
      const localPlan = ensureLocalPlan(weekId);
      syncTemplatePreferenceFromPlan(localPlan);
      return localPlan;
    }
    console.error('Failed to load planner data', error);
    const fallbackPlan = ensureLocalPlan(weekId);
    syncTemplatePreferenceFromPlan(fallbackPlan);
    return fallbackPlan;
  }
};

export const addLessonToWeek = async (weekId, lessonInput) => {
  if (!weekId) {
    return null;
  }
  const plan = await loadWeekPlan(weekId);
  const nextLesson = normaliseLesson(lessonInput);
  nextLesson.position = getNextPositionForDay(plan?.lessons || [], nextLesson.dayIndex);
  const nextPlan = {
    ...plan,
    lessons: sortLessons([...(plan?.lessons || []), nextLesson]),
    updatedAt: new Date().toISOString()
  };
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export const updateLessonInWeek = async (weekId, lessonId, updates = {}) => {
  if (!weekId || !lessonId) {
    return null;
  }
  const plan = await loadWeekPlan(weekId);
  const lessons = [...(plan?.lessons || [])];
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index === -1) {
    return plan;
  }
  const currentLesson = lessons[index];
  const updatedLesson = normaliseLesson({ ...currentLesson, ...updates, id: lessonId }, currentLesson);
  if (updatedLesson.dayIndex !== currentLesson.dayIndex) {
    const remainingLessons = lessons.filter((_, idx) => idx !== index);
    updatedLesson.position = getNextPositionForDay(remainingLessons, updatedLesson.dayIndex);
  }
  lessons[index] = updatedLesson;
  const nextPlan = {
    ...plan,
    lessons: sortLessons(lessons),
    updatedAt: new Date().toISOString()
  };
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export const deleteLessonFromWeek = async (weekId, lessonId) => {
  if (!weekId || !lessonId) {
    return null;
  }
  const plan = await loadWeekPlan(weekId);
  const remaining = (plan?.lessons || []).filter((lesson) => lesson.id !== lessonId);
  const nextPlan = {
    ...plan,
    lessons: sortLessons(remaining),
    updatedAt: new Date().toISOString()
  };
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export const movePlannerLesson = async (weekId, lessonId, direction) => {
  if (!weekId || !lessonId || !direction) {
    return null;
  }
  const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  if (!offset) {
    return loadWeekPlan(weekId);
  }
  const plan = await loadWeekPlan(weekId);
  const lessons = [...(plan?.lessons || [])];
  const lessonIndex = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (lessonIndex === -1) {
    return plan;
  }
  const currentLesson = lessons[lessonIndex];
  const dayLessons = sortLessons(lessons).filter((lesson) => lesson.dayIndex === currentLesson.dayIndex);
  const currentDayIndex = dayLessons.findIndex((lesson) => lesson.id === lessonId);
  if (currentDayIndex === -1) {
    return plan;
  }
  const targetDayIndex = currentDayIndex + offset;
  if (targetDayIndex < 0 || targetDayIndex >= dayLessons.length) {
    return plan;
  }
  const reordered = [...dayLessons];
  const [movedLesson] = reordered.splice(currentDayIndex, 1);
  reordered.splice(targetDayIndex, 0, movedLesson);
  const updatedPositions = new Map();
  reordered.forEach((lesson, index) => {
    updatedPositions.set(lesson.id, index);
  });
  const nextLessons = lessons.map((lesson) => {
    if (lesson.dayIndex !== currentLesson.dayIndex) {
      return lesson;
    }
    const newPosition = updatedPositions.get(lesson.id);
    if (typeof newPosition === 'number') {
      return { ...lesson, position: newPosition };
    }
    return lesson;
  });
  const nextPlan = {
    ...plan,
    lessons: sortLessons(nextLessons),
    updatedAt: new Date().toISOString()
  };
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export const addLessonDetail = async (weekId, lessonId, detailInput) => {
  if (!weekId || !lessonId) {
    return null;
  }
  const plan = await loadWeekPlan(weekId);
  const lessons = [...(plan?.lessons || [])];
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  if (index === -1) {
    return plan;
  }
  const detail = normaliseDetail(detailInput);
  if (!detail) {
    return plan;
  }
  const currentLesson = lessons[index];
  const nextLesson = {
    ...currentLesson,
    details: [...(currentLesson.details || []), detail]
  };
  lessons[index] = nextLesson;
  const nextPlan = {
    ...plan,
    lessons: sortLessons(lessons),
    updatedAt: new Date().toISOString()
  };
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export const duplicateWeekPlan = async (sourceWeekId, targetWeekId) => {
  if (!sourceWeekId || !targetWeekId) {
    return null;
  }
  const sourcePlan = await loadWeekPlan(sourceWeekId);
  const duplicatedLessons = (sourcePlan?.lessons || []).map((lesson) => ({
    title: lesson.title,
    summary: lesson.summary,
    dayIndex: lesson.dayIndex,
    details: (lesson.details || []).map((detail) => ({
      badge: detail.badge,
      text: detail.text
    }))
  }));
  const nextPlan = normalisePlan(
    {
      weekId: targetWeekId,
      lessons: duplicatedLessons,
      templateId: typeof sourcePlan?.templateId === 'string' ? sourcePlan.templateId : ''
    },
    targetWeekId
  );
  nextPlan.updatedAt = new Date().toISOString();
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

const cloneTemplateLesson = (lesson) => {
  if (!lesson || typeof lesson !== 'object') {
    return null;
  }
  const dayIndex = clampDayIndex(
    Number.isFinite(lesson.dayIndex) ? lesson.dayIndex : resolveDayIndexFromName(lesson.dayLabel || lesson.dayName)
  );
  const title = typeof lesson.title === 'string' ? lesson.title : '';
  const summary = typeof lesson.summary === 'string' ? lesson.summary : '';
  const details = Array.isArray(lesson.details)
    ? lesson.details
        .map((detail) => {
          if (!detail || typeof detail !== 'object') {
            return null;
          }
          const badge = typeof detail.badge === 'string' ? detail.badge : '';
          const text = typeof detail.text === 'string' ? detail.text : '';
          if (!text.trim()) {
            return null;
          }
          return { badge, text };
        })
        .filter(Boolean)
    : [];
  return { dayIndex, title, summary, details };
};

export const loadPlannerTemplates = () => {
  const raw = readTemplateMap();
  const templates = {};
  Object.keys(raw).forEach((key) => {
    const entry = raw[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : key;
    const lessons = Array.isArray(entry.lessons)
      ? entry.lessons.map((lesson) => cloneTemplateLesson(lesson)).filter(Boolean)
      : [];
    templates[name] = {
      name,
      lessons,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : ''
    };
  });
  return templates;
};

export const savePlannerTemplates = (templates = {}) => {
  if (!templates || typeof templates !== 'object') {
    writeTemplateMap({});
    return {};
  }
  const serialised = {};
  Object.keys(templates).forEach((key) => {
    const entry = templates[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : key;
    const lessons = Array.isArray(entry.lessons)
      ? entry.lessons.map((lesson) => cloneTemplateLesson(lesson)).filter(Boolean)
      : [];
    serialised[name] = {
      name,
      lessons,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
    };
  });
  writeTemplateMap(serialised);
  return loadPlannerTemplates();
};

export const savePlannerTemplate = (templateId, templateInput = {}) => {
  const templateName = typeof templateId === 'string' ? templateId.trim() : '';
  if (!templateName) {
    return null;
  }
  const templates = loadPlannerTemplates();
  const lessons = Array.isArray(templateInput.lessons)
    ? templateInput.lessons.map((lesson) => cloneTemplateLesson(lesson)).filter(Boolean)
    : [];
  templates[templateName] = {
    name: templateName,
    lessons,
    updatedAt: new Date().toISOString()
  };
  writeTemplateMap(templates);
  return templates[templateName];
};

export const getLastUsedTemplateId = () => {
  return getStoredLastTemplateId();
};

export const applyPlannerTemplate = async (weekId, templateId) => {
  if (!weekId || !templateId) {
    return null;
  }
  const templates = loadPlannerTemplates();
  const template = templates[templateId];
  if (!template) {
    return loadWeekPlan(weekId);
  }
  rememberLastTemplateId(templateId);
  const lessons = Array.isArray(template.lessons)
    ? template.lessons.map((lesson) => ({
        dayIndex: lesson.dayIndex,
        title: lesson.title,
        summary: lesson.summary,
        details: Array.isArray(lesson.details)
          ? lesson.details.map((detail) => ({ badge: detail.badge, text: detail.text }))
          : []
      }))
    : [];
  const nextPlan = normalisePlan({ weekId, lessons, templateId }, weekId);
  nextPlan.updatedAt = new Date().toISOString();
  const persisted = await persistPlan(nextPlan);
  dispatchPlannerUpdated(persisted);
  return persisted;
};

export { PLANNER_UPDATED_EVENT };
