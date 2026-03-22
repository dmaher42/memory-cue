const FIREBASE_MODULE_BASE = 'https://www.gstatic.com/firebasejs/10.14.1';

let firebaseContextPromise = null;

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');

const readFirebaseConfig = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const env = window.__ENV || {};
  const config = {
    apiKey: normalize(env.FIREBASE_API_KEY),
    authDomain: normalize(env.FIREBASE_AUTH_DOMAIN),
    projectId: normalize(env.FIREBASE_PROJECT_ID),
    storageBucket: normalize(env.FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalize(env.FIREBASE_MESSAGING_SENDER_ID),
    appId: normalize(env.FIREBASE_APP_ID),
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return null;
  }

  return config;
};

export const getFirebaseContext = async () => {
  if (!firebaseContextPromise) {
    firebaseContextPromise = (async () => {
      const config = readFirebaseConfig();
      if (!config) {
        console.warn('[firebase] Missing Firebase env values; auth and Firestore are disabled.');
        return null;
      }

      const [{ initializeApp, getApps, getApp }, authModule, firestoreModule] = await Promise.all([
        import(`${FIREBASE_MODULE_BASE}/firebase-app.js`),
        import(`${FIREBASE_MODULE_BASE}/firebase-auth.js`),
        import(`${FIREBASE_MODULE_BASE}/firebase-firestore.js`),
      ]);

      const appAlreadyInitialized = getApps().length > 0;
      const app = appAlreadyInitialized ? getApp() : initializeApp(config);
      const db = appAlreadyInitialized
        ? firestoreModule.getFirestore(app)
        : firestoreModule.initializeFirestore(app, {
            experimentalAutoDetectLongPolling: true,
            experimentalLongPollingOptions: {
              timeoutSeconds: 25,
            },
          });

      return {
        app,
        auth: authModule.getAuth(app),
        db,
        GoogleAuthProvider: authModule.GoogleAuthProvider,
        signInWithPopup: authModule.signInWithPopup,
        signOut: authModule.signOut,
        onAuthStateChanged: authModule.onAuthStateChanged,
        collection: firestoreModule.collection,
        doc: firestoreModule.doc,
        getDocs: firestoreModule.getDocs,
        setDoc: firestoreModule.setDoc,
        deleteDoc: firestoreModule.deleteDoc,
        onSnapshot: firestoreModule.onSnapshot,
        query: firestoreModule.query,
        orderBy: firestoreModule.orderBy,
      };
    })().catch((error) => {
      firebaseContextPromise = null;
      console.error('[firebase] Failed to initialise Firebase.', error);
      return null;
    });
  }

  return firebaseContextPromise;
};

export const requireUid = (uid) => {
  const normalizedUid = normalize(uid);
  if (!normalizedUid) {
    throw new Error('User not authenticated');
  }
  return normalizedUid;
};
