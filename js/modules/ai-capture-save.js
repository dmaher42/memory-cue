import {
  createNote,
  getFolders,
  loadAllNotes,
  saveAllNotes,
  saveFolders,
} from './notes-storage.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

export const htmlFromPlainText = (text) => {
  if (typeof text !== 'string' || !text.length) {
    return '';
  }

  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n|\r|\n/g, '<br>');
};

export const textFromPlainText = (text) => {
  if (typeof text !== 'string') {
    return '';
  }
  return text.trim();
};

export const ensureFolderExistsByName = (folderName) => {
  const requestedName = normalizeString(folderName);
  const fallbackId = 'unsorted';

  if (!requestedName) {
    return fallbackId;
  }

  const folders = Array.isArray(getFolders()) ? getFolders() : [];
  const existing = folders.find(
    (folder) => folder && typeof folder.name === 'string' && folder.name.trim().toLowerCase() === requestedName.toLowerCase(),
  );

  if (existing && typeof existing.id === 'string' && existing.id.trim()) {
    return existing.id;
  }

  const newFolderId = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdFolder = {
    id: newFolderId,
    name: requestedName,
    order: folders.length,
  };

  const saved = saveFolders([...folders, createdFolder]);
  return saved ? newFolderId : fallbackId;
};

export const saveCapturedEntry = (entry, options = {}) => {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Unable to save captured entry: entry must be an object.');
  }

  const title = normalizeString(entry.title) || 'Untitled note';
  const plainTextBody = typeof entry.body === 'string' ? entry.body : '';
  const bodyHtml = htmlFromPlainText(plainTextBody);
  const bodyText = textFromPlainText(plainTextBody);

  const nowIso = new Date().toISOString();
  const folderId = ensureFolderExistsByName(entry.folder);
  const confidenceValue = Number(entry.confidence);
  const tags = Array.isArray(entry.tags)
    ? entry.tags
        .map((tag) => normalizeString(tag))
        .filter((tag, index, list) => tag.length && list.indexOf(tag) === index)
    : [];

  const note = createNote(title, bodyHtml, {
    bodyHtml,
    bodyText,
    createdAt: nowIso,
    updatedAt: nowIso,
    folderId,
    metadata: {
      type: normalizeString(entry.type) || undefined,
      tags,
      aiCaptured: true,
      aiConfidence: Number.isFinite(confidenceValue) ? confidenceValue : undefined,
    },
  });

  const existingNotes = loadAllNotes();
  const shouldSkipRemoteSync = options && options.skipRemoteSync === true;
  const saved = saveAllNotes([note, ...existingNotes], { skipRemoteSync: shouldSkipRemoteSync });

  if (!saved) {
    throw new Error('Unable to save captured entry: failed to persist note to storage.');
  }

  try {
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('memoryCue:notesUpdated', { detail: { note } }));
    }
  } catch (error) {
    console.error('Unable to dispatch notes update event after AI capture save.', error);
  }

  return note;
};
