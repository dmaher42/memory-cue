import {
  createNote,
  loadAllNotes,
  saveAllNotes,
  setRemoteSyncHandler,
} from './notes-storage.js';

let firebaseDepsPromise = null;

const FALLBACK_FIREBASE_CONFIG = Object.freeze({});
let cachedFirebaseConfig = null;

const getGlobalScope = () => {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return {};
};

const resolveFirebaseConfig = () => {
  if (cachedFirebaseConfig) {
    return { ...cachedFirebaseConfig };
  }

  const scope = getGlobalScope();
  const memoryCueApi = scope?.memoryCueFirebase;

  if (memoryCueApi && typeof memoryCueApi.getFirebaseConfig === 'function') {
    cachedFirebaseConfig = memoryCueApi.getFirebaseConfig();
    return { ...cachedFirebaseConfig };
  }

  if (typeof require === 'function') {
    try {
      const moduleValue = require('../firebase-config.js');
      const getter = typeof moduleValue?.getFirebaseConfig === 'function'
        ? moduleValue.getFirebaseConfig
        : typeof moduleValue?.default?.getFirebaseConfig === 'function'
          ? moduleValue.default.getFirebaseConfig
          : null;
      if (getter) {
        cachedFirebaseConfig = getter();
        return { ...cachedFirebaseConfig };
      }
    } catch {
      // ignore – likely running in the browser without require
    }
  }

  if (memoryCueApi && memoryCueApi.DEFAULT_FIREBASE_CONFIG) {
    cachedFirebaseConfig = { ...memoryCueApi.DEFAULT_FIREBASE_CONFIG };
    return { ...cachedFirebaseConfig };
  }

  cachedFirebaseConfig = { ...FALLBACK_FIREBASE_CONFIG };
  return { ...cachedFirebaseConfig };
};

const loadFirebaseDeps = async () => {
  if (firebaseDepsPromise) {
    return firebaseDepsPromise;
  }

  firebaseDepsPromise = (async () => {
    const appModule = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js');
    const firestoreModule = await import('https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js');
    return {
      initializeApp: appModule.initializeApp,
      getApps: appModule.getApps,
      getApp: appModule.getApp,
      getFirestore: firestoreModule.getFirestore,
      collection: firestoreModule.collection,
      doc: firestoreModule.doc,
      setDoc: firestoreModule.setDoc,
      getDocs: firestoreModule.getDocs,
      deleteDoc: firestoreModule.deleteDoc,
    };
  })().catch((error) => {
    firebaseDepsPromise = null;
    throw error;
  });

  return firebaseDepsPromise;
};

const mapFirestoreNote = (noteId, data = {}) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const bodyHtml =
    typeof data.bodyHtml === 'string'
      ? data.bodyHtml
      : typeof data.body === 'string'
        ? data.body
        : typeof data.bodyText === 'string'
          ? data.bodyText
          : '';

  return createNote(data.title, bodyHtml, {
    id: typeof data.id === 'string' && data.id ? data.id : noteId,
    bodyHtml,
    bodyText: typeof data.bodyText === 'string' ? data.bodyText : undefined,
    folderId: typeof data.folderId === 'string' ? data.folderId : undefined,
    pinned: typeof data.pinned === 'boolean' ? data.pinned : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    semanticEmbedding: data.semanticEmbedding,
    keywords: data.keywords,
    metadata: data.metadata,
    links: data.links,
  });
};

const normalizeUserId = (user) => {
  if (typeof user?.id === 'string' && user.id) {
    return user.id;
  }
  if (typeof user?.uid === 'string' && user.uid) {
    return user.uid;
  }
  return null;
};

