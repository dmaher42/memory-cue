/* firebase-init.js */
const FALLBACK_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
  authDomain: 'memory-cue-app.firebaseapp.com',
  projectId: 'memory-cue-app',
  storageBucket: 'memory-cue-app.firebasestorage.app',
  messagingSenderId: '751284466633',
  appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
  measurementId: 'G-R0V4M7VCE6'
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
