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

  const supabaseUrl = normalise(ENV?.SUPABASE_URL);
  const supabaseAnonKey = normalise(ENV?.SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
    return null;
  }

  try {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey);
    if (typeof window !== 'undefined') {
      window.supabase = cachedClient;
    }
    try {
      const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
      console.info('[supabase] Client initialised for project:', projectRef);
    } catch {
      console.info('[supabase] Client initialised.');
    }
  } catch (error) {
    console.error('[supabase] Failed to initialise client.', error);
    cachedClient = null;
  }

  return cachedClient;
}

export function hasSupabaseClient() {
  return Boolean(getSupabaseClient());
}
