const NOTES_STORAGE_KEY = 'memoryCueNotes';
const FOLDERS_STORAGE_KEY = 'memoryCueFolders';
const LEGACY_NOTE_KEYS = ['mobileNotes', 'memory-cue-notes'];

const hasLocalStorage = () => typeof localStorage !== 'undefined';

const normalizeSemanticEmbedding = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  const vector = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  return vector.length ? vector : null;
};

let remoteSyncHandler = null;
let memoryServiceModulePromise = null;

const dispatchNotesUpdated = (notes = []) => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memoryCue:notesUpdated', {
    detail: {
      items: Array.isArray(notes) ? notes : [],
    },
  }));
};

export const setRemoteSyncHandler = (handler) => {
  remoteSyncHandler = typeof handler === 'function' ? handler : null;
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const decodeLegacyBody = (body) => {
  if (typeof body !== 'string') {
    return '';
  }

  const trimmed = body.trim();
  if (!trimmed.length) {
    return '';
  }

  // If the body already contains HTML, preserve it verbatim to retain formatting.
  if (/[<>]/.test(trimmed)) {
    return body;
  }

  return body;
};

const normalizeBodyValue = (body) => {
  if (typeof body !== 'string') {
    return '';
  }

  const trimmed = body.trim();
  if (!trimmed.length) {
    return '';
  }

  // Preserve HTML markup, but still tolerate legacy plain-text bodies.
  if (/[<>]/.test(trimmed)) {
    return body;
  }

  return decodeLegacyBody(body);
};

const extractPlainText = (html = '') => {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const temp = document.createElement('div');
    temp.innerHTML = typeof html === 'string' ? html : '';
    return (temp.textContent || temp.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (typeof html !== 'string') {
    return '';
  }
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

const deriveBodyText = (html = '', fallbackText = '') => {
  const textFromHtml = extractPlainText(html);
  if (textFromHtml) {
    return textFromHtml;
  }
  if (typeof fallbackText === 'string') {
    return fallbackText.trim();
  }
  return '';
};

const isValidDateString = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  const time = Date.parse(value);
  return !Number.isNaN(time);
};

const sanitizeTags = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter((tag, index, list) => tag.length && list.indexOf(tag) === index);
};

const sanitizeLinks = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((linkId) => (typeof linkId === 'string' ? linkId.trim() : ''))
    .filter((linkId, index, list) => linkId.length && list.indexOf(linkId) === index);
};

const sanitizeMetadata = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const metadata = {};

  if (typeof value.type === 'string' && value.type.trim()) {
    metadata.type = value.type.trim();
  }

  const tags = sanitizeTags(value.tags);
  if (tags.length) {
    metadata.tags = tags;
  }

  if (value.aiCaptured === true) {
    metadata.aiCaptured = true;
  }

  const aiConfidence = Number(value.aiConfidence);
  if (Number.isFinite(aiConfidence)) {
    metadata.aiConfidence = aiConfidence;
  }

  if (typeof value.aiPriority === 'string' && value.aiPriority.trim()) {
    metadata.aiPriority = value.aiPriority.trim();
  }

  if (typeof value.aiActionDate === 'string' && value.aiActionDate.trim()) {
    metadata.aiActionDate = value.aiActionDate.trim();
  }

  if (typeof value.aiFollowUpQuestion === 'string' && value.aiFollowUpQuestion.trim()) {
    metadata.aiFollowUpQuestion = value.aiFollowUpQuestion.trim();
  }

  if (typeof value.source === 'string' && value.source.trim()) {
    metadata.source = value.source.trim();
  }

  return Object.keys(metadata).length ? metadata : null;
};

const sanitizeCanonicalTags = (value) => sanitizeTags(value);

const KEYWORD_STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'what', 'about', 'your', 'into',
  'not', 'are', 'was', 'were', 'you', 'they', 'their', 'there', 'then', 'them', 'just', 'also',
]);

