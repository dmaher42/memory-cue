if (typeof window !== 'undefined') {
  const env = (window.__ENV = window.__ENV || {});
  // Set the Supabase project URL and anon key. These defaults were
  // provided for local/dev convenience and are committed per user request.
  env.SUPABASE_URL = env.SUPABASE_URL || 'https://yhfxsbeglqkmovokhiqg.supabase.co';
  env.SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || 'sb_publishable_gclEkIQ8Wdt9bJAvIcZWiQ_xvAzdXVh';
}
