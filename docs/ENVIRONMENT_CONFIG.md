# Environment Configuration

## Server variables
- `OPENAI_API_KEY`: required for server-side API routes such as `/api/assistant-chat` and `/api/embed`.
- `APP_URL` (optional): historical endpoint base URL. Current assistant flow uses relative `/api/assistant-chat`.

### Phone and lock-screen reminder delivery
- The Cloudflare Pages `/api/push-reminder-sync` function needs `FIREBASE_API_KEY` plus server-only Firebase service-account credentials.
- Supply the service account as `FIREBASE_SERVICE_ACCOUNT_JSON` containing `project_id`, `client_email`, and `private_key`; or use `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` as separate settings.
- The separate reminder scheduler Worker uses the same service-account choice. `SCHEDULER_QUERY_LIMIT` is optional; it controls the per-run reminder query limit and defaults to 250.
- Keep all service-account values in Cloudflare's encrypted server settings. Never expose them through `window.__ENV`, a client bundle, or a committed file.

## Client/runtime configuration
- Firebase settings are injected into `window.__ENV` by `js/runtime-env.js`.
- `js/init-env.js` is the single runtime initializer and preserves any values already injected before app boot.
- The Firebase runtime reads `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`.
- `FIREBASE_STORAGE_BUCKET` is optional.
- `FIREBASE_MESSAGING_SENDER_ID` and the public `FIREBASE_WEB_PUSH_VAPID_KEY` are both required for this browser or installed phone app to register for remote lock-screen push alerts. The VAPID public key is client configuration, not a private service credential.
- Cloudflare Pages should expose those variables to the build so `scripts/build.mjs` can generate `dist/js/runtime-env.js`.
- Google Apps Script endpoint configuration is managed through `syncUrl` in localStorage and notes sync modules.

## Notes
- Do not hard-code provider credentials in source files.
- Keep `.env` local-only and untracked.
