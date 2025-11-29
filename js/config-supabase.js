import { getSupabaseClient, setSupabaseClient } from './supabase-client.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Prefer runtime-injected ENV when available
window.__SUPABASE_ENV__ = typeof import.meta !== 'undefined' && import.meta ? import.meta.env : undefined;

// Attempt to reuse any existing client
let supabase = getSupabaseClient();

// If no client exists, create one using the provided publishable key (safe for frontend)
if (!supabase) {
  try {
    const supabaseUrl = 'https://yhfxsbeglqkmovokhiqg.supabase.co';
    const supabaseKey = 'sb-publishable_gcLTekIQ8Wdt9bJAvIczWiQ_xvAzdXvh';
    supabase = createClient(supabaseUrl, supabaseKey);
    setSupabaseClient(supabase);
    if (typeof window !== 'undefined') {
      try { window.supabase = supabase; } catch (e) {}
    }
    console.info('[supabase] Client initialised from config-supabase.js');
  } catch (err) {
    console.error('[supabase] Failed to initialise client in config-supabase.js', err);
  }
} else {
  // If a client was already present, ensure it's exported/registered
  try {
    setSupabaseClient(supabase);
  } catch (e) {}
}

export { supabase };
