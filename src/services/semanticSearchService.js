import { generateEmbedding, getEmbeddingsForUser } from './embeddingService.js';

const MAX_MATCHES = 5;

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return 0;
  }

  const dimensions = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < dimensions; i += 1) {
    const left = Number(a[i]);
    const right = Number(b[i]);

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      continue;
    }

    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const semanticSearch = async (query, uid) => {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) {
    return [];
  }

  const queryEmbedding = await generateEmbedding(normalizedQuery);
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) {
    return [];
  }

  const storedEmbeddings = await getEmbeddingsForUser(uid);
  const matches = storedEmbeddings
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item?.embedding),
    }))
    .filter((item) => Number.isFinite(item.score) && item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCHES)
    .map((item) => ({
      text: typeof item?.text === 'string' ? item.text : '',
      score: item.score,
    }))
    .filter((item) => item.text);

  return matches;
};
