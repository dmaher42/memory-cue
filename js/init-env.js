if (typeof window !== 'undefined') {
  const env = window.__ENV || {};

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn('[ENV INIT] Missing Supabase env values.', {
      hasSupabaseUrl: Boolean(env.SUPABASE_URL),
      hasSupabaseAnonKey: Boolean(env.SUPABASE_ANON_KEY)
    });
  }

  console.log('[ENV INIT]', env);
}
