import { searchMemoryIndex } from '../../js/modules/memory-index.js';

const QUERY_PREFIXES = ['what', 'show', 'find', 'list'];

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeToken = (value) => normalizeText(value).toLowerCase();

const parseHashtagTags = (query) => {
  const matches = typeof query === 'string' ? query.match(/#([a-z0-9_-]+)/gi) : null;
  if (!matches) {
    return [];
  }

  return matches
    .map((tag) => normalizeToken(tag.replace(/^#/, '')))
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
};

const parseExplicitTagTerms = (query) => {
  if (typeof query !== 'string') {
    return [];
  }

  const matches = [...query.matchAll(/tags?\s+([a-z0-9\s_-]+)/gi)];
  if (!matches.length) {
    return [];
  }

  return matches
    .flatMap((match) => normalizeText(match[1]).split(/[,\s]+/))
    .map((tag) => normalizeToken(tag))
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
};

const parseNotebookTerm = (query) => {
  if (typeof query !== 'string') {
    return '';
  }

  const explicitMatch = query.match(/notebook\s+([a-z0-9\s_-]+)/i);
  if (explicitMatch) {
    return normalizeToken(explicitMatch[1]);
  }

  const inMatch = query.match(/in\s+([a-z0-9\s_-]+)\s+notebook/i);
  if (inMatch) {
    return normalizeToken(inMatch[1]);
  }

  return '';
};

const matchesTagTerms = (entry, tagTerms) => {
  if (!tagTerms.length) {
    return true;
  }

  const tags = Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalizeToken(tag)) : [];
  return tagTerms.every((tagTerm) => tags.some((tag) => tag.includes(tagTerm)));
};

const matchesNotebookTerm = (entry, notebookTerm) => {
  if (!notebookTerm) {
    return true;
  }

  const folderName = normalizeToken(entry?.folder);
  return folderName.includes(notebookTerm);
};

const formatLineItems = (entries) => entries
  .map((entry) => `• ${entry.title}`)
  .join('\n');

export const isMemorySearchQuery = (text) => {
  const normalized = normalizeToken(text);
  if (!normalized) {
    return false;
  }

  return QUERY_PREFIXES.some((prefix) => normalized.startsWith(`${prefix} `));
};

export const searchNotesMemory = (query) => {
  const normalizedQuery = normalizeText(query);
  const tagTerms = [...parseHashtagTags(normalizedQuery), ...parseExplicitTagTerms(normalizedQuery)]
    .filter((tag, index, list) => tag && list.indexOf(tag) === index);
  const notebookTerm = parseNotebookTerm(normalizedQuery);

  const filteredResults = searchMemoryIndex(normalizedQuery).filter((entry) => (
    matchesTagTerms(entry, tagTerms) && matchesNotebookTerm(entry, notebookTerm)
  ));

  return {
    query: normalizedQuery,
    count: filteredResults.length,
    items: filteredResults,
    filters: {
      tags: tagTerms,
      notebook: notebookTerm,
    },
  };
};

export const formatMemorySearchResponse = (result) => {
  const count = Number(result?.count) || 0;
  const items = Array.isArray(result?.items) ? result.items : [];

  if (!count || !items.length) {
    return 'I could not find any matching notes yet.';
  }

  const heading = count === 1 ? 'You have 1 note saved:' : `You have ${count} notes saved:`;
  return `${heading}\n\n${formatLineItems(items)}`;
};
