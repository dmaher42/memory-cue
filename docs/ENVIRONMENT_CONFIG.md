# Environment Configuration

## Server variables
- `OPENAI_API_KEY`: required for `/api/assistant-chat` to call OpenAI Responses API.
- `APP_URL` (optional): historical endpoint base URL. Current assistant flow uses relative `/api/assistant-chat`.

## Client/runtime configuration
- Supabase settings are loaded via `js/config-supabase.js`, `js/supabase-client.js`, and runtime env shims in `js/init-env.js` / `js/env.js`.
- Supabase settings are loaded from `window.__ENV` and `js/supabase-client.js`.
- Google Apps Script endpoint configuration is managed through `syncUrl` in localStorage and notes sync modules.

## Notes
- Do not hard-code provider credentials in source files.
- Keep `.env` local-only and untracked.
