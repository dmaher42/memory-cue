import * as memoryService from '../services/memoryService.js';
import { generateEmbedding } from './embeddingService.js';

export async function backfillEmbeddings() {
  const memories = memoryService.getMemories();

  for (const memory of memories) {
    if (!memory.embedding) {
      const embedding = await generateEmbedding(memory.text);
      await memoryService.saveMemory({
        ...memory,
        embedding,
      });
      console.log('[backfill] updated memory', memory.id);
    }
  }
}
