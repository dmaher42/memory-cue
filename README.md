# Memory Cue

Memory Cue is an offline-friendly planner that helps teachers keep track of reminders, dashboards, and curated resources in a single PWA experience.

## Styling

Tailwind CSS utilities are delivered through the Tailwind v4 Play CDN (`@tailwindcss/browser`). No local CSS build pipeline is required—`index.html` and `mobile.html` both include the CDN script directly.

## Development

1. Install dependencies with `npm install`.
2. Run the unit tests with `npm test`.

The service worker is configured for offline support, so the site continues to load even without a network connection.
