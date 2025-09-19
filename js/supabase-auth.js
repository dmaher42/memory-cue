// js/supabase-auth.js
// Uses the global window.supabase that you already create in index.html

window.addEventListener('DOMContentLoaded', () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error('Supabase client not found. Check your URL/key config in index.html.');
    return;
  }

  // ---- Elements ----
  const authForm = document.getElementById('auth-form');
  const emailInput = document.getElementById('auth-email');
  const signOutBtn = document.getElementById('sign-out-btn');
  const userBadge = document.getElementById('user-badge');
  const userBadgeEmail = document.getElementById('user-badge-email');
  const userBadgeInitial = document.getElementById('user-badge-initial');
  const feedback = document.getElementById('auth-feedback');

  // If the page doesn't have the auth UI, bail quietly
  if (!authForm) return;

  const setFeedback = (msg) => {
    if (!feedback) return;
    feedback.textContent = msg || '';
    feedback.classList.toggle('hidden', !msg);
  };

  // Prevent double-binding if this file is included twice
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

  // Session/UI sync
  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;

    signOutBtn?.classList.toggle('hidden', !user);
    authForm?.classList.toggle('hidden', !!user);
    userBadge?.classList.toggle('hidden', !user);

    if (user) {
      userBadgeEmail && (userBadgeEmail.textContent = user.email || '');
      userBadgeInitial && (userBadgeInitial.textContent = (user.email?.[0] || 'U').toUpperCase());
      await supabase.from('profiles').upsert({ id: user.id, email: user.email });
    }

    setFeedback('');
  });

  // Optional: quick sanity test in console
  (async () => {
    try {
      const { data, error } = await supabase.from('activities').select('*').limit(1);
      console.log('Supabase DB test:', { data, error });
    } catch (err) {
      console.error('Supabase sanity test error:', err);
    }
  })();
});
