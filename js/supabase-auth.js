import { getSupabaseClient } from './supabase-client.js';

const DEFAULT_SELECTORS = {
  authForm: '#auth-form',
  emailInput: '#auth-email',
  signInButtons: null,
  signOutButtons: '#sign-out-btn',
  userBadge: '#user-badge',
  userBadgeEmail: '#user-badge-email',
  userBadgeInitial: '#user-badge-initial',
  userName: '#googleUserName',
  syncStatus: '#sync-status',
  syncStatusText: null,
  statusIndicator: null,
  feedback: '#auth-feedback',
};

const DEFAULT_MESSAGES = {
  signedOut: 'Sign in to sync reminders across devices.',
  signedIn: (user) => `Reminders syncing for ${user?.email || 'your account'}.`,
  syncStatusText: {
    signedOut: 'Offline',
    signedIn: 'Online',
  },
};

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueElements(elements) {
  return Array.from(
    new Set(
      elements.filter(
        (element) => element instanceof HTMLElement || (typeof SVGElement !== 'undefined' && element instanceof SVGElement)
      )
    )
  );
}

function queryAll(root, selectorValue) {
  const selectors = toArray(selectorValue).filter(Boolean);
  if (!selectors.length) {
    return [];
  }
  const nodes = selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
  return uniqueElements(nodes);
}

function collectAuthElements(selectors, root = document) {
  const scope = root instanceof Document || root instanceof HTMLElement ? root : document;
  return {
    authForms: queryAll(scope, selectors.authForm),
    emailInputs: queryAll(scope, selectors.emailInput),
    signInButtons: queryAll(scope, selectors.signInButtons),
    signOutButtons: queryAll(scope, selectors.signOutButtons),
    userBadges: queryAll(scope, selectors.userBadge),
    userBadgeEmails: queryAll(scope, selectors.userBadgeEmail),
    userBadgeInitials: queryAll(scope, selectors.userBadgeInitial),
    userNameEls: queryAll(scope, selectors.userName),
    syncStatusEls: queryAll(scope, selectors.syncStatus),
    syncStatusTextEls: queryAll(scope, selectors.syncStatusText),
    statusIndicatorEls: queryAll(scope, selectors.statusIndicator),
    feedbackEls: queryAll(scope, selectors.feedback),
  };
}

function toggleElements(elements, shouldShow) {
  uniqueElements(Array.isArray(elements) ? elements : [elements]).forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    element.classList.toggle('hidden', !shouldShow);
    if (shouldShow) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  });
}

function setTextContent(elements, text) {
  uniqueElements(Array.isArray(elements) ? elements : [elements]).forEach((element) => {
    if (element instanceof HTMLElement) {
      element.textContent = text || '';
    }
  });
}

function updateStatusIndicators(elements, state) {
  uniqueElements(elements).forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    element.dataset.state = state;
    element.classList.toggle('online', state === 'online');
    element.classList.toggle('offline', state !== 'online');
  });
}

function setFeedback(elements, message) {
  uniqueElements(elements).forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    element.textContent = message || '';
    const shouldShow = Boolean(message);
    element.classList.toggle('hidden', !shouldShow);
    if (shouldShow) {
      element.removeAttribute('hidden');
    } else {
      element.setAttribute('hidden', '');
    }
  });
}

function resolveMessages(messages = {}) {
  const syncStatusText = {
    ...DEFAULT_MESSAGES.syncStatusText,
    ...(messages.syncStatusText || {}),
  };
  return {
    ...DEFAULT_MESSAGES,
    ...messages,
    syncStatusText,
  };
}

export function applyAuthState(elements, { user, messages } = {}) {
  const resolvedMessages = resolveMessages(messages);
  const isSignedIn = Boolean(user);

  toggleElements(elements.signInButtons, !isSignedIn);
  toggleElements(elements.authForms, !isSignedIn);
  toggleElements(elements.signOutButtons, isSignedIn);
  toggleElements(elements.userBadges, isSignedIn);

  const email = typeof user?.email === 'string' ? user.email : '';
  const initial = email ? email.charAt(0).toUpperCase() : 'U';

  if (isSignedIn) {
    setTextContent(elements.userBadgeEmails, email);
    setTextContent(elements.userBadgeInitials, initial);
    setTextContent(elements.userNameEls, email);
  } else {
    setTextContent(elements.userBadgeEmails, '');
    setTextContent(elements.userBadgeInitials, '');
    setTextContent(elements.userNameEls, '');
  }

  const signedInMessage = typeof resolvedMessages.signedIn === 'function'
    ? resolvedMessages.signedIn(user)
    : resolvedMessages.signedIn;
  const signedOutMessage = typeof resolvedMessages.signedOut === 'function'
    ? resolvedMessages.signedOut(user)
    : resolvedMessages.signedOut;
  const statusMessage = isSignedIn ? signedInMessage : signedOutMessage;

  if (elements.syncStatusEls.length) {
    toggleElements(elements.syncStatusEls, true);
    setTextContent(elements.syncStatusEls, statusMessage);
    elements.syncStatusEls.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      element.classList.toggle('online', isSignedIn);
      element.dataset.state = isSignedIn ? 'online' : 'offline';
    });
  }

  const syncStatusText = isSignedIn
    ? resolvedMessages.syncStatusText?.signedIn
    : resolvedMessages.syncStatusText?.signedOut;
  setTextContent(elements.syncStatusTextEls, syncStatusText || '');
  updateStatusIndicators(elements.statusIndicatorEls, isSignedIn ? 'online' : 'offline');

  setFeedback(elements.feedbackEls, '');
}

