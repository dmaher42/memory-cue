import { generateTags } from '../ai/tagGenerator.js';

const DEFAULT_NOTEBOOKS = ['Teaching', 'Coaching', 'Family', 'Ideas', 'Tasks'];
const FALLBACK_NOTEBOOK = 'Inbox';

const KEYWORD_RULES = [
  {
    notebook: 'Teaching',
    tags: ['teaching', 'lesson idea'],
    pattern: /\b(lesson|teach|teaching|class|classroom|student|curriculum|assignment|pompeii|history)\b/i,
  },
  {
    notebook: 'Coaching',
    tags: ['coaching'],
    pattern: /\b(coach|coaching|client|session|mentoring|mentor|1:1|one on one)\b/i,
  },
  {
    notebook: 'Family',
    tags: ['family'],
    pattern: /\b(family|mom|dad|parent|kids|child|home)\b/i,
  },
  {
    notebook: 'Ideas',
    tags: ['idea'],
    pattern: /\b(idea|brainstorm|concept|prototype|invent|explore)\b/i,
  },
  {
    notebook: 'Tasks',
    tags: ['task'],
    pattern: /\b(buy|task|todo|to-do|errand|groceries|shopping|finish|complete|call)\b/i,
  },
];

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const dedupeTags = (tags = []) => tags
  .map((tag) => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
  .filter((tag, index, list) => tag && list.indexOf(tag) === index);

const hasKeywordMatch = (text) => KEYWORD_RULES.some((rule) => rule.pattern.test(text));

const classifyWithKeywords = (text) => {
  const matchedRule = KEYWORD_RULES.find((rule) => rule.pattern.test(text));
  if (!matchedRule) {
    return { notebook: null, tags: [] };
  }

  const generatedTags = generateTags(text);
  return {
    notebook: matchedRule.notebook,
    tags: dedupeTags([...matchedRule.tags, ...generatedTags]),
  };
};

const classifyWithAI = async (text, options = {}) => {
  const classifier = typeof options.aiClassifier === 'function' ? options.aiClassifier : null;
  if (!classifier) {
    return { notebook: null, tags: generateTags(text) };
  }

  try {
    const result = await classifier(text);
    const notebook = typeof result?.notebook === 'string' ? result.notebook.trim() : '';
    const tags = Array.isArray(result?.tags) ? result.tags : [];
    return {
      notebook: notebook || null,
      tags: dedupeTags(tags),
    };
  } catch (error) {
    console.warn('[tagging-engine] AI fallback classification failed', error);
    return { notebook: null, tags: generateTags(text) };
  }
};

export const suggestNotebookAndTags = async (text, options = {}) => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return { notebook: FALLBACK_NOTEBOOK, tags: [] };
  }

  const keywordResult = classifyWithKeywords(normalizedText);
  if (keywordResult.notebook || keywordResult.tags.length) {
    return {
      notebook: keywordResult.notebook || FALLBACK_NOTEBOOK,
      tags: dedupeTags(keywordResult.tags),
    };
  }

  const aiResult = await classifyWithAI(normalizedText, options);
  const notebook = DEFAULT_NOTEBOOKS.includes(aiResult.notebook) ? aiResult.notebook : FALLBACK_NOTEBOOK;

  return {
    notebook,
    tags: dedupeTags(aiResult.tags),
  };
};

export const TAGGING_DEFAULT_NOTEBOOKS = [...DEFAULT_NOTEBOOKS];
export const TAGGING_FALLBACK_NOTEBOOK = FALLBACK_NOTEBOOK;
export const TAGGING_KEYWORD_MATCHER = hasKeywordMatch;
