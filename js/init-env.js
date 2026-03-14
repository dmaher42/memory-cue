if (typeof window !== 'undefined') {
  const env = (window.__ENV = window.__ENV || {});
  env.SUPABASE_URL = env.SUPABASE_URL || '';
  env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
}
