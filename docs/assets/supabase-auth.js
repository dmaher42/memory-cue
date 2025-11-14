// docs/assets/supabase-auth.js
// Mirrors the browser auth wiring so the static build can load it directly.

window.addEventListener('DOMContentLoaded', () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error('Supabase client not found. Check your URL/key config in index.html.');
    return;
  }

  const authForm = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const signOutBtn = document.getElementById('sign-out-btn');
  const userBadge = document.getElementById('user-badge');
  const userBadgeEmail = document.getElementById('user-badge-email');
  const userBadgeInitial = document.getElementById('user-badge-initial');
  const feedback = document.getElementById('auth-feedback');
  const syncStatus = document.getElementById('sync-status');

  const toggleElementVisibility = (element, shouldShow) => {
    if (!element) return;
    element.classList.toggle('hidden', !shouldShow);
    if (shouldShow) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  };

  if (!authForm) return;

  if (syncStatus && !syncStatus.textContent) {
    syncStatus.textContent = 'Sign in to sync your reminders.';
    syncStatus.classList.remove('online');
    syncStatus.dataset.state = 'offline';
    toggleElementVisibility(syncStatus, true);
  }

  const setFeedback = (msg) => {
    if (!feedback) return;
    feedback.textContent = msg || '';
    toggleElementVisibility(feedback, Boolean(msg));
  };

  if (!authForm._wired) {
    authForm._wired = true;

    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput?.value.trim();
      if (!email) return;
      const { error } = await supabase.auth.signInWithOtp({ email });
      setFeedback(error ? error.message : 'Magic link sent. Check your email.');
    });
  }

  if (signOutBtn && !signOutBtn._wired) {
    signOutBtn._wired = true;
    signOutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
    });
  }

  const applyAuthState = async (user) => {
    toggleElementVisibility(signOutBtn, Boolean(user));
    toggleElementVisibility(authForm, !user);
    toggleElementVisibility(userBadge, Boolean(user));

    if (user) {
      userBadgeEmail && (userBadgeEmail.textContent = user.email || '');
      userBadgeInitial && (userBadgeInitial.textContent = (user.email?.[0] || 'U').toUpperCase());
      if (syncStatus) {
        syncStatus.textContent = `Reminders syncing for ${user.email || 'your account'}.`;
        syncStatus.classList.add('online');
        syncStatus.dataset.state = 'online';
      }
      await supabase.from('profiles').upsert({ id: user.id, email: user.email });
    } else if (syncStatus) {
      syncStatus.textContent = 'Sign in to sync your reminders.';
      syncStatus.classList.remove('online');
      syncStatus.dataset.state = 'offline';
    }

    if (syncStatus) {
      toggleElementVisibility(syncStatus, !user);
    }

    setFeedback('');
  };

  supabase.auth.onAuthStateChange(async (_event, session) => {
    await applyAuthState(session?.user || null);
  });

  supabase.auth
    .getSession()
    .then(({ data }) => applyAuthState(data?.session?.user || null))
    .catch(() => applyAuthState(null));

  (async () => {
    try {
      const { data, error } = await supabase.from('activities').select('*').limit(1);
      console.log('Supabase DB test:', { data, error });
    } catch (err) {
      console.error('Supabase sanity test error:', err);
    }
  })();
});
