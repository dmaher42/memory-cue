/* BEGIN GPT CHANGE: env module */
export const ENV = {
  FIREBASE_API_KEY: window?.__ENV?.FIREBASE_API_KEY ?? '',
  FIREBASE_AUTH_DOMAIN: window?.__ENV?.FIREBASE_AUTH_DOMAIN ?? '',
  FIREBASE_PROJECT_ID: window?.__ENV?.FIREBASE_PROJECT_ID ?? '',
  FIREBASE_STORAGE_BUCKET: window?.__ENV?.FIREBASE_STORAGE_BUCKET ?? '',
  FIREBASE_MESSAGING_SENDER_ID: window?.__ENV?.FIREBASE_MESSAGING_SENDER_ID ?? '',
  FIREBASE_APP_ID: window?.__ENV?.FIREBASE_APP_ID ?? '',
  OPENAI_API_KEY: window?.__ENV?.OPENAI_API_KEY ?? '',
  AI_PROVIDER: window?.__ENV?.AI_PROVIDER ?? '',
  AI_MODEL: window?.__ENV?.AI_MODEL ?? '',
  CLAUDE_SONNET_45_ENABLED:
    typeof window?.__ENV?.CLAUDE_SONNET_45_ENABLED !== 'undefined'
      ? window.__ENV.CLAUDE_SONNET_45_ENABLED === 'true' || window.__ENV.CLAUDE_SONNET_45_ENABLED === true
      : true,
};
/* END GPT CHANGE */
