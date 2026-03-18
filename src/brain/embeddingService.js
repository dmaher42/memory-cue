if (typeof window !== 'undefined' && !window.__ENV) {
  window.__ENV = {};
}

const resolveOpenAiKey = () => {
  if (typeof window !== 'undefined') {
    const runtimeKey = typeof window.__ENV?.OPENAI_API_KEY === 'string'
      ? window.__ENV.OPENAI_API_KEY.trim()
      : '';
    if (runtimeKey) {
      return runtimeKey;
    }
  }

  if (typeof process !== 'undefined' && typeof process.env?.OPENAI_API_KEY === 'string') {
    return process.env.OPENAI_API_KEY.trim();
  }

  return '';
};

export const isEmbeddingEnabled = () => Boolean(resolveOpenAiKey());

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
  const openAiKey = resolveOpenAiKey();

  if (!normalizedText || !openAiKey) {
    return [];
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
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
