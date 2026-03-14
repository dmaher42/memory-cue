import { createAndSaveNote } from '../../../js/modules/notes-storage.js';

export const saveNote = (notePayload = {}, metadata = {}) => {
  const payload = notePayload && typeof notePayload === 'object' ? notePayload : {};
  const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {};

  return createAndSaveNote({
    ...payload,
    ...normalizedMetadata,
  });
};
