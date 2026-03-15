const DEFAULT_FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyAmAMiz0zG3dAhZJhOy1DYj8fKVDObL36c',
  authDomain: 'ai-assistant-d546b.firebaseapp.com',
  projectId: 'ai-assistant-d546b',
  storageBucket: 'ai-assistant-d546b.appspot.com',
  messagingSenderId: '751284466633',
  appId: '1:751284466633:web:3b10742970bef1a5d5ee18',
  measurementId: 'G-R0V4M7VCE6'
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

function normalizeAuthDomainValue(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname) {
      return parsed.hostname;
    }
  } catch {
    // keep original value when it is already a bare hostname
  }
  return trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

function normalizeFirebaseConfig(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }
  if (typeof config.authDomain !== 'string') {
    return config;
  }
  return {
    ...config,
    authDomain: normalizeAuthDomainValue(config.authDomain),
  };
}

function readConfigFromGlobals() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  const direct = normalizeConfigCandidate(scope?.__FIREBASE_CONFIG);
  if (direct) {
    return normalizeFirebaseConfig(direct);
  }
  const env = normalizeConfigCandidate(scope?.__ENV?.FIREBASE_CONFIG);
  if (env) {
    return normalizeFirebaseConfig(env);
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
  return Object.keys(legacy).length ? normalizeFirebaseConfig(legacy) : null;
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
