/* firebase-init.js */
const FALLBACK_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyB8n0PCndJgHnU_i5y4PiFv8zn2eA1New0',
  authDomain: 'memory-cue-pro.firebaseapp.com',
  projectId: 'memory-cue-pro',
  storageBucket: 'memory-cue-pro.firebasestorage.app',
  messagingSenderId: '494760962301',
  appId: '1:494760962301:web:52c0fe3567f0c8f8b9e5e6',
  measurementId: 'G-1H4CPRO123'
});

const scope = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined' ? window : {});

let firebaseConfig = null;

if (scope?.memoryCueFirebase?.getFirebaseConfig) {
  firebaseConfig = scope.memoryCueFirebase.getFirebaseConfig();
} else if (typeof require === 'function') {
  try {
    const moduleValue = require('./firebase-config.js');
    const getter = typeof moduleValue?.getFirebaseConfig === 'function'
      ? moduleValue.getFirebaseConfig
      : typeof moduleValue?.default?.getFirebaseConfig === 'function'
        ? moduleValue.default.getFirebaseConfig
        : null;
    if (getter) {
      firebaseConfig = getter();
    }
  } catch {
    // ignore – likely executed in browser without require support
  }
}

if (!firebaseConfig && scope?.memoryCueFirebase?.DEFAULT_FIREBASE_CONFIG) {
  firebaseConfig = { ...scope.memoryCueFirebase.DEFAULT_FIREBASE_CONFIG };
}

if (!firebaseConfig) {
  firebaseConfig = { ...FALLBACK_FIREBASE_CONFIG };
}

if (!firebaseConfig || typeof firebaseConfig !== 'object' || !firebaseConfig.projectId) {
  console.warn('Firebase config missing or invalid; skipping init.');
}

const hasValidConfig = firebaseConfig && typeof firebaseConfig === 'object' && typeof firebaseConfig.projectId === 'string';

if (typeof firebase === 'undefined') {
  console.warn('Firebase SDK not available; auth features disabled.');
} else if (!hasValidConfig) {
  console.warn('Firebase config missing projectId; auth features disabled.');
} else if (!firebase.apps.length) {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (err) {
    console.warn('Firebase init error', err);
  }
}
