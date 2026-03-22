import { getFirebaseContext } from '../src/lib/firebase.js';

let signInPromise = null;
let signOutPromise = null;

const setScopedUserId = (userId) => {
  if (typeof window === 'undefined') {
    return;
  }
  const normalizedUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : '';
  if (normalizedUserId) {
    window.__MEMORY_CUE_AUTH_USER_ID = normalizedUserId;
  } else {
    delete window.__MEMORY_CUE_AUTH_USER_ID;
  }
};

export const startSignInFlow = async () => {
  if (signInPromise) {
    return signInPromise;
  }

  signInPromise = (async () => {
    const firebase = await getFirebaseContext();
    if (!firebase?.auth) {
      return null;
    }

    const provider = new firebase.GoogleAuthProvider();
    const result = await firebase.signInWithPopup(firebase.auth, provider);
    return result?.user || null;
  })();

  try {
    return await signInPromise;
  } finally {
    signInPromise = null;
  }
};

export const startSignOutFlow = async () => {
  if (signOutPromise) {
    return signOutPromise;
  }

  signOutPromise = (async () => {
    const firebase = await getFirebaseContext();
    if (!firebase?.auth) {
      setScopedUserId(null);
      return null;
    }

    await firebase.signOut(firebase.auth);
    setScopedUserId(null);
    return null;
  })();

  try {
    return await signOutPromise;
  } finally {
    signOutPromise = null;
  }
};

export const initAuth = async ({ onSessionChange } = {}) => {
  const firebase = await getFirebaseContext();
  if (!firebase?.auth) {
    setScopedUserId(null);
    if (typeof onSessionChange === 'function') {
      onSessionChange(null, null);
    }
    return { auth: null, unsubscribe: () => {} };
  }

  const unsubscribe = firebase.onAuthStateChanged(firebase.auth, (user) => {
    const normalizedUser = user
      ? { id: user.uid, uid: user.uid, email: user.email || '' }
      : null;
    setScopedUserId(normalizedUser?.id || null);
    if (typeof onSessionChange === 'function') {
      onSessionChange(normalizedUser, user);
    }
  });

  return { auth: firebase.auth, unsubscribe };
};
