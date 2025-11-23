const NOTES_STORAGE_KEY = 'memoryCueNotes';
const LEGACY_NOTE_KEYS = ['mobileNotes'];

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

const isValidDateString = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  const time = Date.parse(value);
  return !Number.isNaN(time);
};

export const createNote = (title, body, overrides = {}) => {
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  return {
    id: overrides.id && typeof overrides.id === 'string' ? overrides.id : generateId(),
    title: trimmedTitle || 'Untitled note',
    body: normalizeBodyValue(body),
    updatedAt:
      overrides.updatedAt && isValidDateString(overrides.updatedAt)
        ? overrides.updatedAt
        : new Date().toISOString(),
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
        let body = normalizeBodyValue(note.body);
        const id = typeof note.id === 'string' && note.id.trim() ? note.id : generateId();
        const updatedAt = isValidDateString(note.updatedAt) ? note.updatedAt : new Date().toISOString();
        if (!title && !body && !note.body) {
          return null;
        }
        return {
          id,
          title: title || 'Untitled note',
          body,
          updatedAt,
        };
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    const title = typeof value.title === 'string' ? value.title : '';
    const rawBody = typeof value.body === 'string' ? value.body : '';
    const body = normalizeBodyValue(rawBody);
    if (!title && !body) {
      return [];
    }
    return [
      createNote(title, body, {
        id: typeof value.id === 'string' ? value.id : undefined,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
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
    return normalized[0];
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
