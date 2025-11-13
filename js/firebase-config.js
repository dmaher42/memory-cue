const DEFAULT_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyB8n0PCndJgHnU_i5y4PiFv8zn2eA1New0',
  authDomain: 'memory-cue-pro.firebaseapp.com',
  projectId: 'memory-cue-pro',
  storageBucket: 'memory-cue-pro.firebasestorage.app',
  messagingSenderId: '494760962301',
  appId: '1:494760962301:web:52c0fe3567f0c8f8b9e5e6',
  measurementId: 'G-1H4CPRO123'
});

function normalizeConfigCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const entries = Object.entries(candidate).filter(([key, value]) => typeof value === 'string' && value.trim() !== '');
  if (!entries.length) {
    return null;
  }
  return Object.fromEntries(entries);
}

function readConfigFromGlobals() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  const direct = normalizeConfigCandidate(scope?.__FIREBASE_CONFIG);
  if (direct) {
    return direct;
  }
  const env = normalizeConfigCandidate(scope?.__ENV?.FIREBASE_CONFIG);
  if (env) {
    return env;
  }
  const legacyMap = {
    FIREBASE_API_KEY: 'apiKey',
    FIREBASE_AUTH_DOMAIN: 'authDomain',
    FIREBASE_PROJECT_ID: 'projectId',
    FIREBASE_STORAGE_BUCKET: 'storageBucket',
    FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
    FIREBASE_APP_ID: 'appId',
    FIREBASE_MEASUREMENT_ID: 'measurementId'
  };
  const legacy = Object.entries(legacyMap).reduce((acc, [legacyKey, targetKey]) => {
    const value = scope?.__ENV?.[legacyKey] ?? scope?.[legacyKey];
    if (typeof value === 'string' && value.trim() !== '') {
      acc[targetKey] = value;
    }
    return acc;
  }, {});
  return Object.keys(legacy).length ? legacy : null;
}

function getFirebaseConfig() {
  const overrides = readConfigFromGlobals();
  if (!overrides) {
    return { ...DEFAULT_FIREBASE_CONFIG };
  }
  return { ...DEFAULT_FIREBASE_CONFIG, ...overrides };
}

const api = { DEFAULT_FIREBASE_CONFIG, getFirebaseConfig };

if (typeof globalThis !== 'undefined') {
  const scope = globalThis;
  scope.memoryCueFirebase = scope.memoryCueFirebase || {};
  scope.memoryCueFirebase.getFirebaseConfig = getFirebaseConfig;
  scope.memoryCueFirebase.DEFAULT_FIREBASE_CONFIG = DEFAULT_FIREBASE_CONFIG;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
  module.exports.default = api;
}
