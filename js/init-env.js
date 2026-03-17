if (typeof window !== 'undefined') {
  window.__ENV = {
    ...(window.__ENV || {}),
    SUPABASE_URL: window.__ENV?.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: window.__ENV?.SUPABASE_ANON_KEY || '',
  };

  console.log('[ENV INIT]', window.__ENV);
}
