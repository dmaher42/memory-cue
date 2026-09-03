# Memory Cue

Memory Cue is a progressive web app for capturing reminders, notes, and study aids. The interface uses a Tailwind CSS pipeline so you can iterate locally with a file watcher and ship an optimised bundle for production.

## Background reminders

Memory Cue treats timed reminders as urgent appointment cues. While the app is running, it checks at 15 minutes, 5 minutes, 1 minute, the due time, and every 5 minutes overdue. The persistent alert supports Seen, Snooze 5, Start / Join, and Done. Seen stops the current interruption; the red app badge remains until Done.

The service worker stores the schedule and can show lock-screen notifications whenever the browser wakes it. Cross-device Firebase push also wakes the service worker when a reminder changes. Web browsers do not provide a dependable future alarm clock for a fully closed PWA, so exact closed-phone timing requires the separate scheduler in `workers/reminder-scheduler/`. Its code and tests are included, but it remains inactive until its Firebase permissions, encrypted credentials, Firestore indexes, Cloudflare plan, deployment, and real-phone test are approved and completed. Do not describe browser-controlled periodic sync as an exact alarm.

To test background reminders locally:

1. Serve the project over HTTPS (or `http://localhost`) and open the Reminders view.
2. Click the bell icon to grant notification permission.
3. Add a reminder with a future due time.
4. Keep the app open for an exact local timing test. A closed-app test is only deterministic after the production push scheduler is configured.

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

The Vercel-era `api/` directory has been removed (serverless code now lives in `functions/api/`). Any remaining GitHub Pages references should be treated as transitional or cleanup candidates unless they are explicitly confirmed active.

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
- `FIREBASE_WEB_PUSH_VAPID_KEY`

The cross-device push endpoint also needs server-only Firebase credentials in Cloudflare Pages. These must never be written into the client runtime file:

- `FIREBASE_API_KEY`
- `FIREBASE_PROJECT_ID`
- either `FIREBASE_SERVICE_ACCOUNT_JSON`, or both `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`

That service account must be allowed to read the signed-in user's registered push devices from Firestore and send Firebase Cloud Messaging messages. The endpoint resolves device tokens on the server; it does not trust target tokens supplied by a browser.

For local development, place the same values in an untracked `.env.local` file before running `npm run build`. The generated runtime env script preserves any values already present in `window.__ENV`, and `js/init-env.js` remains the single runtime initializer.

## AI setup

The serverless AI endpoints (Cloudflare Pages Functions under `functions/api/`) require an OpenAI API key at runtime:

- `OPENAI_API_KEY` for `functions/api/assistant-chat.ts`
- `OPENAI_API_KEY` for `functions/api/parse-entry.js`

If this variable is missing, these endpoints return a `500` JSON error indicating server misconfiguration.

## Privacy & Data

Memory Cue stores synced notes and reminders through Firebase-backed services. Review your Firebase security rules to ensure only authorized users can read or write their data, and communicate the data retention policy to your users. Do not commit private service credentials to the repository.

## Missing-address recovery

`404.html` is a small Cloudflare Pages fallback that redirects invalid addresses to `/mobile`. It is not a second app shell and must not acquire feature code, storage logic, or its own navigation system.
