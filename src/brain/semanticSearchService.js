import { generateEmbedding } from './embeddingService.js';
import * as memoryService from '../services/memoryService.js';

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return -1;
  }

  const dimensions = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < dimensions; i += 1) {
    const left = Number(a[i]);
    const right = Number(b[i]);

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      continue;
    }

    dot += left * right;
    magA += left * left;
    magB += right * right;
  }

  if (!magA || !magB) {
    return -1;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function semanticSearch(query) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) {
    return [];
  }

  const queryEmbedding = await generateEmbedding(normalizedQuery);
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) {
    return [];
  }

  const memories = memoryService.getMemories();

  const scored = memories
    .filter((memory) => {
      if (!memory.embedding) return false;
      return true;
    })
    .map((memory) => ({
      ...memory,
      score: cosineSimilarity(queryEmbedding, memory.embedding),
    }))
    .filter((memory) => Number.isFinite(memory.score) && memory.score > -1);

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
