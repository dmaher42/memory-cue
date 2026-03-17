import { ENV } from './env.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let cachedClient = null;
let attemptedInitialisation = false;

function normalise(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function setSupabaseClient(client) {
  if (client) {
    cachedClient = client;
    attemptedInitialisation = true;
  }
  return cachedClient;
}

export function getSupabaseClient() {
  if (cachedClient) {
    return cachedClient;
  }

  if (!attemptedInitialisation && typeof window !== 'undefined' && window.supabase) {
    return setSupabaseClient(window.supabase);
  }

  attemptedInitialisation = true;

  const supabaseUrl = normalise(
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined) ||
      ENV?.SUPABASE_URL,
  );
  const supabaseAnonKey = normalise(
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_ANON_KEY : undefined) ||
      ENV?.SUPABASE_ANON_KEY,
  );

  console.log('ENV URL:', typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : undefined);

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[supabase] env not set — running local only');
    return null;
  }

  try {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey);
    if (typeof window !== 'undefined') {
      window.supabase = cachedClient;
    }
    console.log('[supabase] active');
  } catch (error) {
    console.error('[supabase] Failed to initialise client.', error);
    cachedClient = null;
  }

  return cachedClient;
}

export function hasSupabaseClient() {
  return Boolean(getSupabaseClient());
}