export const initNotesSync = (options = {}) => {
  const {
    onRemotePull = null,
    debugLogger = null,
  } = options;

  let currentUserId = null;
  let isApplyingRemote = false;
  let remoteSyncPromise = null;
  let firestoreDb = null;
  let firestoreApi = null;

  const logDebug = (...args) => {
    if (typeof debugLogger === 'function') {
      try {
        debugLogger(...args);
      } catch {
        // Debug logging failures should never break sync.
      }
    }
  };

  const ensureFirestore = async () => {
    if (firestoreDb && firestoreApi) {
      return { db: firestoreDb, api: firestoreApi };
    }

    const deps = await loadFirebaseDeps();
    const firebaseConfig = resolveFirebaseConfig();
    if (!firebaseConfig || typeof firebaseConfig !== 'object' || !firebaseConfig.projectId) {
      throw new Error('Firebase config missing projectId for notes sync');
    }

    const app = deps.getApps().length ? deps.getApp() : deps.initializeApp(firebaseConfig);
    firestoreDb = deps.getFirestore(app);
    firestoreApi = {
      collection: deps.collection,
      doc: deps.doc,
      setDoc: deps.setDoc,
      getDocs: deps.getDocs,
      deleteDoc: deps.deleteDoc,
    };

    return { db: firestoreDb, api: firestoreApi };
  };

  const getNotesCollection = (db, api, userId) => api.collection(db, 'users', userId, 'notes');

  const syncToRemote = async (notes) => {
    if (!currentUserId) {
      return;
    }

    const { db, api } = await ensureFirestore();
    const notesCollection = getNotesCollection(db, api, currentUserId);

    const sanitized = Array.isArray(notes)
      ? notes.filter((note) => note && typeof note.id === 'string')
      : [];

    const localIds = new Set(sanitized.map((note) => note.id));

    for (const note of sanitized) {
      await api.setDoc(api.doc(notesCollection, note.id), {
        id: note.id,
        userId: currentUserId,
        title: typeof note.title === 'string' ? note.title : 'Untitled note',
        body: typeof note.body === 'string' ? note.body : '',
        bodyHtml: typeof note.bodyHtml === 'string' ? note.bodyHtml : '',
        bodyText: typeof note.bodyText === 'string' ? note.bodyText : '',
        folderId: typeof note.folderId === 'string' ? note.folderId : null,
        pinned: note.pinned === true,
        createdAt: typeof note.createdAt === 'string' ? note.createdAt : new Date().toISOString(),
        updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : new Date().toISOString(),
        semanticEmbedding: Array.isArray(note.semanticEmbedding) ? note.semanticEmbedding : null,
        keywords: Array.isArray(note.keywords) ? note.keywords : [],
        metadata: note.metadata && typeof note.metadata === 'object' ? note.metadata : null,
        links: Array.isArray(note.links) ? note.links : [],
      });
    }

    const existingSnapshot = await api.getDocs(notesCollection);
    for (const remoteDoc of existingSnapshot.docs) {
      if (!localIds.has(remoteDoc.id)) {
        await api.deleteDoc(api.doc(notesCollection, remoteDoc.id));
      }
    }
  };

  const migrateLocalNotes = async () => {
    if (!currentUserId) {
      return 0;
    }

    const localNotes = loadAllNotes();
    if (!Array.isArray(localNotes) || !localNotes.length) {
      return 0;
    }

    await syncToRemote(localNotes);
    console.log('[notes-sync] notes migrated to firestore', { count: localNotes.length });
    return localNotes.length;
  };

  const pullFromRemote = async () => {
    if (!currentUserId || isApplyingRemote) {
      return;
    }

    try {
      logDebug('[notes-sync] Starting Firestore pull');
      const { db, api } = await ensureFirestore();
      const notesCollection = getNotesCollection(db, api, currentUserId);
      const snapshot = await api.getDocs(notesCollection);
      const remoteNotes = snapshot.docs
        .map((noteDoc) => mapFirestoreNote(noteDoc.id, noteDoc.data()))
        .filter(Boolean);

      if (remoteNotes.length) {
        isApplyingRemote = true;
        const saved = saveAllNotes(remoteNotes, { skipRemoteSync: true });
        isApplyingRemote = false;

        if (!saved) {
          console.warn('[notes-sync] Unable to replace local notes cache from Firestore.');
        }

        if (typeof onRemotePull === 'function') {
          try {
            onRemotePull({ mergedCount: remoteNotes.length, remoteCount: remoteNotes.length });
          } catch (callbackError) {
            console.warn('[notes-sync] onRemotePull callback failed.', callbackError);
          }
        }
        return;
      }

      const migratedCount = await migrateLocalNotes();
      if (typeof onRemotePull === 'function') {
        try {
          onRemotePull({ mergedCount: migratedCount, remoteCount: 0 });
        } catch (callbackError) {
          console.warn('[notes-sync] onRemotePull callback failed (empty remote).', callbackError);
        }
      }
    } catch (error) {
      console.error('[notes-sync] Failed to sync notes with Firestore.', error);
    } finally {
      isApplyingRemote = false;
    }
  };

  const maybeSyncFromRemote = async () => {
    if (!currentUserId || isApplyingRemote || remoteSyncPromise) {
      return remoteSyncPromise;
    }
    remoteSyncPromise = pullFromRemote()
      .catch(() => {
        // Swallow sync errors here; pullFromRemote already logs detail.
      })
      .finally(() => {
        remoteSyncPromise = null;
      });
    return remoteSyncPromise;
  };

  setRemoteSyncHandler(async (notes) => {
    if (isApplyingRemote) {
      return;
    }
    try {
      await syncToRemote(notes);
    } catch (error) {
      console.error('[notes-sync] Failed to sync notes to Firestore.', error);
    }
  });

  const handleSessionChange = async (user) => {
    currentUserId = normalizeUserId(user);
    logDebug('[notes-sync] Session change', { userId: currentUserId });
    if (!currentUserId) {
      return;
    }
    await pullFromRemote();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', maybeSyncFromRemote);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          maybeSyncFromRemote();
        }
      });
    }
  }

  return {
    setSupabaseClient() {
      // No-op for backward compatibility with existing mobile bootstrap code.
    },
    handleSessionChange,
    syncFromRemote: pullFromRemote,
  };
};
