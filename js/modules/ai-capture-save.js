import {
  createNote,
  getFolders,
  loadAllNotes,
  saveAllNotes,
  saveFolders,
} from './notes-storage.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeOptionalString = (value) => {
  const normalized = normalizeString(value);
  return normalized || undefined;
};

const buildMetadataFooter = ({ tags = [], type, aiPriority, aiActionDate, aiFollowUpQuestion }) => {
  const lines = [];

  if (tags.length) {
    lines.push(`Tags: ${tags.join(', ')}`);
  }
  if (type) {
    lines.push(`Type: ${type}`);
  }
  if (aiPriority) {
    lines.push(`Priority: ${aiPriority}`);
  }
  if (aiActionDate) {
    lines.push(`Action Date: ${aiActionDate}`);
  }
  if (aiFollowUpQuestion) {
    lines.push(`Follow Up: ${aiFollowUpQuestion}`);
  }

  return lines.length ? lines.join('\n') : '';
};

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
  const basePlainTextBody = typeof entry.body === 'string' ? entry.body : '';

  const nowIso = new Date().toISOString();
  const folderId = ensureFolderExistsByName(entry.folder);
  const confidenceRaw = entry.aiConfidence ?? entry.confidence;
  const confidenceValue = Number(confidenceRaw);
  const tags = Array.isArray(entry.tags)
    ? entry.tags
        .map((tag) => normalizeString(tag))
        .filter((tag, index, list) => tag.length && list.indexOf(tag) === index)
    : [];
  const type = normalizeOptionalString(entry.type);
  const aiPriority = normalizeOptionalString(entry.aiPriority);
  const aiActionDate = normalizeOptionalString(entry.aiActionDate);
  const aiFollowUpQuestion = normalizeOptionalString(entry.aiFollowUpQuestion);
  const metadataFooter = buildMetadataFooter({
    tags,
    type,
    aiPriority,
    aiActionDate,
    aiFollowUpQuestion,
  });
  const plainTextBody = metadataFooter
    ? `${basePlainTextBody.trimEnd()}${basePlainTextBody.trimEnd() ? '\n\n' : ''}${metadataFooter}`
    : basePlainTextBody;
  const bodyHtml = htmlFromPlainText(plainTextBody);
  const bodyText = textFromPlainText(plainTextBody);

  const note = createNote(title, bodyHtml, {
    bodyHtml,
    bodyText,
    createdAt: nowIso,
    updatedAt: nowIso,
    folderId,
    metadata: {
      type,
      tags,
      aiCaptured: true,
      aiConfidence: Number.isFinite(confidenceValue) ? confidenceValue : undefined,
      aiPriority,
      aiActionDate,
      aiFollowUpQuestion,
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
