# Memory Cue

Memory Cue is a progressive web app for capturing reminders, notes, and study aids. The interface relies on Tailwind CSS v4 via CDN so you can work with the project without compiling styles or running a build pipeline.

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
4. Start a local server: `npm start`
5. (Optional) Run the automated test suite: `npm test`

## Deployment

### GitHub Pages

Deploy the current contents of the repository to GitHub Pages with:

```bash
npm run deploy
```

This command publishes the site to the `gh-pages` branch via the `gh-pages` CLI, making it available at `<username>.github.io/memory-cue`.

### Firebase Hosting

Configure Firebase Hosting to serve the repository root (or a `public` directory of your choice) and deploy with:

```bash
firebase deploy --only hosting
```

Refer to Firebase documentation for setup steps such as creating a project, initializing hosting, and adding a `firebase.json` configuration file.

## Configuration

Memory Cue expects Supabase credentials to be available at runtime via `window.__ENV`. Add the following snippet to your production `index.html` (or equivalent template) **before** loading the main JavaScript bundle so the app can read the values when it starts:

```html
<script>
  window.__ENV = {
    SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
    SUPABASE_ANON_KEY: "YOUR_ANON_KEY"
  };
</script>
```

Keep your real Supabase URL and anon key out of version control—set them through deployment-specific templating or secrets management rather than committing them to the repository.

## Privacy & Data

Memory Cue stores notes and reminders in Firebase services (e.g., Firestore or Realtime Database). Review your Firebase security rules to ensure only authorized users can read or write their data, and communicate the data retention policy to your users. As with any Firebase-backed app, do not commit private API keys or service credentials to the repository.
