import { classifyIntentLocally } from './intentRouter.js';
import { requestAssistantChat, buildMemoryAssistantRequest } from './assistantOrchestrator.js';
import { generateEmbedding, similaritySearch } from './embeddingService.js';
import { getRecentMemories, searchMemories } from './memoryService.js';

const MAX_CONTEXT_MEMORIES = 5;
const MAX_MEMORY_TEXT_LENGTH = 220;
const MAX_QUESTION_LENGTH = 320;
const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const truncateText = (text, maxLength) => {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const callAiSummary = async (question, memories) => {
  const requestBody = buildMemoryAssistantRequest(
    question,
    memories.map((memory) => truncateText(memory?.text, MAX_MEMORY_TEXT_LENGTH)).filter(Boolean),
  );

  return requestAssistantChat(requestBody, {
    errorMessage: 'Brain query failed',
    fallbackReply: 'I could not generate a summary answer.',
  });
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
    if (Array.isArray(questionEmbedding) && questionEmbedding.length) {
      selectedMemories = similaritySearch(questionEmbedding, allMemories)
        .slice(0, MAX_CONTEXT_MEMORIES);
    }
  } catch (error) {
    console.warn('[brain-query-service] Embedding retrieval failed', error);
  }

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
      decisionType: normalizeText(intent?.decisionType) || 'query_memory',
      parsedType: normalizeText(intent?.parsedType) || 'question',
    },
    memories,
  };
};
