# Memory Cue

Memory Cue is a progressive web app for capturing reminders, notes, and study aids. The interface relies on Tailwind CSS v4 via CDN so you can work with the project without compiling styles or running a build pipeline.

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

## Privacy & Data

Memory Cue stores notes and reminders in Firebase services (e.g., Firestore or Realtime Database). Review your Firebase security rules to ensure only authorized users can read or write their data, and communicate the data retention policy to your users. As with any Firebase-backed app, do not commit private API keys or service credentials to the repository.