const extractKeywordsFromText = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token, index, list) => token.length > 2 && !KEYWORD_STOP_WORDS.has(token) && list.indexOf(token) === index)
    .slice(0, 15);
};

const deriveKeywords = (title = '', bodyText = '', provided = null) => {
  if (Array.isArray(provided) && provided.length) {
    return sanitizeTags(provided).map((keyword) => keyword.toLowerCase());
  }

  return extractKeywordsFromText(`${title} ${bodyText}`);
};

const syncNoteToMemoryService = (note, payload = {}) => {
  if (!note || typeof note !== 'object' || typeof note.bodyText !== 'string' || !note.bodyText.trim()) {
    return;
  }

  if (!memoryServiceModulePromise) {
    memoryServiceModulePromise = import('../../src/services/memoryService.js?v=20260323a').catch((error) => {
      console.warn('[notes-storage] Failed to load memory service bridge', error);
      return null;
    });
  }

  memoryServiceModulePromise
    .then((memoryServiceModule) => {
      const saveMemory = memoryServiceModule?.saveMemory;
      if (typeof saveMemory !== 'function') {
        return;
      }

      return saveMemory({
        id: note.id,
        text: note.bodyText,
        type: payload.parsedType || payload.type || 'note',
        createdAt: Date.parse(note.createdAt),
        updatedAt: Date.parse(note.updatedAt),
        source: typeof payload.source === 'string' ? payload.source : 'capture',
        entryPoint:
          typeof payload.entryPoint === 'string'
            ? payload.entryPoint
            : 'notes-storage.createAndSaveNote',
        tags: Array.isArray(payload.tags) ? payload.tags : note.keywords,
      });
    })
    .catch((error) => {
      console.warn('[memory-service] Failed to mirror note save', error);
    });
};

const ensureNoteEmbedding = (note, notes, options = {}) => {
  if (!note || typeof note !== 'object' || normalizeSemanticEmbedding(note.semanticEmbedding)) {
    return;
  }

  const embeddingText = [note.title, note.bodyText, note.body]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n')
    .trim();

  if (!embeddingText) {
    return;
  }

  import('../../src/brain/embeddingService.js?v=20260323a')
    .then(async ({ generateEmbedding }) => {
      if (typeof generateEmbedding !== 'function') {
        return;
      }

      const embedding = normalizeSemanticEmbedding(await generateEmbedding(embeddingText));
      if (!embedding) {
        return;
      }

      note.semanticEmbedding = embedding;
      const nextNotes = Array.isArray(notes)
        ? notes.map((entry) => (entry?.id === note.id ? { ...entry, semanticEmbedding: embedding } : entry))
        : [note];
      saveAllNotes(nextNotes, options);
    })
    .catch((error) => {
      console.warn('[notes-storage] Failed to generate note embedding', error);
    });
};

export const createAndSaveNote = (payload = {}, options = {}) => {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
  const text = typeof normalizedPayload.text === 'string' ? normalizedPayload.text.trim() : '';
  if (!text) {
    return null;
  }

  const title =
    typeof normalizedPayload.title === 'string' && normalizedPayload.title.trim()
      ? normalizedPayload.title.trim()
      : text.split(/\s+/).slice(0, 8).join(' ') || 'Captured note';

  const parsedType =
    typeof normalizedPayload.parsedType === 'string' && normalizedPayload.parsedType.trim()
      ? normalizedPayload.parsedType.trim()
      : 'note';

  const note = createNote(title, text, {
    bodyText: text,
    folderId:
      typeof normalizedPayload.folderId === 'string' && normalizedPayload.folderId.trim()
        ? normalizedPayload.folderId.trim()
        : null,
    metadata: {
      type: parsedType,
      tags: sanitizeCanonicalTags(normalizedPayload.tags),
      source:
        typeof normalizedPayload.source === 'string' && normalizedPayload.source.trim()
          ? normalizedPayload.source.trim()
          : undefined,
    },
  });

  const notes = loadAllNotes();
  const saved = saveAllNotes([note, ...notes], options);
  if (saved) {
    syncNoteToMemoryService(note, normalizedPayload);
    ensureNoteEmbedding(note, [note, ...notes], options);
  }
  return saved ? note : null;
};

