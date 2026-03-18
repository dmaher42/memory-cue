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
    return null;
  }

  console.log('[embedding] using API route');
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
    console.error('[embedding] API error', res.status);
    return null;
  }

  const data = await res.json();
  return normalizeEmbedding(data?.embedding);
}
