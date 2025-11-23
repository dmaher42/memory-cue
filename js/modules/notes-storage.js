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

  // If there's no HTML-like characters, return the original string.
  if (!/[<>]/.test(trimmed)) {
    return body;
  }

  try {
    if (typeof document !== 'undefined') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = trimmed;
      const text =
        typeof wrapper.innerText === 'string' && wrapper.innerText.length
          ? wrapper.innerText
          : wrapper.textContent || '';
      return text.replace(/\r?\n/g, '\n');
    }
  } catch (e) {
    // Ignore DOM conversion errors and fall back to regex handling below.
  }

  return trimmed
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?div[^>]*>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n');
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
    body: typeof body === 'string' ? decodeLegacyBody(body) : '',
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
        let body = typeof note.body === 'string' ? decodeLegacyBody(note.body) : '';
        const id = typeof note.id === 'string' && note.id.trim() ? note.id : generateId();
        const updatedAt = isValidDateString(note.updatedAt) ? note.updatedAt : new Date().toISOString();
        if (!title && !body && !note.body) {
          return null;
        }
        // If decodeLegacyBody stripped all text but the original raw body contained
        // HTML, preserve the original HTML so notes with only markup aren't lost.
        if (!body && note.body && /<[^>]+>/.test(note.body)) {
          body = note.body;
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
    let body = rawBody ? decodeLegacyBody(rawBody) : '';
    if (!body && rawBody && /<[^>]+>/.test(rawBody)) {
      body = rawBody;
    }
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
