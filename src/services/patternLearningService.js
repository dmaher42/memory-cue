const PATTERN_STORAGE_KEY = 'memoryCuePatterns';

const getPatternStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

const normalizeText = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

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

export const recordPattern = (phrase, intent) => {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase || !intent || typeof intent !== 'object') {
    return;
  }

  const predictedIntent = normalizeText(intent.predictedIntent || intent.decisionType);
  const predictedNotebook = typeof intent.predictedNotebook === 'string'
    ? intent.predictedNotebook.trim()
    : '';

  if (!predictedIntent) {
    return;
  }

  const patterns = readPatterns();
  const existingIndex = patterns.findIndex((pattern) => (
    normalizeText(pattern?.phrase) === normalizedPhrase
    && normalizeText(pattern?.predictedIntent) === predictedIntent
    && normalizeText(pattern?.predictedNotebook) === normalizeText(predictedNotebook)
  ));

  if (existingIndex >= 0) {
    const existing = patterns[existingIndex];
    patterns[existingIndex] = {
      ...existing,
      frequency: Number(existing?.frequency || 0) + 1,
      phrase: normalizedPhrase,
      predictedNotebook,
      predictedIntent,
    };
  } else {
    patterns.unshift({
      phrase: normalizedPhrase,
      predictedNotebook,
      predictedIntent,
      frequency: 1,
    });
  }

  writePatterns(patterns);
};

export const predictIntent = (text) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return null;
  }

  const patterns = readPatterns();
  const exactMatch = patterns.find((pattern) => normalizeText(pattern?.phrase) === normalizedText);

  if (!exactMatch) {
    return null;
  }

  return {
    predictedNotebook: typeof exactMatch?.predictedNotebook === 'string' ? exactMatch.predictedNotebook : '',
    predictedIntent: normalizeText(exactMatch?.predictedIntent),
    frequency: Number(exactMatch?.frequency || 0),
  };
};
