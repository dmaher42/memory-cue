import { initSupabaseAuth } from './supabase-auth.js';
import { pullChanges } from '../src/services/supabaseSyncService.js';

initSupabaseAuth({
  onSessionChange: (user) => {
    if (!user) {
      return;
    }
    pullChanges().catch((error) => {
      console.warn('[supabase-sync] Initial pull failed', error);
    });
  },
});
