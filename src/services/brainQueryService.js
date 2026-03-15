import { classifyIntentLocally } from './intentRouter.js';
import { createEmbedding, searchEmbeddings } from './embeddingService.js';
import { getMemoryById, searchMemories } from './memoryService.js';

const OPENAI_MODEL = 'gpt-5-nano';
const MAX_CONTEXT_MEMORIES = 5;
const MAX_MEMORY_TEXT_LENGTH = 220;
const MAX_QUESTION_LENGTH = 320;
const MAX_OUTPUT_TOKENS = 220;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const truncateText = (text, maxLength) => {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const scoreByTermOverlap = (question, memory) => {
  const tokens = normalizeText(question)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length > 2);

  if (!tokens.length) {
    return 0;
  }

  const haystack = [memory?.text, memory?.notebook, ...(Array.isArray(memory?.tags) ? memory.tags : [])]
    .join(' ')
    .toLowerCase();

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
};

const selectTopMemories = (question, lexicalMemories, embeddingMatches) => {
  const scored = new Map();

  lexicalMemories.forEach((memory, index) => {
    const memoryId = normalizeText(memory?.id);
    if (!memoryId) {
      return;
    }

    const overlapScore = scoreByTermOverlap(question, memory);
    const rankBonus = Math.max(0, 8 - index) * 0.25;
    scored.set(memoryId, {
      memory,
      score: overlapScore + rankBonus,
    });
  });

  embeddingMatches.forEach((match, index) => {
    const memoryId = normalizeText(match?.memoryId);
    if (!memoryId) {
      return;
    }

    const memory = getMemoryById(memoryId);
    if (!memory) {
      return;
    }

    const baseScore = Number(match?.score) || 0;
    const rankBonus = Math.max(0, 10 - index) * 0.1;
    const previous = scored.get(memoryId);

    scored.set(memoryId, {
      memory,
      score: (previous?.score || 0) + baseScore + rankBonus,
    });
  });

  return Array.from(scored.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CONTEXT_MEMORIES)
    .map((item) => item.memory);
};

const buildStructuredContext = (question, intent, memories) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  const memoryItems = memories.map((memory, index) => ({
    index: index + 1,
    id: normalizeText(memory?.id),
    type: normalizeText(memory?.type) || 'note',
    notebook: truncateText(memory?.notebook, 60),
    tags: Array.isArray(memory?.tags) ? memory.tags.slice(0, 6) : [],
    createdAt: normalizeText(memory?.createdAt),
    text: truncateText(memory?.text, MAX_MEMORY_TEXT_LENGTH),
  }));

  return {
    question: safeQuestion,
    intent: {
      decisionType: normalizeText(intent?.decisionType) || 'query',
      parsedType: normalizeText(intent?.parsedType) || 'question',
    },
    memories: memoryItems,
  };
};

const callAiSummary = async (contextPayload) => {
  const openAiApiKey = typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '';
  if (!openAiApiKey) {
    console.warn('[brain] AI fallback triggered', {
      stage: 'generateAnswer',
      reason: 'missing_openai_api_key',
    });
    return 'I found relevant memories, but AI summarization is unavailable because OPENAI_API_KEY is not configured.';
  }

  const prompt = [
    'You are Memory Cue, a concise personal memory assistant.',
    'Use only the provided JSON context to answer the user question.',
    'If context is incomplete, say what is missing in one short sentence.',
    'Respond in 3-5 sentences and keep the response under 120 words.',
    'JSON context:',
    JSON.stringify(contextPayload),
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Brain query failed: ${details}`);
  }

  const payload = await response.json();
  return payload.output_text
    || payload?.output?.[0]?.content?.[0]?.text
    || 'I could not generate a summary answer.';
};

export const retrieveRelevantMemories = async (question) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  if (!safeQuestion) {
    return [];
  }

  const lexicalMemories = searchMemories(safeQuestion);
  console.debug('[brain] memory retrieved', {
    source: 'retrieveRelevantMemories.lexical',
    query: safeQuestion,
    count: lexicalMemories.length,
  });

  let embeddingMatches = [];
  try {
    const questionEmbedding = await createEmbedding(safeQuestion);
    const memoryMatches = searchMemories(questionEmbedding, 12);
    embeddingMatches = memoryMatches.map((memory, index) => ({
      memoryId: memory.id,
      score: Math.max(0, 1 - (index * 0.05)),
    }));

    if (!embeddingMatches.length) {
      embeddingMatches = searchEmbeddings(questionEmbedding).slice(0, 12);
    }
  } catch (error) {
    console.warn('[brain-query-service] Embedding retrieval failed', error);
  }

  const selectedMemories = selectTopMemories(safeQuestion, lexicalMemories, embeddingMatches);
  console.info('[brain] memory retrieved', {
    source: 'retrieveRelevantMemories.selected',
    query: safeQuestion,
    count: selectedMemories.length,
  });

  return selectedMemories;
};

export const generateAnswer = async (question, context = {}) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  const memories = Array.isArray(context?.memories) ? context.memories : [];
  const intent = context?.intent && typeof context.intent === 'object' ? context.intent : {};

  const structuredContext = buildStructuredContext(safeQuestion, intent, memories);
  return callAiSummary(structuredContext);
};

export const queryBrain = async (question) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  if (!safeQuestion) {
    return {
      answer: '',
      intent: { decisionType: 'query', parsedType: 'question' },
      memories: [],
    };
  }

  const intent = classifyIntentLocally(safeQuestion, { source: 'brain-query-service' })
    || { decisionType: 'query', parsedType: 'question' };
  console.info('[brain] routing decision', {
    source: 'queryBrain',
    decisionType: intent?.decisionType || 'query',
    parsedType: intent?.parsedType || 'question',
  });

  const memories = await retrieveRelevantMemories(safeQuestion);

  let answer = '';
  try {
    answer = await generateAnswer(safeQuestion, { intent, memories });
  } catch (error) {
    console.warn('[brain] AI fallback triggered', {
      stage: 'queryBrain',
      reason: 'answer_generation_failed',
      message: error?.message || String(error),
    });
    answer = 'I found relevant memories, but could not generate an AI summary right now.';
  }

  return {
    answer,
    intent: {
      decisionType: normalizeText(intent?.decisionType) || 'query',
      parsedType: normalizeText(intent?.parsedType) || 'question',
    },
    memories,
  };
};
