import { captureInput } from '../core/capturePipeline.js';

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const getEntryText = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  return normalizeText(entry.title || entry.text || entry.content || entry.body || '');
};

const mapDecisionToCountType = (decision) => {
  const parsedType = typeof decision?.parsedType === 'string' ? decision.parsedType.trim().toLowerCase() : '';

  if (decision?.decisionType === 'persist_reminder') {
    return 'reminder';
  }

  if (parsedType === 'idea') {
    return 'idea';
  }

  if (parsedType === 'drill') {
    return 'training';
  }

  return 'note';
};

export const processInbox = async (entries = [], options = {}) => {
  const removeInboxEntry = typeof options.removeInboxEntry === 'function' ? options.removeInboxEntry : null;

  const counts = {
    note: 0,
    reminder: 0,
    idea: 0,
    training: 0,
    personal: 0,
  };

  const processedItems = [];

  for (const entry of entries) {
    const text = getEntryText(entry);
    if (!text) {
      continue;
    }

    const result = await captureInput({
      text,
      source: 'inbox',
      metadata: {
        source: typeof entry?.source === 'string' ? entry.source : 'inbox',
        entryId: entry?.id != null ? String(entry.id) : '',
        entryPoint: 'inbox.processInbox',
        capturedAt: Date.now(),
      },
    });

    const decision = result?.decision;
    if (!decision || decision.decisionType === 'persist_inbox' || decision.decisionType === 'query_memory') {
      continue;
    }

    const type = mapDecisionToCountType(decision);
    counts[type] += 1;
    processedItems.push({
      ...entry,
      type,
      text,
      tags: Array.isArray(decision?.parsedEntry?.tags) ? decision.parsedEntry.tags : [],
    });

    if (removeInboxEntry && entry?.id != null) {
      removeInboxEntry(String(entry.id));
    }
  }

  return {
    processedCount: processedItems.length,
    counts,
    processedItems,
    summary: [
      `Processed ${processedItems.length} notes.`,
      `${counts.idea + counts.training} teaching ideas`,
      `${counts.reminder} reminders`,
      `${counts.note + counts.personal} notes`,
    ].join('\n'),
  };
};
