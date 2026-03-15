// Module-level external auth context (populated by callers such as reminders.js)
let _externalAuthContext = {
  authReady: false,
  auth: null,
  GoogleAuthProvider: null,
  signInWithPopup: null,
  signInWithRedirect: null,
  getRedirectResult: null,
  signOut: null,
  toast: null,
  onAuthStateChanged: null,
};

/**
 * Allow other modules to supply a small auth context (handlers + helpers).
 * Defensive: merges values and tolerates invalid input.
 */
export function setAuthContext(ctx = {}) {
  try {
    Object.assign(_externalAuthContext, ctx || {});
  } catch (err) {
    // non-fatal; keep module usable even if callers pass odd values
    // eslint-disable-next-line no-console
    console.warn('[auth] setAuthContext failed', err);
  }
}

/**
 * Start a sign-in flow via Firebase popup auth.
 * Uses Firebase auth handlers supplied via setAuthContext.
 * Resolves null when no auth facilities are available.
 */
export async function startSignInFlow() {
  try {
    if (
      _externalAuthContext &&
      _externalAuthContext.auth &&
      typeof _externalAuthContext.GoogleAuthProvider === 'function' &&
      typeof _externalAuthContext.signInWithPopup === 'function'
    ) {
      const provider = new _externalAuthContext.GoogleAuthProvider();
      // eslint-disable-next-line no-console
      console.log('[auth] popup login attempt');
      try {
        return await _externalAuthContext.signInWithPopup(_externalAuthContext.auth, provider);
      } catch (error) {
        const popupErrorCode = error?.code;
        const shouldFallbackToRedirect = (
          popupErrorCode === 'auth/popup-blocked'
          || popupErrorCode === 'auth/popup-closed-by-user'
          || popupErrorCode === 'auth/cancelled-popup-request'
        );

        if (
          shouldFallbackToRedirect
          && typeof _externalAuthContext.signInWithRedirect === 'function'
        ) {
          // eslint-disable-next-line no-console
          console.log('[auth] redirect fallback triggered');
          return _externalAuthContext.signInWithRedirect(_externalAuthContext.auth, provider);
        }

        throw error;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] startSignInFlow error', err);
    try {
      _externalAuthContext?.toast?.('Sign-in failed');
    } catch (toastErr) {
      // eslint-disable-next-line no-console
      console.warn('[auth] toast handler failed', toastErr);
    }
    throw err;
  }
  return Promise.resolve(null);
}

/**
 * Start sign-out flow using the supplied Firebase signOut handler.
 */
export async function startSignOutFlow() {
  try {
    if (_externalAuthContext && typeof _externalAuthContext.signOut === 'function') {
      return _externalAuthContext.signOut(_externalAuthContext.auth);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] startSignOutFlow error', err);
    throw err;
  }
  return Promise.resolve(null);
}

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
    auth: suppliedAuth,
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

  const auth = suppliedAuth || _externalAuthContext?.auth || null;

  if (auth && typeof _externalAuthContext?.getRedirectResult === 'function') {
    _externalAuthContext.getRedirectResult(auth).catch((error) => {
      console.warn('[auth] Redirect sign-in result handling failed.', error);
    });
  }

  if (!disableButtonBinding) {
    bindSignInButtons(elements);
    bindSignOutButtons(elements);
  }

  const cleanupFns = [];

  if (!auth || typeof _externalAuthContext?.onAuthStateChanged !== 'function') {
    return {
      auth: null,
      elements,
      applyAuthState: (state) => applyAuthState(elements, { ...state, messages }),
      destroy() {},
    };
  }

  const unsubscribe = _externalAuthContext.onAuthStateChanged(auth, (user) => {
    applyAuthState(elements, { user: user ?? null, messages });
    if (typeof onSessionChange === 'function') {
      try {
        onSessionChange(user ?? null, user ? { user } : null);
      } catch (error) {
        console.error('[auth] onSessionChange handler failed.', error);
      }
    }
  });

  if (typeof unsubscribe === 'function') {
    cleanupFns.push(() => {
      try {
        unsubscribe();
      } catch {
        /* noop */
      }
    });
  }

  applyAuthState(elements, { user: auth.currentUser ?? null, messages });

  return {
    auth,
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
