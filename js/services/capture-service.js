import {
  getInboxEntries,
  saveInboxEntry,
  removeInboxEntry,
  INBOX_STORAGE_KEY,
} from '../../src/services/inboxService.js';
import { captureInput as captureFromPipeline } from '../../src/core/capturePipeline.js';
import { saveMemory } from '../../src/services/memoryService.js';

export { INBOX_STORAGE_KEY, getInboxEntries, removeInboxEntry, saveInboxEntry };

const normalizeCaptureArgs = (textOrPayload, source = 'capture') => {
  if (textOrPayload && typeof textOrPayload === 'object' && !Array.isArray(textOrPayload)) {
    return {
      text: typeof textOrPayload.text === 'string' ? textOrPayload.text : '',
      source: typeof textOrPayload.source === 'string' ? textOrPayload.source : source,
      metadata: textOrPayload.metadata && typeof textOrPayload.metadata === 'object' ? textOrPayload.metadata : {},
    };
  }

  return {
    text: typeof textOrPayload === 'string' ? textOrPayload : '',
    source: source && typeof source === 'object' ? source.source || 'capture' : source,
    metadata: source && typeof source === 'object'
      ? {
        ...source,
        source: undefined,
      }
      : {},
  };
};

export const captureInput = async (textOrPayload, source = 'capture') => {
  const payload = normalizeCaptureArgs(textOrPayload, source);
  return captureFromPipeline(payload);
};

export const convertInboxToNote = async (entryId) => {
  const targetId = typeof entryId === 'string' ? entryId : '';
  if (!targetId) {
    return null;
  }

  const entries = getInboxEntries();
  const entry = entries.find((candidate) => String(candidate?.id || '') === targetId);
  if (!entry || typeof entry?.text !== 'string' || !entry.text.trim()) {
    return null;
  }

  const memory = await saveMemory({
    text: entry.text,
    type: 'note',
    source: 'inbox',
    entryPoint: 'capture-service.convertInboxToNote',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
  });

  if (memory) {
    removeInboxEntry(targetId);
  }

  return memory;
};

if (typeof window !== 'undefined') {
  window.MemoryCueCaptureService = {
    captureInput,
    getInboxEntries,
    saveInboxEntry,
    removeInboxEntry,
    convertInboxToNote,
  };
}