export const createNote = (title, bodyHtml, overrides = {}) => {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  const rawBodyHtml =
    typeof overrides.bodyHtml === 'string' && overrides.bodyHtml.length
      ? overrides.bodyHtml
      : bodyHtml;
  const normalizedBodyHtml = normalizeBodyValue(rawBodyHtml);
  const providedBodyText = typeof overrides.bodyText === 'string' ? overrides.bodyText : null;
  const normalizedBodyText =
    providedBodyText !== null ? providedBodyText.trim() : deriveBodyText(normalizedBodyHtml);
  const keywords = deriveKeywords(trimmedTitle, normalizedBodyText, overrides.keywords);
  return {
    id: overrides.id && typeof overrides.id === 'string' ? overrides.id : generateId(),
    title: trimmedTitle || 'Untitled note',
    body: normalizedBodyHtml,
    bodyHtml: normalizedBodyHtml,
    bodyText: normalizedBodyText,
    pinned: typeof overrides.pinned === 'boolean' ? overrides.pinned : false,
    createdAt:
      overrides.createdAt && isValidDateString(overrides.createdAt)
        ? overrides.createdAt
        : new Date().toISOString(),
    updatedAt:
      overrides.updatedAt && isValidDateString(overrides.updatedAt)
        ? overrides.updatedAt
        : new Date().toISOString(),
    folderId: overrides.folderId && typeof overrides.folderId === 'string' ? overrides.folderId : null,
    semanticEmbedding: normalizeSemanticEmbedding(overrides.semanticEmbedding),
    keywords,
    metadata: sanitizeMetadata(overrides.metadata),
    links: sanitizeLinks(overrides.links),
  };
};

const normalizeNotes = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((note) => {
        if (!note || typeof note !== 'object') {
          return null;
        }
        const title = typeof note.title === 'string' ? note.title.trim() : '';
        const rawBodyHtml =
          typeof note.bodyHtml === 'string' && note.bodyHtml.length
            ? note.bodyHtml
            : typeof note.body === 'string'
              ? note.body
              : typeof note.bodyText === 'string'
                ? note.bodyText
                : '';
        const fallbackText = typeof note.bodyText === 'string' ? note.bodyText : '';
        const body = normalizeBodyValue(rawBodyHtml || fallbackText);
        const bodyText = deriveBodyText(body, fallbackText);
        const id = typeof note.id === 'string' && note.id.trim() ? note.id : generateId();
        const updatedAt = isValidDateString(note.updatedAt) ? note.updatedAt : new Date().toISOString();
        const pinned = typeof note.pinned === 'boolean' ? note.pinned : false;
        if (!title && !body && !fallbackText) {
          return null;
        }
        return createNote(title || 'Untitled note', body, {
          id,
          createdAt: isValidDateString(note.createdAt) ? note.createdAt : updatedAt,
          updatedAt,
          folderId: typeof note.folderId === 'string' && note.folderId ? note.folderId : null,
          bodyHtml: body,
          bodyText,
          pinned,
          semanticEmbedding: normalizeSemanticEmbedding(note.semanticEmbedding),
          keywords: deriveKeywords(title, bodyText, note.keywords),
          metadata: sanitizeMetadata(note.metadata),
          links: sanitizeLinks(note.links),
        });
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    const title = typeof value.title === 'string' ? value.title : '';
    const rawBodyHtml = typeof value.bodyHtml === 'string' && value.bodyHtml.length
      ? value.bodyHtml
      : typeof value.body === 'string'
        ? value.body
        : typeof value.bodyText === 'string'
          ? value.bodyText
          : '';
    const fallbackText = typeof value.bodyText === 'string' ? value.bodyText : '';
    const body = normalizeBodyValue(rawBodyHtml || fallbackText);
    const bodyText = deriveBodyText(body, fallbackText);
    const pinned = typeof value.pinned === 'boolean' ? value.pinned : false;
    if (!title && !body && !bodyText) {
      return [];
    }
    return [
      createNote(title, body, {
        id: typeof value.id === 'string' ? value.id : undefined,
        createdAt: isValidDateString(value.createdAt) ? value.createdAt : undefined,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
        folderId: typeof value.folderId === 'string' ? value.folderId : undefined,
        bodyHtml: body,
        bodyText,
        pinned,
        semanticEmbedding: normalizeSemanticEmbedding(value.semanticEmbedding),
        keywords: deriveKeywords(title, bodyText, value.keywords),
        metadata: sanitizeMetadata(value.metadata),
        links: sanitizeLinks(value.links),
      }),
    ];
  }

  if (typeof value === 'string' && value.trim().length) {
    // For legacy plain-string notes, decode and preserve markup if present.
    return [createNote('Notebook (legacy)', decodeLegacyBody(value))];
  }

  return [];
};

