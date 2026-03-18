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

  const SUPABASE_URL = normalise(window.__ENV?.SUPABASE_URL);

  const SUPABASE_ANON_KEY = normalise(window.__ENV?.SUPABASE_ANON_KEY);

  console.log('ENV URL:', SUPABASE_URL);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[supabase] env not set — running local only');
    return null;
  }

  try {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (typeof window !== 'undefined') {
      window.supabase = cachedClient;
    }
    console.log('[supabase] connected');
  } catch (error) {
    console.error('[supabase] Failed to initialise client.', error);
    cachedClient = null;
  }

  return cachedClient;
}

export function hasSupabaseClient() {
  return Boolean(getSupabaseClient());
}
