import { getSupabaseClient, setSupabaseClient } from './supabase-client.js';

window.__SUPABASE_ENV__ = typeof import.meta !== 'undefined' && import.meta ? import.meta.env : undefined;

const supabase = getSupabaseClient();

if (!supabase && typeof window !== 'undefined' && window.supabase) {
  setSupabaseClient(window.supabase);
}

if (supabase) {
  const debugWriteKey = '__memoryCueSupabaseDebugWrite';
  const hasWrittenDebugEntry = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(debugWriteKey) === 'done';
  if (!hasWrittenDebugEntry) {
    supabase
      .from('reminders')
      .insert({
        id: crypto.randomUUID(),
        user_id: 'debug-user',
        title: 'Supabase connection working',
        created_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) {
          console.warn('[supabase] debug reminder insert failed', error);
          return;
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(debugWriteKey, 'done');
        }
        console.log('[supabase] debug reminder insert succeeded');
      });
  }
}
