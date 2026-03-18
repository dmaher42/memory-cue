export const isEmbeddingEnabled = () => true;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeEmbedding = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
};

export async function generateEmbedding(text) {
  const normalizedText = normalizeText(text);

  if (!normalizedText) {
    return [];
  }

  const res = await fetch('/api/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: normalizedText,
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding request failed (${res.status})`);
  }

  const data = await res.json();
  return normalizeEmbedding(data?.embedding);
}
