import { ENV } from './env.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

window.__SUPABASE_ENV__ = typeof import.meta !== 'undefined' && import.meta ? import.meta.env : undefined;

const supabaseUrl = ENV.SUPABASE_URL;
const supabaseAnonKey = ENV.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
} else {
  window.supabase = createClient(supabaseUrl, supabaseAnonKey);

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    console.info('[supabase] Client initialised for project:', projectRef);
  } catch (error) {
    console.info('[supabase] Client initialised.');
  }
}
