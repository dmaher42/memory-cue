// js/supabase-auth.js
// Provides shared authentication helpers for Memory Cue.

const EMPTY_AUTH_CONTEXT = Object.freeze({
  authReady: false,
  auth: null,
  GoogleAuthProvider: null,
  signInWithPopup: null,
  signInWithRedirect: null,
  signOut: null,
  toast: null,
});

let authContext = { ...EMPTY_AUTH_CONTEXT };

function getToast() {
  return typeof authContext.toast === 'function' ? authContext.toast : null;
}

function warnAuthNotReady(message) {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(message);
  }
}

export function setAuthContext(context = {}) {
  authContext = { ...EMPTY_AUTH_CONTEXT, ...context };
}

export function clearAuthContext() {
  authContext = { ...EMPTY_AUTH_CONTEXT };
}

export async function startSignInFlow() {
  const toast = getToast();
  if (!authContext || typeof authContext !== 'object') {
    warnAuthNotReady('Authentication context is not configured.');
    throw new Error('Authentication context unavailable');
  }

  const {
    authReady,
    auth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
  } = authContext;

  if (!authReady || typeof GoogleAuthProvider !== 'function' ||
      typeof signInWithPopup !== 'function' || typeof signInWithRedirect !== 'function') {
    toast?.('Sign-in unavailable offline');
    warnAuthNotReady('Attempted sign-in before Firebase auth was ready.');
    return;
  }

  const provider = new GoogleAuthProvider();

  try {
    await signInWithPopup(auth, provider);
  } catch (popupError) {
    try {
      await signInWithRedirect(auth, provider);
    } catch (redirectError) {
      toast?.('Google sign-in failed');
      warnAuthNotReady('Google sign-in failed via popup and redirect.');
    }
  }
}

export async function startSignOutFlow() {
  const toast = getToast();
  if (!authContext || typeof authContext !== 'object') {
    warnAuthNotReady('Authentication context is not configured.');
    throw new Error('Authentication context unavailable');
  }

  const { authReady, auth, signOut } = authContext;

  if (!authReady || typeof signOut !== 'function') {
    toast?.('Sign-out unavailable offline');
    warnAuthNotReady('Attempted sign-out before Firebase auth was ready.');
    return;
  }

  try {
    await signOut(auth);
    toast?.('Signed out');
  } catch (error) {
    toast?.('Sign-out failed');
    if (typeof console !== 'undefined' && console.error) {
      console.error('Sign-out failed:', error);
    }
  }
}

function initSupabaseAuthUi() {
  if (typeof window === 'undefined') {
    return;
  }

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
    syncStatus.textContent = 'Sign in to sync reminders across devices.';
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

  supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user || null;

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
      syncStatus.textContent = 'Sign in to sync reminders across devices.';
      syncStatus.classList.remove('online');
      syncStatus.dataset.state = 'offline';
    }

    if (syncStatus) {
      toggleElementVisibility(syncStatus, true);
    }

    setFeedback('');
  });

  (async () => {
    try {
      const { data, error } = await supabase.from('activities').select('*').limit(1);
      console.log('Supabase DB test:', { data, error });
    } catch (err) {
      console.error('Supabase sanity test error:', err);
    }
  })();
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initSupabaseAuthUi, { once: true });
}
