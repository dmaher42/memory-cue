import { initFirebaseAuth } from './supabase-auth.js';
import { pullChanges } from '../src/services/supabaseSyncService.js';

initFirebaseAuth({
  onSessionChange: (user) => {
    if (!user) {
      return;
    }
    pullChanges().catch((error) => {
      console.warn('[supabase-sync] Initial pull failed', error);
    });
  },
});
