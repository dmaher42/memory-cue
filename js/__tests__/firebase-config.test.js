const { DEFAULT_FIREBASE_CONFIG, getFirebaseConfig } = require('../firebase-config.js');

describe('firebase-config', () => {
  const originalEnv = globalThis.__ENV;
  const originalDirect = globalThis.__FIREBASE_CONFIG;
  const originalMemoryCue = globalThis.memoryCueFirebase;

  beforeEach(() => {
    globalThis.__ENV = undefined;
    globalThis.__FIREBASE_CONFIG = undefined;
    delete globalThis.memoryCueFirebase;
  });

  afterEach(() => {
    delete globalThis.memoryCueFirebase;
  });

  afterAll(() => {
    globalThis.__ENV = originalEnv;
    globalThis.__FIREBASE_CONFIG = originalDirect;
    if (originalMemoryCue) {
      globalThis.memoryCueFirebase = originalMemoryCue;
    } else {
      delete globalThis.memoryCueFirebase;
    }
  });

  it('returns the default firebase project values', () => {
    const config = getFirebaseConfig();
    expect(config).toEqual(DEFAULT_FIREBASE_CONFIG);
    expect(config).not.toBe(DEFAULT_FIREBASE_CONFIG);
    expect(config.projectId).toBe('memory-cue-app');
  });

  it('merges direct global overrides', () => {
    globalThis.__FIREBASE_CONFIG = { projectId: 'custom-project', apiKey: 'custom-key' };
    const config = getFirebaseConfig();
    expect(config.projectId).toBe('custom-project');
    expect(config.apiKey).toBe('custom-key');
    expect(config.storageBucket).toBe(DEFAULT_FIREBASE_CONFIG.storageBucket);
  });

  it('merges __ENV overrides when direct config missing', () => {
    globalThis.__ENV = { FIREBASE_CONFIG: { measurementId: 'G-TESTING1234' } };
    const config = getFirebaseConfig();
    expect(config.measurementId).toBe('G-TESTING1234');
    expect(config.projectId).toBe(DEFAULT_FIREBASE_CONFIG.projectId);
  });
});
