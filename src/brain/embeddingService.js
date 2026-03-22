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
  const res = await fetch('/api/embed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });

  if (!res.ok) {
    console.error('[embedding] API error', res.status);
    return null;
  }

  const data = await res.json();
  return data.embedding;
}
