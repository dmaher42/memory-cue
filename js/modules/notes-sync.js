import {
  loadAllNotes,
  saveAllNotes,
  setRemoteSyncHandler,
} from './notes-storage.js';
import { syncNotes, subscribeToNotesChanges } from '../../src/services/firestoreSyncService.js';

let backfillEmbeddingsModulePromise = null;

const syncFirestoreMemoriesToLocalCache = async (notes = []) => {
  if (!Array.isArray(notes) || !notes.length) {
    return;
  }

  if (!backfillEmbeddingsModulePromise) {
    backfillEmbeddingsModulePromise = import('../../src/brain/backfillEmbeddings.js').catch((error) => {
      console.warn('[notes-sync] Failed to load memory backfill module.', error);
      return null;
    });
  }

  const backfillModule = await backfillEmbeddingsModulePromise;
  const syncMemoriesFromFirestore = backfillModule?.syncMemoriesFromFirestore;
  if (typeof syncMemoriesFromFirestore !== 'function') {
    return;
  }

  try {
    await syncMemoriesFromFirestore(notes);
  } catch (error) {
    console.warn('[notes-sync] Failed to backfill Firestore memory embeddings.', error);
  }
};

const mapRemoteNote = (note = {}) => {
  if (!note || typeof note !== 'object' || typeof note.id !== 'string' || !note.id) {
    return null;
  }

  return {
    ...note,
    id: note.id,
  };
};

const normalizeUserId = (user) => {
  if (typeof user?.id === 'string' && user.id) {
    return user.id;
  }
  return null;
};

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
};

export const initNotesSync = (options = {}) => {
  const {
    onRemotePull = null,
    debugLogger = null,
  } = options;

  let currentUserId = null;
  let isApplyingRemote = false;
  let remoteSyncPromise = null;
  let stopRemoteSubscription = null;

  const logDebug = (...args) => {
    if (typeof debugLogger === 'function') {
      try {
        debugLogger(...args);
      } catch {
        // Debug logging failures should never break sync.
      }
    }
  };

  const stopLiveSync = () => {
    if (typeof stopRemoteSubscription === 'function') {
      try {
        stopRemoteSubscription();
      } catch {
        // Ignore unsubscribe issues during session transitions.
      }
    }
    stopRemoteSubscription = null;
  };

  const applyRemoteNotes = async (remoteNotes = [], meta = {}) => {
    const normalized = Array.isArray(remoteNotes)
      ? remoteNotes.map((note) => mapRemoteNote(note)).filter(Boolean)
      : [];

    isApplyingRemote = true;
    const saved = saveAllNotes(normalized, { skipRemoteSync: true });
    if (saved && normalized.length) {
      await syncFirestoreMemoriesToLocalCache(normalized);
    }
    isApplyingRemote = false;

    if (!saved) {
      console.warn('[notes-sync] Unable to replace local notes cache from Firebase.');
    }

    if (typeof onRemotePull === 'function') {
      try {
        onRemotePull({
          mergedCount: normalized.length,
          remoteCount: normalized.length,
          ...meta,
        });
      } catch (callbackError) {
        console.warn('[notes-sync] onRemotePull callback failed.', callbackError);
      }
    }
  };

  const startLiveSync = async () => {
    stopLiveSync();
    if (!currentUserId) {
      return;
    }

    stopRemoteSubscription = await subscribeToNotesChanges({
      uid: currentUserId,
      onItems: (remoteNotes) => {
        if (isApplyingRemote) {
          return;
        }

        applyRemoteNotes(remoteNotes, { source: 'snapshot' }).catch((error) => {
          console.error('[notes-sync] Failed to apply live Firebase note updates.', error);
        });
      },
    });
  };

  const pullFromRemote = async () => {
    if (!currentUserId || isApplyingRemote) {
      return;
    }

    try {
      logDebug('[notes-sync] Starting Firebase pull');
      const remoteNotes = await syncNotes();
      const normalized = Array.isArray(remoteNotes)
        ? remoteNotes.map((note) => mapRemoteNote(note)).filter(Boolean)
        : [];
      const localNotes = loadAllNotes();

      if (!normalized.length) {
        if (Array.isArray(localNotes) && localNotes.length) {
          logDebug('[notes-sync] Remote notes empty; pushing local cache');
          await syncNotes(localNotes);
        }
        return;
      }
      await applyRemoteNotes(normalized, { source: 'pull' });
    } catch (error) {
      console.error('[notes-sync] Failed to sync notes with Firebase.', error);
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
    if (isApplyingRemote || !currentUserId) {
      return;
    }
    try {
      await syncNotes(Array.isArray(notes) ? notes : loadAllNotes());
    } catch (error) {
      console.error('[notes-sync] Failed to sync notes to Firebase.', error);
    }
  });

  const handleSessionChange = async (user) => {
    currentUserId = normalizeUserId(user);
    logDebug('[notes-sync] Session change', { userId: currentUserId });
    if (!currentUserId) {
      stopLiveSync();
      return;
    }
    await pullFromRemote();
    await startLiveSync();
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
    setFirebaseClient() {
      // No-op for backward compatibility with existing mobile bootstrap code.
    },
    handleSessionChange,
    syncFromRemote: pullFromRemote,
    stopLiveSync,
  };
};
