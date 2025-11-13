(() => {
  const script = document.currentScript;
  const dataset = script?.dataset ?? {};
  const supabaseUrl = dataset.supabaseUrl?.trim();
  const supabaseAnonKey = dataset.supabaseAnonKey?.trim();

  const globalEnv = (window.__ENV = window.__ENV || {});

  if (supabaseUrl) {
    globalEnv.SUPABASE_URL = supabaseUrl;
  }

  if (supabaseAnonKey) {
    globalEnv.SUPABASE_ANON_KEY = supabaseAnonKey;
  }
})();
