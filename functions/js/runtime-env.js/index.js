const CLIENT_RUNTIME_ENV_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_WEB_PUSH_VAPID_KEY',
  'FIREBASE_APP_ID',
  'AI_PROVIDER',
  'AI_MODEL',
  'CLAUDE_SONNET_45_ENABLED',
];

export async function onRequestGet(context) {
  const env = context?.env || {};
  const lines = CLIENT_RUNTIME_ENV_KEYS
    .map((key) => {
      const value = env[key];
      if (typeof value === 'undefined' || value === null || String(value).trim() === '') {
        return '';
      }
      return `  ${JSON.stringify(key)}: ${JSON.stringify(String(value))},`;
    })
    .filter(Boolean)
    .join('\n');

  return new Response(`window.__ENV = {
  ...(window.__ENV && typeof window.__ENV === 'object' && !Array.isArray(window.__ENV) ? window.__ENV : {}),
${lines}
};

window.textureUrl =
  window.textureUrl ||
  ((filename) => {
    if (typeof filename !== 'string') {
      return '';
    }

    return filename;
  });
`, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
