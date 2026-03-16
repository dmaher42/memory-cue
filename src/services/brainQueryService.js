import { classifyIntentLocally } from './intentRouter.js';
import { generateEmbedding, similaritySearch } from './embeddingService.js';
import { getRecentMemories, searchMemories } from './memoryService.js';

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

const buildMemoryContext = (memories) => memories
  .slice(0, MAX_CONTEXT_MEMORIES)
  .map((memory, index) => {
    const notebook = truncateText(memory?.notebook, 60);
    const text = truncateText(memory?.text, MAX_MEMORY_TEXT_LENGTH);
    const tags = Array.isArray(memory?.tags) ? memory.tags.slice(0, 4).join(', ') : '';

    return [
      `${index + 1}. ${text}`,
      notebook ? `Notebook: ${notebook}` : '',
      tags ? `Tags: ${tags}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  })
  .filter(Boolean)
  .join('\n');

const buildPrompt = (question, memories) => {
  const snippets = buildMemoryContext(memories) || 'No relevant memories found.';
  return [
    'System:',
    'You are the Memory Cue assistant.',
    '',
    'Relevant memories:',
    snippets,
    '',
    'User question:',
    question,
    '',
    'Return answer grounded in the memories.',
  ].join('\n');
};

const callAiSummary = async (question, memories) => {
  const openAiApiKey = typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '';
  if (!openAiApiKey) {
    console.warn('[brain] AI fallback triggered', {
      stage: 'generateAnswer',
      reason: 'missing_openai_api_key',
    });
    return 'I found relevant memories, but AI summarization is unavailable because OPENAI_API_KEY is not configured.';
  }

  const prompt = [
    buildPrompt(question, memories),
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

  const allMemories = getRecentMemories(200);
  let selectedMemories = searchMemories(safeQuestion, MAX_CONTEXT_MEMORIES);

  try {
    const questionEmbedding = await generateEmbedding(safeQuestion);
    if (questionEmbedding.length) {
      selectedMemories = similaritySearch(questionEmbedding, allMemories)
        .slice(0, MAX_CONTEXT_MEMORIES);
    }
  } catch (error) {
    console.warn('[brain-query-service] Embedding retrieval failed', error);
  }

  console.info('[brain] memory_retrieved', {
    source: 'retrieveRelevantMemories',
    query: safeQuestion,
    count: selectedMemories.length,
  });

  return selectedMemories;
};

export const generateAnswer = async (question, context = {}) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  const memories = Array.isArray(context?.memories) ? context.memories : [];
  return callAiSummary(safeQuestion, memories);
};

export const queryBrain = async (question) => {
  const safeQuestion = truncateText(question, MAX_QUESTION_LENGTH);
  if (!safeQuestion) {
    return {
      answer: '',
      intent: { decisionType: 'query_memory', parsedType: 'question' },
      memories: [],
    };
  }

  const intent = classifyIntentLocally(safeQuestion, { source: 'brain-query-service' })
    || { decisionType: 'query_memory', parsedType: 'question' };
  console.info('[brain] routing decision', {
    source: 'queryBrain',
    decisionType: intent?.decisionType || 'query_memory',
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

  console.info('[brain] query_answered', {
    source: 'queryBrain',
    question: safeQuestion,
    memories: memories.length,
  });

  return {
    answer,
    intent: {
      decisionType: normalizeText(intent?.decisionType) || 'query_memory',
      parsedType: normalizeText(intent?.parsedType) || 'question',
    },
    memories,
  };
};
