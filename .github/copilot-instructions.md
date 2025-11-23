# Memory Cue — Copilot instructions

This file gives concise, actionable guidance for AI coding agents working in this repository.

## Big picture
- App Type: Progressive Web App (PWA) implemented as a static site with a service worker. Key front-end code lives under `js/`, `modules/`, and top-level entry files like `app.js`, `mobile.js`, and `index.html`.
- Build: A custom `scripts/build.mjs` bundles JS with `esbuild` and produces a hashed CSS asset via `npx tailwindcss` into `dist/` (see `package.json` `build` script).
- Runtime env: Runtime secrets/config are injected into the page as `window.__ENV` (see `js/init-env.js` and README). Supabase config is read from `window.supabase` or `window.__ENV` (see `js/config-supabase.js`).

## Important files to inspect before coding
- `scripts/build.mjs` — esbuild entry maps (`moduleEntries` + `legacyEntries`), CSS hashing, `dist/` rewrite rules and `copyStatic()` list. When you add/remove entrypoints, update this file.
- `service-worker.js` — offline & reminders logic. Note constants like `CACHE_VERSION` (bump when changing precache), `REMINDER_STORE_NAME`, and message types used to update scheduled reminders.
- `js/main.js` — theme toggling, theme event `memoryCue:theme-change`, storage key `theme`, and required DOM hooks (e.g., `#theme-toggle`, `data-nav` attributes).
- `README.md` — developer notes (dev server, `npm run dev`, `npm start`, `npm run build`, `npm run deploy`) and high-level behavior (Notification Triggers fallback).

## Build / Dev / Test workflows (exact commands)
- Install: `npm install`
- Dev CSS watcher: `npm run dev` (runs `tailwindcss` watcher that updates `styles/tailwind.css`).
- Local server (serve static files): `npm start` (uses `serve .`). Use this to test service-worker behavior on `http://localhost` or via HTTPS for certain APIs.
- Full production bundle: `npm run build` (runs `node scripts/build.mjs` — produces `dist/` with hashed assets).
- Deploy to GitHub Pages: `npm run deploy` (runs build then `gh-pages -d dist`).
- Tests: `npm test` (Jest). There are DOM and service-worker tests under `tests/` and `js/__tests__/`.

## Project-specific conventions & patterns
- Entrypoints: New top-level script entrypoints must be added to `scripts/build.mjs` (`moduleEntries` or `legacyEntries`) so `esbuild` outputs get hashed and `rewriteHtml()` maps references in `dist/`.
- HTML hooks: Desktop layout relies on specific class/ID hooks in `index.html` (e.g., `.desktop-hero`, `.dashboard-card`, `#mainContent`) — avoid removing them when refactoring DOM structure.
- Theme handling: `js/main.js` expects `SUPPORTED_THEMES = ['professional','night']`. Keep `professional` in the list to preserve desktop selectors that target `[data-theme="professional"]` in `styles/daisy-themes.css`.
- Service worker cache/versioning: When changing precached shell files or asset paths, increment `CACHE_VERSION` in `service-worker.js` to force clients to update.
- Reminders persistence: Service worker uses IndexedDB store `memory-cue-reminders` / object store `scheduled`. Messages to SW use `type: 'memoryCue:updateScheduledReminders'` and `'memoryCue:checkScheduledReminders'` — prefer those shapes when driving the SW from pages.

## Integration points & external deps
- Supabase: Look at `js/supabase-client.js` + `js/config-supabase.js`. The runtime expects `window.__ENV` or a global `supabase` client.
- Firebase references: README documents optional Firebase hosting; repo includes firebase-related tests in `js/__tests__/` but Supabase is the primary runtime integration.
- Browser APIs: service worker uses Notification Triggers, Push, Periodic Sync, and IndexedDB. Tests and local manual QA should account for feature availability across browsers.

## Concrete examples / gotchas for changes
- Adding a JS entrypoint: update `scripts/build.mjs` `moduleEntries` (for ESM) or `legacyEntries` (for IIFE), run `npm run build`, then verify `dist/` rewritten HTML references (the build script maps original `./app.js` -> hashed `./assets/app-<hash>.js`).
- Updating precache list: edit `SHELL_URLS` in `service-worker.js` and bump `CACHE_VERSION` so clients fetch the new assets.
- Changing CSS tokens/themes: edit `styles/daisy-themes.css` and ensure desktop token names (`--desktop-*`) are preserved.
- Testing reminders: follow README steps (serve over `localhost`/HTTPS, grant notifications); programmatic test helpers post `message` to SW with `{type: 'memoryCue:updateScheduledReminders', reminders: [...]}`.

## Safety & non-goals
- Do not hard-code production secrets into the repo. Use `window.__ENV` injection or deployment templating as noted in `README.md` and `js/init-env.js`.
- Avoid removing DOM hooks used by CSS and service-worker navigation fallbacks — these are intentional integration points.

If you want, I can now (A) create or merge this file into the repo (I will), (B) expand sections with specific code snippets (add examples showing how to message the SW or how to add an esbuild entry), or (C) run a test build to validate. Which next step do you prefer?
