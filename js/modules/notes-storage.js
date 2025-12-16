const NOTES_STORAGE_KEY = 'memoryCueNotes';
const FOLDERS_STORAGE_KEY = 'memoryCueFolders';
const LEGACY_NOTE_KEYS = ['mobileNotes', 'memory-cue-notes'];

const hasLocalStorage = () => typeof localStorage !== 'undefined';

let remoteSyncHandler = null;

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
  return {
    id: overrides.id && typeof overrides.id === 'string' ? overrides.id : generateId(),
    title: trimmedTitle || 'Untitled note',
    body: normalizedBodyHtml,
    bodyHtml: normalizedBodyHtml,
    bodyText: normalizedBodyText,
    pinned: typeof overrides.pinned === 'boolean' ? overrides.pinned : false,
    updatedAt:
      overrides.updatedAt && isValidDateString(overrides.updatedAt)
        ? overrides.updatedAt
        : new Date().toISOString(),
    folderId: overrides.folderId && typeof overrides.folderId === 'string' ? overrides.folderId : null,
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
          updatedAt,
          folderId: typeof note.folderId === 'string' && note.folderId ? note.folderId : null,
          bodyHtml: body,
          bodyText,
          pinned,
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
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
        folderId: typeof value.folderId === 'string' ? value.folderId : undefined,
        bodyHtml: body,
        bodyText,
        pinned,
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
    }
    return out;
  }).filter(Boolean);

  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(serializable));
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
const defaultFolders = () => [{ id: 'unsorted', name: 'Unsorted' }];

export const getFolders = () => {
  if (!hasLocalStorage()) {
    return defaultFolders();
  }
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // Ensure order is present; if missing, assign and persist
        let needsSave = false;
        const normalized = parsed.map((f, idx) => {
          const id = String(f.id);
          const name = typeof f.name === 'string' ? f.name : String(f.id);
          const order = typeof f.order === 'number' ? f.order : idx;
          if (typeof f.order !== 'number') needsSave = true;
          return { id, name, order };
        });
        if (needsSave) {
          try {
            localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(normalized));
          } catch {
            /* ignore write errors */
          }
        }
        return normalized;
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
  return found ? String(found.name) : 'Unsorted';
};

export const saveFolders = (folders) => {
  if (!hasLocalStorage() || !Array.isArray(folders)) {
    return false;
  }
  try {
    const sanitized = folders
      .filter((f) => f && typeof f.id === 'string' && f.id.trim())
      .map((f, idx) => ({ id: f.id, name: typeof f.name === 'string' ? f.name : String(f.id), order: typeof f.order === 'number' ? f.order : idx }));
    if (!sanitized.length) {
      // always ensure at least the unsorted folder exists
      sanitized.push(...defaultFolders());
    }
    localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(sanitized));
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
        folderId: folderId && typeof folderId === 'string' ? folderId : null,
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
