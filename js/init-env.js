const DEFAULT_ENV = {
  GOOGLE_SCRIPT_ENDPOINT:
    'https://script.google.com/macros/s/AKfycbylH5GmqeojNoZ-MA9WRg-w1S-ei9cv8Jo1M0qL7t5cn59LBRCCJ779WOyLi7qQwkSx/exec',
};

if (typeof window !== 'undefined') {
  const existingEnv =
    window.__ENV && typeof window.__ENV === 'object' && !Array.isArray(window.__ENV)
      ? window.__ENV
      : {};

  window.__ENV = {
    ...DEFAULT_ENV,
    ...existingEnv,
  };

  const env = window.__ENV;
  const hasFirebaseConfig = Boolean(
    env.FIREBASE_API_KEY && env.FIREBASE_AUTH_DOMAIN && env.FIREBASE_PROJECT_ID && env.FIREBASE_APP_ID
  );

  if (hasFirebaseConfig) {
    console.info('[ENV INIT] Firebase env loaded.');
  } else {
    console.warn('[ENV INIT] Missing Firebase env values; auth and Firestore are disabled.');
  }
}
