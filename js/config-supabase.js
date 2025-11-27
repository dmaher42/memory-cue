import { getSupabaseClient, setSupabaseClient } from './supabase-client.js';

window.__SUPABASE_ENV__ = typeof import.meta !== 'undefined' && import.meta ? import.meta.env : undefined;

const supabase = getSupabaseClient();

if (!supabase && typeof window !== 'undefined' && window.supabase) {
  setSupabaseClient(window.supabase);
}
