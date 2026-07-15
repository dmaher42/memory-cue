import * as memoryService from '../services/memoryService.js';
import { generateEmbedding } from './embeddingService.js';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const updateMemoriesInBatch = async (memories = []) => {
  const normalizedMemories = Array.isArray(memories) ? memories : [];
  if (!normalizedMemories.length) {
    return [];
  }
  if (typeof memoryService.updateMemories === 'function') {
    return memoryService.updateMemories(normalizedMemories);
  }
  return (await Promise.all(normalizedMemories.map((memory) => (
    memoryService.updateMemory(memory.id, memory)
  )))).filter(Boolean);
};

const toMemoryPayload = (memory = {}) => ({
  id: typeof memory?.id === 'string' ? memory.id : '',
  userId: typeof memory?.userId === 'string' ? memory.userId : '',
  text: normalizeText(memory?.text || memory?.bodyText || memory?.body || memory?.content || memory?.title),
  createdAt: memory?.createdAt,
  updatedAt: memory?.updatedAt,
  type: memory?.type || memory?.parsedType || memory?.metadata?.type || 'note',
  source: memory?.source || memory?.metadata?.source || 'capture',
  entryPoint: memory?.entryPoint || 'notes-sync.firestore',
  tags: Array.isArray(memory?.tags) ? memory.tags : memory?.keywords,
  embedding: Array.isArray(memory?.embedding) && memory.embedding.length
    ? memory.embedding
    : memory?.semanticEmbedding,
  pendingSync: memory?.pendingSync,
});

export async function backfillEmbeddings(memories = []) {
  const normalizedMemories = Array.isArray(memories) ? memories : [];
  const embeddingUpdates = [];

  for (const memory of normalizedMemories) {
    if (!memory?.id || Array.isArray(memory.embedding) && memory.embedding.length) {
      continue;
    }

    const text = normalizeText(memory.text);
    if (!text) {
      console.warn('[backfill] failed for:', memory.id);
      continue;
    }

    const embedding = await generateEmbedding(text);

    if (!Array.isArray(embedding) || !embedding.length) {
      console.warn('[backfill] failed for:', memory.id);
      continue;
    }

    embeddingUpdates.push({
      ...memory,
      embedding,
      pendingSync: memory.pendingSync === false ? false : true,
    });
  }

  return updateMemoriesInBatch(embeddingUpdates);
}

export async function syncMemoriesFromFirestore(memories = []) {
  const normalizedMemories = Array.isArray(memories) ? memories : [];
  const payloads = normalizedMemories
    .map((memory) => toMemoryPayload(memory))
    .filter((payload) => payload.id && payload.text);
  const syncedMemories = await updateMemoriesInBatch(payloads);

  await backfillEmbeddings(syncedMemories);
  return syncedMemories;
}
