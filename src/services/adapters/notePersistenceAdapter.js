import { createAndSaveNote } from '../../../js/modules/notes-storage.js';
import { indexSourceEmbedding } from '../embeddingService.js';

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
  }

  return note;
};
