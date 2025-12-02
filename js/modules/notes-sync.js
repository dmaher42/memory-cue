import { getSupabaseClient } from '../supabase-client.js';
import {
  createNote,
  loadAllNotes,
  saveAllNotes,
  setRemoteSyncHandler,
} from './notes-storage.js';

const DEFAULT_TABLE_NAME = 'notes';
const DEFAULT_USER_COLUMN = 'user_id';
const DEFAULT_UPDATED_AT_COLUMN = 'updated_at';

const toTimestamp = (value) => {
  if (typeof value !== 'string') {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const mergeNotes = (localNotes = [], remoteNotes = []) => {
  const merged = new Map();

  remoteNotes.forEach((note) => {
    if (note && typeof note.id === 'string') {
      merged.set(note.id, note);
    }
  });

  localNotes.forEach((note) => {
    if (!note || typeof note.id !== 'string') {
      return;
    }
    const existing = merged.get(note.id);
    if (!existing) {
      merged.set(note.id, note);
      return;
    }
    const localTime = toTimestamp(note.updatedAt);
    const remoteTime = toTimestamp(existing.updatedAt);
    if (localTime > remoteTime) {
      merged.set(note.id, note);
    }
  });

  return Array.from(merged.values()).sort((a, b) => toTimestamp(b?.updatedAt) - toTimestamp(a?.updatedAt));
};

  const mapRowToNoteFactory = (updatedAtColumn) => (row) => {
    if (!row || typeof row !== 'object') {
      return null;
    }
    const rawBodyHtml =
      (typeof row.body_html === 'string' && row.body_html.length ? row.body_html : null) ?? row.body;
    const overrides = {
      id: typeof row.id === 'string' && row.id ? row.id : undefined,
      updatedAt: typeof row[updatedAtColumn] === 'string' ? row[updatedAtColumn] : undefined,
      folderId: typeof row.folder_id === 'string' && row.folder_id ? row.folder_id : undefined,
      bodyHtml: rawBodyHtml,
      bodyText: typeof row.body_text === 'string' ? row.body_text : undefined,
    };
  return createNote(row.title, rawBodyHtml, overrides);
  };

export const initNotesSync = (options = {}) => {
  const {
    tableName = DEFAULT_TABLE_NAME,
    userColumn = DEFAULT_USER_COLUMN,
    updatedAtColumn = DEFAULT_UPDATED_AT_COLUMN,
    supabase: suppliedSupabase = null,
  } = options;

  let supabase = suppliedSupabase || null;
  let currentUserId = null;
  let isApplyingRemote = false;
  let lastSyncedIds = new Set();
  let remoteSyncPromise = null;

  const ensureSupabase = () => {
    if (supabase) {
      return supabase;
    }
    supabase = getSupabaseClient();
    return supabase;
  };

  const mapRowToNote = mapRowToNoteFactory(updatedAtColumn);

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

  const syncToRemote = async (notes) => {
    const client = ensureSupabase();
    if (!client || !currentUserId) {
      return;
    }
    const sanitized = Array.isArray(notes)
      ? notes.filter((note) => note && typeof note.id === 'string')
      : [];

      const payload = sanitized.map((note) => ({
      id: note.id,
      [userColumn]: currentUserId,
      title: note.title,
      body: typeof note.bodyHtml === 'string' && note.bodyHtml.length ? note.bodyHtml : note.body,
      body_html: typeof note.bodyHtml === 'string' ? note.bodyHtml : null,
      body_text: typeof note.bodyText === 'string' ? note.bodyText : null,
      folder_id: typeof note.folderId === 'string' && note.folderId ? note.folderId : null,
      [updatedAtColumn]: typeof note.updatedAt === 'string' && note.updatedAt
        ? note.updatedAt
        : new Date().toISOString(),
    }));

    const localIds = new Set(payload.map((item) => item.id));

    if (payload.length) {
      const { error } = await client.from(tableName).upsert(payload);
      if (error) {
        throw error;
      }
    }

    const idsToDelete = [...lastSyncedIds].filter((id) => id && !localIds.has(id));
    if (idsToDelete.length) {
      const { error } = await client
        .from(tableName)
        .delete()
        .in('id', idsToDelete)
        .eq(userColumn, currentUserId);
      if (error) {
        throw error;
      }
    }

    lastSyncedIds = new Set(localIds);
  };

  const pullFromRemote = async () => {
    const client = ensureSupabase();
    if (!client || !currentUserId) {
      return;
    }

    try {
      const { data, error } = await client
        .from(tableName)
        .select(`id,title,body,body_html,body_text,folder_id,${updatedAtColumn}`)
        .eq(userColumn, currentUserId);
      if (error) {
        throw error;
      }

      const rows = Array.isArray(data) ? data : [];
      lastSyncedIds = new Set(rows.map((row) => (typeof row.id === 'string' ? row.id : null)).filter(Boolean));
      const remoteNotes = rows.map(mapRowToNote).filter(Boolean);
      const localNotes = loadAllNotes();

      if (!remoteNotes.length) {
        if (localNotes.length) {
          try {
            await syncToRemote(localNotes);
          } catch (syncError) {
            console.error('[notes-sync] Failed to upload local notes to Supabase.', syncError);
          }
        }
        return;
      }

      const merged = mergeNotes(localNotes, remoteNotes);

      isApplyingRemote = true;
      const saved = saveAllNotes(merged, { skipRemoteSync: true });
      isApplyingRemote = false;

      if (!saved) {
        console.warn('[notes-sync] Unable to cache notes locally after remote sync.');
      }

      try {
        await syncToRemote(merged);
      } catch (syncError) {
        console.error('[notes-sync] Failed to reconcile notes with Supabase.', syncError);
      }
    } catch (error) {
      console.error('[notes-sync] Failed to fetch notes from Supabase.', error);
    } finally {
      isApplyingRemote = false;
    }
  };

  setRemoteSyncHandler(async (notes) => {
    if (isApplyingRemote) {
      return;
    }
    try {
      await syncToRemote(notes);
    } catch (error) {
      console.error('[notes-sync] Failed to sync notes to Supabase.', error);
    }
  });

  const handleSessionChange = async (user) => {
    currentUserId = typeof user?.id === 'string' ? user.id : null;
    if (!currentUserId) {
      lastSyncedIds = new Set();
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
    setSupabaseClient(client) {
      if (client) {
        supabase = client;
      }
    },
    handleSessionChange,
    syncFromRemote: pullFromRemote,
  };
};
