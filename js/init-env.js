if (typeof window !== 'undefined') {
  const env = window.__ENV || {};
  const hasFirebaseConfig = Boolean(
    env.FIREBASE_API_KEY && env.FIREBASE_AUTH_DOMAIN && env.FIREBASE_PROJECT_ID && env.FIREBASE_APP_ID
  );

  if (!hasFirebaseConfig) {
    console.warn('[ENV INIT] Missing Firebase env values; auth and Firestore are disabled.');
  }
}
