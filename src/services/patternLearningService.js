const PATTERN_STORAGE_KEY = 'memoryCuePatterns';

const getPatternStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

const normalizeText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const getWords = (value) => normalizeText(value)
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const readPatterns = () => {
  const storage = getPatternStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(PATTERN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[pattern-learning] Unable to read patterns from localStorage.', error);
    return [];
  }
};

const writePatterns = (patterns) => {
  const storage = getPatternStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(PATTERN_STORAGE_KEY, JSON.stringify(patterns));
  } catch (error) {
    console.warn('[pattern-learning] Unable to write patterns to localStorage.', error);
  }
};

const getMemoryText = (memory) => {
  if (typeof memory === 'string') {
    return memory;
  }

  if (!memory || typeof memory !== 'object') {
    return '';
  }

  return typeof memory.text === 'string' ? memory.text : '';
};

const getMemoryId = (memory) => {
  if (!memory || typeof memory !== 'object') {
    return '';
  }

  return typeof memory.id === 'string' ? memory.id : '';
};

const createPattern = (id, description, relatedMemoryId) => ({
  id,
  description,
  frequency: 1,
  lastDetected: new Date().toISOString(),
  relatedMemories: relatedMemoryId ? [relatedMemoryId] : [],
});

const updatePattern = (pattern, relatedMemoryId) => {
  const nextRelated = Array.isArray(pattern.relatedMemories)
    ? [...pattern.relatedMemories]
    : [];

  if (relatedMemoryId && !nextRelated.includes(relatedMemoryId)) {
    nextRelated.push(relatedMemoryId);
  }

  return {
    ...pattern,
    frequency: Number(pattern.frequency || 0) + 1,
    lastDetected: new Date().toISOString(),
    relatedMemories: nextRelated,
  };
};

const DAY_KEYWORDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHOPPING_KEYWORDS = ['buy', 'shop', 'shopping', 'grocery', 'groceries', 'store', 'order'];
const TEACHING_KEYWORDS = ['teach', 'teaching', 'lesson', 'class', 'students', 'curriculum'];
const COACHING_KEYWORDS = ['coach', 'coaching', 'drill', 'drills', 'practice', 'training', 'workout'];
const REMINDER_KEYWORDS = ['remind', 'reminder'];

const hasAnyWord = (words, keywords) => keywords.some((keyword) => words.includes(keyword));

const classifyPatternKey = (text) => {
  const words = getWords(text);

  if (!words.length) {
    return null;
  }

  if (hasAnyWord(words, COACHING_KEYWORDS)) {
    return 'coaching_drills';
  }

  if (hasAnyWord(words, TEACHING_KEYWORDS)) {
    return 'teaching_routines';
  }

  if (hasAnyWord(words, SHOPPING_KEYWORDS)) {
    return 'shopping_habits';
  }

  if (hasAnyWord(words, DAY_KEYWORDS)) {
    return 'recurring_meetings';
  }

  if (hasAnyWord(words, REMINDER_KEYWORDS) || words.length > 1) {
    return 'repeated_reminders';
  }

  return null;
};

const PATTERN_DESCRIPTIONS = {
  repeated_reminders: 'User has repeated reminder activity',
  recurring_meetings: 'User schedules recurring meetings during the week',
  shopping_habits: 'User has recurring shopping habits',
  teaching_routines: 'User follows a teaching routine',
  coaching_drills: 'User schedules coaching drills multiple times per week',
};

const getPatternDescription = (patternKey) => PATTERN_DESCRIPTIONS[patternKey] || 'Recurring user behavior detected';

const isSimilarMemory = (left, right) => {
  const leftWords = getWords(left);
  const rightWords = getWords(right);

  if (!leftWords.length || !rightWords.length) {
    return false;
  }

  const overlap = leftWords.filter((word) => rightWords.includes(word)).length;
  return overlap >= 2;
};

export const learnPattern = (memory) => {
  const text = getMemoryText(memory);
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return null;
  }

  const patternKey = classifyPatternKey(normalizedText);
  if (!patternKey) {
    return null;
  }

  const patterns = readPatterns();
  const memoryId = getMemoryId(memory);
  const existingPattern = patterns.find((pattern) => pattern.id === patternKey);

  if (existingPattern) {
    const updatedPatterns = patterns.map((pattern) => (
      pattern.id === patternKey ? updatePattern(pattern, memoryId) : pattern
    ));
    writePatterns(updatedPatterns);
    return updatedPatterns.find((pattern) => pattern.id === patternKey) || null;
  }

  const nextPattern = createPattern(patternKey, getPatternDescription(patternKey), memoryId);
  const updatedPatterns = [nextPattern, ...patterns];
  writePatterns(updatedPatterns);
  return nextPattern;
};

export const getPatterns = () => readPatterns();

const buildSuggestion = (pattern) => {
  if (!pattern || typeof pattern !== 'object') {
    return null;
  }

  if (pattern.id === 'coaching_drills') {
    return 'Would you like to make this a weekly drill reminder?';
  }

  if (pattern.id === 'recurring_meetings') {
    return 'Would you like to set this as a recurring weekly meeting reminder?';
  }

  if (pattern.id === 'shopping_habits') {
    return 'Would you like to create a recurring shopping reminder?';
  }

  if (pattern.id === 'teaching_routines') {
    return 'Would you like to save this as part of your weekly teaching routine?';
  }

  return 'Would you like to make this a recurring reminder?';
};

export const suggestActions = (memory) => {
  const text = normalizeText(getMemoryText(memory));
  if (!text) {
    return [];
  }

  return readPatterns()
    .filter((pattern) => Number(pattern.frequency || 0) >= 2)
    .filter((pattern) => {
      if (pattern.id === classifyPatternKey(text)) {
        return true;
      }

      const description = normalizeText(pattern.description);
      return isSimilarMemory(text, description);
    })
    .map((pattern) => ({
      patternId: pattern.id,
      suggestion: buildSuggestion(pattern),
    }))
    .filter((item) => Boolean(item.suggestion));
};

export const recordPattern = (phrase, intent) => {
  if (!phrase || !intent) {
    return;
  }

  learnPattern({ text: phrase, id: '' });
};

export const predictIntent = () => null;