const readStorageItem = (key) => {
  if (!hasLocalStorage()) {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const removeStorageItem = (key) => {
  if (!hasLocalStorage()) {
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore removal errors.
  }
};

export const loadAllNotes = () => {
  if (!hasLocalStorage()) {
    return [];
  }

  const raw = readStorageItem(NOTES_STORAGE_KEY);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      const notes = normalizeNotes(parsed);
      if (notes.length) {
        return notes;
      }
    } catch {
      const notes = normalizeNotes(raw);
      if (notes.length) {
        saveAllNotes(notes);
        return notes;
      }
    }
  }

  for (const key of LEGACY_NOTE_KEYS) {
    const legacyRaw = readStorageItem(key);
    if (typeof legacyRaw === 'string' && legacyRaw.trim().length) {
      const notes = normalizeNotes(legacyRaw);
      if (notes.length) {
        saveAllNotes(notes);
        removeStorageItem(key);
        return notes;
      }
    }
  }

  return [];
};

export const saveAllNotes = (notes, options = {}) => {
  if (!hasLocalStorage() || !Array.isArray(notes)) {
    return false;
  }

  const serializable = notes.map((note) => {
    const normalized = normalizeNotes([note]);
    // Ensure folderId is present in exported object
    const out = normalized[0];
    if (out) {
      out.folderId = typeof note.folderId === 'string' && note.folderId ? note.folderId : out.folderId || null;
      out.pinned = typeof note.pinned === 'boolean' ? note.pinned : Boolean(out.pinned);
      out.createdAt = isValidDateString(note.createdAt) ? note.createdAt : out.createdAt;
      out.semanticEmbedding = normalizeSemanticEmbedding(note.semanticEmbedding);
      out.keywords = deriveKeywords(out.title, out.bodyText, note.keywords || out.keywords);
      out.metadata = sanitizeMetadata(note.metadata);
      out.links = sanitizeLinks(note.links);
    }
    return out;
  }).filter(Boolean);

  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(serializable));
    dispatchNotesUpdated(serializable);
    if (!options.skipRemoteSync && typeof remoteSyncHandler === 'function') {
      try {
        const maybePromise = remoteSyncHandler(serializable);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.catch((error) => {
            console.error('[notes-storage] Remote sync failed.', error);
          });
        }
      } catch (error) {
        console.error('[notes-storage] Remote sync handler threw.', error);
      }
    }
    return true;
  } catch {
    return false;
  }
};

export { NOTES_STORAGE_KEY };

// Folders API
const CORE_NOTEBOOKS = [
  { id: 'school', name: 'School' },
  { id: 'coaching', name: 'Coaching' },
  { id: 'everyday', name: 'Everyday' },
  { id: 'archive', name: 'Archive' },
];

