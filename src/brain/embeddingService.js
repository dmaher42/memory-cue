const OPENAI_KEY = (typeof window !== 'undefined' ? window.__ENV?.OPENAI_API_KEY : '') || import.meta.env?.VITE_OPENAI_API_KEY || null;

if (!OPENAI_KEY) {
  console.warn('[embedding] no OpenAI key configured');
}

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
  if (!normalizedText || !OPENAI_KEY) {
    return [];
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: normalizedText,
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding request failed (${res.status})`);
  }

  const data = await res.json();
  return normalizeEmbedding(data?.data?.[0]?.embedding);
}