function bindAuthForms(supabase, elements) {
  elements.authForms.forEach((form) => {
    if (!(form instanceof HTMLFormElement) || form.dataset.supabaseAuthBound === 'true') {
      return;
    }

    form.dataset.supabaseAuthBound = 'true';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const emailInput = elements.emailInputs.find((input) => form.contains(input))
        || form.querySelector('input[type="email"]');
      const email = typeof emailInput?.value === 'string' ? emailInput.value.trim() : '';

      if (!email) {
        setFeedback(elements.feedbackEls, 'Enter an email address to continue.');
        return;
      }

      try {
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) {
          setFeedback(elements.feedbackEls, error.message || 'Unable to send magic link.');
        } else {
          setFeedback(elements.feedbackEls, 'Magic link sent. Check your email.');
        }
      } catch (error) {
        setFeedback(elements.feedbackEls, error?.message || 'Unable to send magic link.');
      }
    });
  });
}

function bindSignOutButtons(supabase, elements) {
  elements.signOutButtons.forEach((button) => {
    if (!(button instanceof HTMLElement) || button.dataset.supabaseAuthBound === 'true') {
      return;
    }

    button.dataset.supabaseAuthBound = 'true';

    button.addEventListener('click', async () => {
      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.error('[supabase] Sign-out failed.', error);
      }
    });
  });
}

export function initSupabaseAuth(options = {}) {
  const {
    supabase: suppliedSupabase,
    scope = document,
    selectors: selectorOverrides = {},
    messages: messageOverrides = {},
    disableButtonBinding = false,
    onSessionChange,
  } = options;

  const selectors = {
    ...DEFAULT_SELECTORS,
    ...selectorOverrides,
  };

  const elements = collectAuthElements(selectors, scope);
  const messages = resolveMessages(messageOverrides);

  applyAuthState(elements, { user: null, messages });

  const supabase = suppliedSupabase
    || getSupabaseClient()
    || (typeof window !== 'undefined' ? window.supabase : null);

  if (!supabase) {
    return {
      supabase: null,
      elements,
      applyAuthState: (state) => applyAuthState(elements, { ...state, messages }),
      destroy() {},
    };
  }

  bindAuthForms(supabase, elements);
  if (!disableButtonBinding) {
    bindSignOutButtons(supabase, elements);
  }

  const cleanupFns = [];

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    applyAuthState(elements, { user: session?.user ?? null, messages });
    if (typeof onSessionChange === 'function') {
      try {
        onSessionChange(session?.user ?? null, session);
      } catch (error) {
        console.error('[supabase] onSessionChange handler failed.', error);
      }
    }
  });

  if (data?.subscription) {
    cleanupFns.push(() => {
      try {
        data.subscription.unsubscribe();
      } catch {
        /* noop */
      }
    });
  }

  supabase.auth
    .getSession()
    .then(({ data: sessionData, error }) => {
      if (!error) {
        applyAuthState(elements, { user: sessionData?.session?.user ?? null, messages });
      }
    })
    .catch((error) => {
      console.error('[supabase] getSession failed.', error);
    });

  return {
    supabase,
    elements,
    applyAuthState: (state) => applyAuthState(elements, { ...state, messages }),
    destroy() {
      cleanupFns.forEach((fn) => {
        try {
          fn();
        } catch {
          /* noop */
        }
      });
    },
  };
}

export { DEFAULT_SELECTORS as SUPABASE_AUTH_DEFAULT_SELECTORS };
export { DEFAULT_MESSAGES as SUPABASE_AUTH_DEFAULT_MESSAGES };
export function getSupabaseAuthElements(selectors = {}, scope = document) {
  return collectAuthElements({
    ...DEFAULT_SELECTORS,
    ...selectors,
  }, scope);
}

// Provide a minimal auth context and sign-in/out helpers for other modules
// (reminders.js and app.js expect these exports).
let __supabaseAuthContext = {};

export function setAuthContext(ctx = {}) {
  try {
    __supabaseAuthContext = { ...__supabaseAuthContext, ...ctx };
  } catch {
    __supabaseAuthContext = ctx;
  }
  return __supabaseAuthContext;
}

function getRuntimeSupabase() {
  try {
    const client = (typeof getSupabaseClient === 'function' && getSupabaseClient()) || (typeof window !== 'undefined' ? window.supabase : null);
    return client || null;
  } catch {
    return typeof window !== 'undefined' ? window.supabase : null;
  }
}

export async function startSignInFlow() {
  const supabase = getRuntimeSupabase();
  if (!supabase || !supabase.auth) {
    throw new Error('Supabase client unavailable for sign-in');
  }

  try {
    if (typeof supabase.auth.signInWithOAuth === 'function') {
      return await supabase.auth.signInWithOAuth({ provider: 'google' });
    }
    if (typeof supabase.auth.signIn === 'function') {
      return await supabase.auth.signIn({ provider: 'google' });
    }
    throw new Error('Supabase auth sign-in API not available');
  } catch (err) {
    console.error('[supabase] startSignInFlow failed', err);
    throw err;
  }
}

export async function startSignOutFlow() {
  const supabase = getRuntimeSupabase();
  if (!supabase || !supabase.auth) {
    return;
  }
  try {
    if (typeof supabase.auth.signOut === 'function') {
      return await supabase.auth.signOut();
    }
  } catch (err) {
    console.error('[supabase] startSignOutFlow failed', err);
    throw err;
  }
}
