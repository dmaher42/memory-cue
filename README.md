# Memory Cue

Memory Cue is a progressive web app for capturing reminders, notes, and study aids. The interface uses a Tailwind CSS pipeline so you can iterate locally with a file watcher and ship an optimised bundle for production.

## Background reminders

Memory Cue ships with a service worker that now schedules reminders using the Notification Triggers API where supported (currently Chromium-based browsers). When you enable notifications from the Reminders screen the app registers `service-worker.js`, stores each due reminder, and asks the browser to display it even if the page or installed PWA is closed. If Notification Triggers are unavailable the app falls back to in-page timers so you still see alerts while the tab is open.

To test background reminders locally:

1. Serve the project over HTTPS (or `http://localhost`) and open the Reminders view.
2. Click the bell icon to grant notification permission.
3. Add a reminder with a future due time.
4. Close the tab or minimise the app—Chrome on desktop and Android will fire the scheduled notification at the due time.

Each notification links back to the Reminders board; tapping it reopens the PWA if necessary. Remember that browsers can suspend background delivery, so keep critical deadlines in an external calendar as a safety net.

## Quick Start

1. Clone the repository: `git clone https://github.com/<your-account>/memory-cue.git`
2. Move into the project directory: `cd memory-cue`
3. Install dependencies: `npm install`
4. In a new terminal, start the Tailwind watcher to keep `styles/tailwind.css` in sync while you edit templates: `npm run dev`
5. Start a local server (for example via `serve`): `npm start`
6. (Optional) Run the automated test suite: `npm test`

## Deployment

### Canonical hosting: Cloudflare Pages

Memory Cue is deployed through **Cloudflare Pages**.

Build command:

```bash
npm run build
```

Build output directory:

```bash
dist
```

The repo contains `wrangler.jsonc` to document the Cloudflare Pages build output. Cloudflare Pages should be treated as the primary hosting target.

### Legacy hosting residue

The repo may still contain historical hosting residue from GitHub Pages or Vercel. Those paths should be treated as transitional or cleanup candidates unless they are explicitly confirmed active.

## Configuration

Memory Cue expects Firebase credentials to be available at runtime via `window.__ENV`.

For Cloudflare Pages, set these build environment variables so `npm run build` can write `dist/js/runtime-env.js` during deployment:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`

Optional Firebase runtime variables:

- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`

For local development, place the same values in an untracked `.env.local` file before running `npm run build`. The generated runtime env script preserves any values already present in `window.__ENV`, and `js/init-env.js` remains the single runtime initializer.

## AI setup

The serverless AI endpoints require an OpenAI API key at runtime:

- `OPENAI_API_KEY` for `api/assistant.ts`
- `OPENAI_API_KEY` for `api/parse-entry.js`

If this variable is missing, these endpoints return a `500` JSON error indicating server misconfiguration.

## Privacy & Data

Memory Cue stores synced notes and reminders through Firebase-backed services. Review your Firebase security rules to ensure only authorized users can read or write their data, and communicate the data retention policy to your users. Do not commit private service credentials to the repository.

## Desktop theme architecture

The desktop experience relies on a bespoke theme toggle and layout hooks. Keep the following guardrails in mind whenever you touch `index.html`, `styles/daisy-themes.css`, or `js/main.js`:

- **Theme persistence rules.** `js/main.js` hard-codes the theme rotation to `['professional', 'night']` and assumes that the desktop styles always run under `data-theme="professional"` when the “light” option is active. Toggling calls `applyTheme`, `updateThemeButton`, and `dispatchThemeChange`, persisting the current value in `localStorage` under the `theme` key. If you add or rename a theme, make sure `professional` stays in the list so the selectors that scope to `[data-theme="professional"]` continue to match.
- **Desktop design tokens.** The professional DaisyUI theme in `styles/daisy-themes.css` is the only place that currently defines the `--desktop-*` custom properties (`--desktop-bg`, `--desktop-surface`, `--desktop-surface-muted`, `--desktop-border-subtle`, `--desktop-header-bg`, `--desktop-header-border`, `--desktop-text-main`, `--desktop-text-muted`, `--desktop-nav-bg`, `--desktop-nav-active`, `--desktop-nav-text`, `--desktop-nav-text-muted`, `--desktop-radius-card`, `--desktop-radius-chip`, `--desktop-shadow-card`, `--desktop-shadow-subtle`). Copy or override this block whenever you ship a new DaisyUI theme so the desktop palette, radii, and shadows stay in sync.
- **Required markup hooks.** Custom layout utilities such as `.desktop-hero`, `.desktop-dashboard-grid`, `.dashboard-card`, and `.desktop-panel` are baked into `index.html`. These wrappers power the authored CSS; swapping them for ad-hoc Tailwind utility grids (e.g., `max-w-6xl`, `grid grid-cols-1 lg:grid-cols-3`) prevents the desktop rules from applying. When editing the dashboard section, keep these class hooks around so the selectors in `index.html` continue to trigger.

Following these rules keeps the professional theme in the toggle rotation, ensures each new theme exposes the desktop token surface, and preserves the layout hooks that the desktop CSS expects.
