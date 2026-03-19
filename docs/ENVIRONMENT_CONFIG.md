# Environment Configuration

## Server variables
- `OPENAI_API_KEY`: required for server-side API routes such as `/api/assistant-chat` and `/api/embed`.
- `APP_URL` (optional): historical endpoint base URL. Current assistant flow uses relative `/api/assistant-chat`.

## Client/runtime configuration
- Firebase settings are injected into `window.__ENV` by `js/runtime-env.js`.
- `js/init-env.js` is the single runtime initializer and preserves any values already injected before app boot.
- The Firebase runtime reads `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`.
- `FIREBASE_STORAGE_BUCKET` and `FIREBASE_MESSAGING_SENDER_ID` are optional runtime values when available.
- Cloudflare Pages should expose those variables to the build so `scripts/build.mjs` can generate `dist/js/runtime-env.js`.
- Google Apps Script endpoint configuration is managed through `syncUrl` in localStorage and notes sync modules.

## Notes
- Do not hard-code provider credentials in source files.
- Keep `.env` local-only and untracked.
