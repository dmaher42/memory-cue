import { getSupabaseClient } from './supabase-client.js';

let _externalAuthContext = {
  authReady: false,
  auth: null,
  supabase: null,
  toast: null,
};

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
  feedback: ['#auth-feedback-header', '#auth-feedback-rail'],
};

const DEFAULT_MESSAGES = {
  signedOut: '',
  signedIn: (user) => `Reminders syncing for ${user?.email || 'your account'}.`,
  syncStatusText: {
    signedOut: 'Offline',
    signedIn: 'Online',
  },
};

export function setAuthContext(ctx = {}) {
  try {
    Object.assign(_externalAuthContext, ctx || {});
  } catch (err) {
    console.warn('[auth] setAuthContext failed', err);
  }
}

const setScopedUserId = (user) => {
  if (typeof window === 'undefined') {
    return null;
  }
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  window.__MEMORY_CUE_AUTH_USER_ID = userId;
  return userId || null;
};

const normalizeSupabaseUser = (user) => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const id = typeof user.id === 'string' ? user.id.trim() : '';
  if (!id) {
    return null;
  }

  return {
    ...user,
    id,
    uid: id,
    email: typeof user.email === 'string' ? user.email : '',
  };
};

const getSupabase = () => _externalAuthContext.supabase || getSupabaseClient();

export async function startSignInFlow() {
  const supabase = getSupabase();
  if (!supabase?.auth?.signInWithOAuth) {
    return null;
  }

  const redirectTo = typeof window !== 'undefined' ? window.location.href : undefined;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (error) {
    console.error('[auth] startSignInFlow error', error);
    _externalAuthContext?.toast?.('Sign-in failed');
    throw error;
  }

  return data || null;
}

export async function startSignOutFlow() {
  const supabase = getSupabase();
  if (!supabase?.auth?.signOut) {
    return null;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('[auth] startSignOutFlow error', error);
    throw error;
  }

  setScopedUserId(null);
  return null;
}

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
  const selectors = toArray(selectorValue).filter((selector) => typeof selector === 'string' && selector);
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
  const shouldShowSyncStatus = !isSignedIn;

  if (elements.syncStatusEls.length) {
    setTextContent(elements.syncStatusEls, statusMessage);
    elements.syncStatusEls.forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      element.classList.toggle('online', isSignedIn);
      element.dataset.state = isSignedIn ? 'online' : 'offline';
    });
    toggleElements(elements.syncStatusEls, shouldShowSyncStatus);
  }

  const syncStatusText = isSignedIn
    ? resolvedMessages.syncStatusText?.signedIn
    : resolvedMessages.syncStatusText?.signedOut;
  setTextContent(elements.syncStatusTextEls, syncStatusText || '');
  updateStatusIndicators(elements.statusIndicatorEls, isSignedIn ? 'online' : 'offline');

  setFeedback(elements.feedbackEls, '');
}

function bindSignInButtons(elements) {
  elements.signInButtons.forEach((button) => {
    if (!(button instanceof HTMLElement) || button.dataset.authBound === 'true') {
      return;
    }

    button.dataset.authBound = 'true';
    button.addEventListener('click', async () => {
      try {
        await startSignInFlow();
      } catch (error) {
        console.error('[auth] Sign-in failed.', error);
      }
    });
  });
}

function bindSignOutButtons(elements) {
  elements.signOutButtons.forEach((button) => {
    if (!(button instanceof HTMLElement) || button.dataset.authBound === 'true') {
      return;
    }

    button.dataset.authBound = 'true';
    button.addEventListener('click', async () => {
      try {
        await startSignOutFlow();
      } catch (error) {
        console.error('[auth] Sign-out failed.', error);
      }
    });
  });
}

export function initSupabaseAuth(options = {}) {
  const {
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
  const supabase = getSupabase();

  setAuthContext({
    ..._externalAuthContext,
    authReady: Boolean(supabase?.auth),
    auth: supabase?.auth || null,
    supabase,
  });

  applyAuthState(elements, { user: null, messages });

  if (!disableButtonBinding) {
    bindSignInButtons(elements);
    bindSignOutButtons(elements);
  }

  if (!supabase?.auth) {
    return {
      auth: null,
      supabase: null,
      elements,
      applyAuthState: (state) => applyAuthState(elements, { ...state, messages }),
      destroy() {},
    };
  }

  const handleSession = async (session) => {
    const normalizedUser = normalizeSupabaseUser(session?.user || null);
    setScopedUserId(normalizedUser);
    applyAuthState(elements, { user: normalizedUser, messages });
    if (typeof onSessionChange === 'function') {
      try {
        onSessionChange(normalizedUser, session || null);
      } catch (error) {
        console.error('[auth] onSessionChange handler failed.', error);
      }
    }
  };

  void supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.warn('[auth] Failed to read current session.', error);
      return;
    }
    return handleSession(data?.session || null);
  });

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    void handleSession(session || null);
  });

  return {
    auth: supabase.auth,
    supabase,
    elements,
    applyAuthState: (state) => applyAuthState(elements, { ...state, messages }),
    destroy() {
      try {
        data?.subscription?.unsubscribe?.();
      } catch {
        /* noop */
      }
    },
  };
}

export const initFirebaseAuth = initSupabaseAuth;
export { DEFAULT_SELECTORS as SUPABASE_AUTH_DEFAULT_SELECTORS };
export { DEFAULT_MESSAGES as SUPABASE_AUTH_DEFAULT_MESSAGES };
export function getSupabaseAuthElements(selectors = {}, scope = document) {
  return collectAuthElements({
    ...DEFAULT_SELECTORS,
    ...selectors,
  }, scope);
}
export const getFirebaseAuthElements = getSupabaseAuthElements;
