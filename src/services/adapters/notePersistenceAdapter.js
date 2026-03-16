import { createAndSaveNote } from '../../../js/modules/notes-storage.js';
import { indexSourceEmbedding } from '../embeddingService.js';
import { saveMemory } from '../memoryService.js';

export const saveNote = (notePayload = {}, metadata = {}) => {
  const payload = notePayload && typeof notePayload === 'object' ? notePayload : {};
  const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {};

  const note = createAndSaveNote({
    ...payload,
    ...normalizedMetadata,
  });

  if (note?.id && typeof note.bodyText === 'string' && note.bodyText.trim()) {
    indexSourceEmbedding({
      text: note.bodyText,
      sourceType: 'note',
      sourceId: note.id,
    }).catch((error) => {
      console.warn('[embedding] Failed to index note embedding', error);
    });

    saveMemory({
      id: note.id,
      text: note.bodyText,
      type: payload.parsedType || 'note',
      createdAt: Date.parse(note.createdAt),
      updatedAt: Date.parse(note.updatedAt),
      source: typeof payload.source === 'string' ? payload.source : 'capture',
      entryPoint: typeof payload.entryPoint === 'string' ? payload.entryPoint : 'notes-storage.createAndSaveNote',
      tags: Array.isArray(payload.tags) ? payload.tags : note.keywords,
    }).catch((error) => {
      console.warn('[memory-service] Failed to save note memory', error);
    });
  }

  return note;
};
