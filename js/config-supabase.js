import { ENV } from './env.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

window.__SUPABASE_ENV__ = typeof import.meta !== 'undefined' && import.meta ? import.meta.env : undefined;
window.supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
