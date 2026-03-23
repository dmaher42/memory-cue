import { getMemories, saveMemory } from './memoryService.js?v=20260323a';
import { generateEmbedding as generateBrainEmbedding } from '../brain/embeddingService.js?v=20260323a';


export const generateEmbedding = async (text) => generateBrainEmbedding(text);

const resolveUid = async (uid) => {
  if (typeof uid === 'string' && uid.trim()) {
    return uid.trim();
  }

  if (typeof globalThis !== 'undefined' && typeof globalThis.__MEMORY_CUE_AUTH_USER_ID === 'string') {
    const scopedUid = globalThis.__MEMORY_CUE_AUTH_USER_ID.trim();
    if (scopedUid) {
      return scopedUid;
    }
  }

  return null;
};

const normalizeText = (text) => {
  if (typeof text !== 'string') {
    return '';
  }

  return text.replace(/\s+/g, ' ').trim();
};

const normalizeEmbedding = (embedding) => {
  if (!Array.isArray(embedding)) {
    return [];
  }

  return embedding
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
};

const cosineSimilarity = (left, right) => {
  const normalizedLeft = normalizeEmbedding(left);
  const normalizedRight = normalizeEmbedding(right);
  if (!normalizedLeft.length || !normalizedRight.length) {
    return 0;
  }

  const dimensions = Math.min(normalizedLeft.length, normalizedRight.length);
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < dimensions; index += 1) {
    dotProduct += normalizedLeft[index] * normalizedRight[index];
    leftMagnitude += normalizedLeft[index] * normalizedLeft[index];
    rightMagnitude += normalizedRight[index] * normalizedRight[index];
  }

  if (leftMagnitude <= 0 || rightMagnitude <= 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
};


export const getEmbeddingsForUser = async (uid) => {
  const resolvedUid = await resolveUid(uid);
  if (!resolvedUid) {
    return [];
  }

  return getMemories().filter((memory) => memory?.userId === resolvedUid && Array.isArray(memory?.embedding) && memory.embedding.length);
};

const findEmbeddingBySourceId = async ({ uid, sourceId }) => {
  if (!uid || !sourceId) {
    return null;
  }

  return getMemories().find((memory) => (
    memory?.userId === uid
    && Array.isArray(memory?.embedding)
    && memory.embedding.length
    && memory?.metadata?.sourceId === sourceId
  )) || null;
};

export const storeEmbedding = async (payload, legacyEmbedding) => {
  const isLegacySignature = typeof payload === 'string';
  const normalizedPayload = isLegacySignature
    ? {
      sourceId: payload,
      embedding: legacyEmbedding,
      text: payload,
      sourceType: 'memory',
    }
    : (payload && typeof payload === 'object' ? payload : {});

  const resolvedUid = await resolveUid(normalizedPayload.uid);
  const normalizedText = normalizeText(normalizedPayload.text);
  const normalizedSourceType = typeof normalizedPayload.sourceType === 'string' ? normalizedPayload.sourceType.trim() : '';
  const normalizedSourceId = typeof normalizedPayload.sourceId === 'string' ? normalizedPayload.sourceId.trim() : '';
  const normalizedVector = normalizeEmbedding(normalizedPayload.embedding);

  if (!resolvedUid || !normalizedText || !normalizedSourceType || !normalizedSourceId || !normalizedVector.length) {
    return null;
  }

  const existing = await findEmbeddingBySourceId({ uid: resolvedUid, sourceId: normalizedSourceId });
  if (existing) {
    return existing.id;
  }

  const saved = await saveMemory({
    id: normalizedSourceId,
    userId: resolvedUid,
    text: normalizedText,
    type: normalizedSourceType,
    embedding: normalizedVector,
    entryPoint: 'embedding-service',
    source: normalizedSourceType,
    metadata: {
      sourceId: normalizedSourceId,
      sourceType: normalizedSourceType,
    },
  });

  return saved?.id || null;
};

export const similaritySearch = (queryEmbedding, memories = []) => {
  const normalizedQuery = normalizeEmbedding(queryEmbedding);
  if (!normalizedQuery.length || !Array.isArray(memories)) {
    return [];
  }

  return memories
    .map((memory) => ({
      ...memory,
      score: cosineSimilarity(normalizedQuery, memory?.embedding),
    }))
    .filter((memory) => Number.isFinite(memory.score))
    .sort((left, right) => right.score - left.score);
};

export const indexSourceEmbedding = async ({ uid, text, sourceType, sourceId }) => {
  const normalizedText = normalizeText(text);
  const normalizedSourceId = typeof sourceId === 'string' ? sourceId.trim() : '';

  if (!normalizedText || !normalizedSourceId) {
    return null;
  }

  const resolvedUid = await resolveUid(uid);
  if (!resolvedUid) {
    return null;
  }

  const existing = await findEmbeddingBySourceId({ uid: resolvedUid, sourceId: normalizedSourceId });
  if (existing) {
    return existing.id;
  }

  const embedding = await generateEmbedding(normalizedText);
  if (!Array.isArray(embedding) || !embedding.length) {
    return null;
  }

  const embeddingId = await storeEmbedding({
    uid: resolvedUid,
    text: normalizedText,
    sourceType,
    sourceId: normalizedSourceId,
    embedding,
  });

  return embeddingId;
};
