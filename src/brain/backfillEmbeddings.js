import * as memoryService from '../services/memoryService.js';
import { generateEmbedding } from './embeddingService.js';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toMemoryPayload = (memory = {}) => ({
  id: typeof memory?.id === 'string' ? memory.id : '',
  text: normalizeText(memory?.text || memory?.bodyText || memory?.body || memory?.content || memory?.title),
  createdAt: memory?.createdAt,
  updatedAt: memory?.updatedAt,
  type: memory?.type || memory?.parsedType || memory?.metadata?.type || 'note',
  source: memory?.source || memory?.metadata?.source || 'capture',
  entryPoint: memory?.entryPoint || 'notes-sync.firestore',
  tags: Array.isArray(memory?.tags) ? memory.tags : memory?.keywords,
  embedding: memory?.embedding,
  pendingSync: memory?.pendingSync,
});

export async function backfillEmbeddings(memories = []) {
  const normalizedMemories = Array.isArray(memories) ? memories : [];

  for (const memory of normalizedMemories) {
    if (!memory?.id || Array.isArray(memory.embedding) && memory.embedding.length) {
      continue;
    }

    const text = normalizeText(memory.text);
    if (!text) {
      console.warn('[backfill] failed for:', memory.id);
      continue;
    }

    console.log('[backfill] generating embedding for:', text);

    const embedding = await generateEmbedding(text);

    if (!Array.isArray(embedding) || !embedding.length) {
      console.warn('[backfill] failed for:', memory.id);
      continue;
    }

    await memoryService.updateMemory(memory.id, {
      embedding,
      pendingSync: memory.pendingSync === false ? false : true,
    });

    console.log('[backfill] stored embedding for:', memory.id);
  }
}

export async function syncMemoriesFromFirestore(memories = []) {
  const normalizedMemories = Array.isArray(memories) ? memories : [];
  const syncedMemories = [];

  for (const memory of normalizedMemories) {
    const payload = toMemoryPayload(memory);
    if (!payload.id || !payload.text) {
      continue;
    }

    const synced = await memoryService.updateMemory(payload.id, payload);

    if (synced) {
      syncedMemories.push(synced);
    }
  }

  await backfillEmbeddings(syncedMemories);
  return syncedMemories;
}
