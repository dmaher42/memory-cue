import { findUserDocumentByField, loadUserCollection, storeEmbedding as storeUserEmbedding } from './firestoreService.js';

const FIREBASE_VERSION = '12.2.1';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`;

let embeddingContextPromise = null;

const resolveFirebaseConfig = () => {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  return globalThis?.memoryCueFirebase?.getFirebaseConfig?.() || null;
};

const ensureEmbeddingContext = async () => {
  if (embeddingContextPromise) {
    return embeddingContextPromise;
  }

  embeddingContextPromise = (async () => {
    const config = resolveFirebaseConfig();
    if (!config?.projectId) {
      console.warn('[embedding] Firebase config unavailable.');
      return null;
    }

    const appModule = await import(FIREBASE_APP_URL);
    const authModule = await import(FIREBASE_AUTH_URL);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(config);
    const auth = authModule.getAuth(app);
    return {
      auth,
    };
  })();

  return embeddingContextPromise;
};

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

  const context = await ensureEmbeddingContext();
  return context?.auth?.currentUser?.uid || null;
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

export async function generateEmbedding(text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: normalizedText }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed (${response.status})`);
  }

  const data = await response.json();
  return normalizeEmbedding(data?.embedding);
}

export const getEmbeddingsForUser = async (uid) => {
  const resolvedUid = await resolveUid(uid);
  const context = await ensureEmbeddingContext();
  if (!context || !resolvedUid) {
    return [];
  }

  return loadUserCollection(resolvedUid, 'embeddings');
};

const findEmbeddingBySourceId = async ({ uid, sourceId }) => {
  const context = await ensureEmbeddingContext();
  if (!context || !uid || !sourceId) {
    return null;
  }

  return findUserDocumentByField(uid, 'embeddings', 'sourceId', sourceId);
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
  const context = await ensureEmbeddingContext();
  const normalizedText = normalizeText(normalizedPayload.text);
  const normalizedSourceType = typeof normalizedPayload.sourceType === 'string' ? normalizedPayload.sourceType.trim() : '';
  const normalizedSourceId = typeof normalizedPayload.sourceId === 'string' ? normalizedPayload.sourceId.trim() : '';
  const normalizedVector = normalizeEmbedding(normalizedPayload.embedding);

  if (!context || !resolvedUid || !normalizedText || !normalizedSourceType || !normalizedSourceId || !normalizedVector.length) {
    return null;
  }

  const existing = await findEmbeddingBySourceId({ uid: resolvedUid, sourceId: normalizedSourceId });
  if (existing) {
    return existing.id;
  }

  const added = await storeUserEmbedding(resolvedUid, {
    text: normalizedText,
    sourceType: normalizedSourceType,
    sourceId: normalizedSourceId,
    embedding: normalizedVector,
    createdAt: Date.now(),
  });

  return added.id;
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

  console.debug('[embedding] generating embedding', { sourceType, sourceId: normalizedSourceId });
  const embedding = await generateEmbedding(normalizedText);
  if (!embedding.length) {
    return null;
  }

  const embeddingId = await storeEmbedding({
    uid: resolvedUid,
    text: normalizedText,
    sourceType,
    sourceId: normalizedSourceId,
    embedding,
  });

  if (embeddingId) {
    console.debug('[embedding] embedding stored', { sourceType, sourceId: normalizedSourceId, embeddingId });
  }

  return embeddingId;
};
