const EMBEDDING_STORAGE_KEY = 'memoryCue:embeddings';
const MAX_STORED_EMBEDDINGS = 200;
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeEmbedding = (embedding) => {
  if (!Array.isArray(embedding)) {
    return [];
  }

  return embedding
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
};

const getStoredEmbeddings = () => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(EMBEDDING_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[embedding-service] Failed to read stored embeddings', error);
    return [];
  }
};

const persistEmbeddings = (records) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(EMBEDDING_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('[embedding-service] Failed to persist embeddings', error);
  }
};

const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) {
    return 0;
  }

  const dimensions = Math.min(left.length, right.length);
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < dimensions; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);

    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      continue;
    }

    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};

export const createEmbedding = async (text) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const openAiApiKey = typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '';
  if (!openAiApiKey) {
    console.warn('[embedding-service] OPENAI_API_KEY is not configured');
    return [];
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: normalizedText,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed (${response.status})`);
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  return normalizeEmbedding(embedding);
};

export const storeEmbedding = (memoryId, embedding) => {
  const normalizedMemoryId = normalizeText(memoryId);
  const normalizedEmbedding = normalizeEmbedding(embedding);

  if (!normalizedMemoryId || !normalizedEmbedding.length) {
    return null;
  }

  const timestamp = Date.now();
  const records = getStoredEmbeddings().filter((record) => normalizeText(record?.memoryId) !== normalizedMemoryId);

  records.unshift({
    memoryId: normalizedMemoryId,
    embedding: normalizedEmbedding,
    createdAt: timestamp,
  });

  const limitedRecords = records.slice(0, MAX_STORED_EMBEDDINGS);
  persistEmbeddings(limitedRecords);

  return limitedRecords[0];
};

export const searchEmbeddings = (queryEmbedding) => {
  const normalizedQuery = normalizeEmbedding(queryEmbedding);
  if (!normalizedQuery.length) {
    return [];
  }

  return getStoredEmbeddings()
    .map((record) => ({
      memoryId: normalizeText(record?.memoryId),
      score: cosineSimilarity(normalizedQuery, normalizeEmbedding(record?.embedding)),
    }))
    .filter((result) => result.memoryId)
    .sort((left, right) => right.score - left.score);
};