const ensureRequiredFolders = (folders = []) => {
  const normalized = Array.isArray(folders)
    ? folders
        .filter((folder) => folder && typeof folder.id === 'string' && folder.id.trim())
        .map((folder, index) => ({
          id: String(folder.id),
          name: typeof folder.name === 'string' ? folder.name : String(folder.id),
          order: typeof folder.order === 'number' ? folder.order : index,
        }))
    : [];

  let changed = false;

  CORE_NOTEBOOKS.forEach((requiredFolder) => {
    if (!normalized.some((folder) => folder.id === requiredFolder.id)) {
      normalized.push({ ...requiredFolder, order: normalized.length });
      changed = true;
    }
  });

  const withOrder = normalized.map((folder, index) => {
    if (folder.order !== index) {
      changed = true;
    }
    return { ...folder, order: index };
  });

  return { folders: withOrder, changed };
};

const defaultFolders = () => ensureRequiredFolders(CORE_NOTEBOOKS).folders;

export const getFolders = () => {
  if (!hasLocalStorage()) {
    return defaultFolders();
  }
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const ensured = ensureRequiredFolders(parsed);
        if (ensured.changed) {
          try {
            localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(ensured.folders));
          } catch {
            /* ignore write errors */
          }
        }
        return ensured.folders;
      }
    }
  } catch (e) {
    // fall through to return default
  }
  const defaults = defaultFolders();
  try {
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // ignore write errors when seeding defaults
  }
  return defaults;
};

// Helper to look up a folder name by id
export const getFolderNameById = (id) => {
  const folders = getFolders();
  const found = folders.find((f) => f && String(f.id) === String(id));
  return found ? String(found.name) : 'Everyday';
};

export const saveFolders = (folders) => {
  if (!hasLocalStorage() || !Array.isArray(folders)) {
    return false;
  }
  try {
    const ensured = ensureRequiredFolders(folders);
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(ensured.folders));
    return true;
  } catch (e) {
    return false;
  }
};

export const assignNoteToFolder = (noteId, folderId) => {
  if (!noteId || typeof noteId !== 'string') {
    return false;
  }
  const notes = loadAllNotes();
  let changed = false;
  const newNotes = notes.map((n) => {
    if (n.id === noteId) {
      changed = true;
      return {
        ...n,
        folderId: folderId && typeof folderId === 'string' ? folderId : 'everyday',
        updatedAt: new Date().toISOString(),
      };
    }
    return n;
  });
  if (!changed) {
    return false;
  }
  const saved = saveAllNotes(newNotes);
  return saved;
};

export const linkEntries = (sourceId, targetId) => {
  if (!sourceId || typeof sourceId !== 'string' || !targetId || typeof targetId !== 'string') {
    return false;
  }

  const sourceKey = sourceId.trim();
  const targetKey = targetId.trim();

  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return false;
  }

  const notes = loadAllNotes();
  if (!Array.isArray(notes) || !notes.length) {
    return false;
  }

  let sourceFound = false;
  let targetFound = false;
  let changed = false;

  const linkedNotes = notes.map((note) => {
    if (!note || typeof note !== 'object') {
      return note;
    }

    if (note.id === sourceKey) {
      sourceFound = true;
      const currentLinks = sanitizeLinks(note.links);
      if (!currentLinks.includes(targetKey)) {
        changed = true;
        return {
          ...note,
          links: [...currentLinks, targetKey],
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...note,
        links: currentLinks,
      };
    }

    if (note.id === targetKey) {
      targetFound = true;
      const currentLinks = sanitizeLinks(note.links);
      if (!currentLinks.includes(sourceKey)) {
        changed = true;
        return {
          ...note,
          links: [...currentLinks, sourceKey],
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...note,
        links: currentLinks,
      };
    }

    return note;
  });

  if (!sourceFound || !targetFound || !changed) {
    return false;
  }

  return saveAllNotes(linkedNotes);
};
