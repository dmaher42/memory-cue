# Memory Cue — Current Architecture State (Phase 1)

## Runtime entrypoints

- **Mobile runtime (primary):** `mobile.html` loads `js/services/navigation-service-v2.js`, `mobile.js`, service-worker registration, and the mobile theme module. `mobile.js` imports the reminder and capture owners it needs.
- **Production root:** source `index.html` is absent; the build copies the mobile shell to `dist/index.html`.
- **Invalid-address fallback:** `404.html` is a dependency-free redirect to `/mobile`; it is not an app runtime.
- **Mobile navigation:** `js/services/navigation-service-v2.js` is the single loaded view-switching controller.
- **Server endpoints (Cloudflare Pages Functions):** `functions/api/assistant-chat.ts`, `functions/api/parse-entry.js`, `functions/api/embed.ts`, and `functions/api/push-reminder-sync.js`. (The Vercel-era `api/assistant.ts`, `api/chat.ts`, `api/search.ts`, and `api/capture.js` endpoints have been removed.)

## 1) All capture entry points

### Mobile capture entry points
- Fixed `#thinkingBarInput` / `#thinkingBarForm` in `mobile.html`, used as the single freeform capture surface.
- Non-visual `memoryCueQuickAddNow({ forceText })` seam used for Inbox-to-reminder conversion and regression coverage.
- FAB "new reminder" action dispatching `cue:prepare`/`cue:open`.
- Smart capture path in `mobile.js` (`sendAssistantMessage` flow) that classifies text and routes to assistant/reminder/inbox.
- (The Vercel-era server capture endpoint `api/capture.js` has been removed.)

## 2) All storage keys used in localStorage

Observed keys across runtime files:
- `memoryCueState` (historical desktop-shell key; no active reader or writer)
- `memoryCueInbox` (canonical Inbox store)
- `memoryEntries` (legacy Inbox migration input only)
- `memoryCueNotes`
- `memoryCueFolders`
- `memoryCue:offlineReminders`
- `scheduledReminders`
- `mc:lastDefaults`
- `syncUrl`
- `notesSyncDebug`
- `memory-cue-notes` (legacy notes migration key)
- `mobileNotes` (legacy notes migration key)
- `dailyTasksByDate`
- `memoryCue:plannerPlans`
- `memoryCue:plannerTimetable`

## 3) All reminder storage mechanisms

- **Primary offline reminder store:** `memoryCue:offlineReminders` in `src/reminders/reminderController.js`, loaded through `js/reminders.js`.
- **Scheduled notification mirror:** `scheduledReminders` in localStorage + service-worker syncing.
- **Background reminder persistence:** IndexedDB in `service-worker-v3.js` (`memory cue` reminder object store), used for scheduled notifications.

## 4) All assistant endpoints

Live Cloudflare Pages Functions:
- `POST /api/assistant-chat` (`functions/api/assistant-chat.ts`) — single assistant backend (intent + retrieval + LLM answer).
- `POST /api/parse-entry` (`functions/api/parse-entry.js`) — capture/entry classification.
- `POST /api/embed` (`functions/api/embed.ts`) — embeddings.
- `POST /api/push-reminder-sync` (`functions/api/push-reminder-sync.js`) — reminder push sync.

The Vercel-era `POST /api/assistant`, `POST /api/chat`, `POST /api/search`, and `POST /api/capture` endpoints have been removed.

## 5) All navigation mechanisms

- **Custom-event navigation:** mobile code dispatches `CustomEvent('app:navigate', { detail: { view }})` into `js/services/navigation-service-v2.js`.
- **View toggles:** the navigation service manages the `capture`, `reminders`, and `notebooks` panels through `data-view`, `hidden`, and `aria-hidden`.
- **Bottom nav:** `mobile.html` footer buttons use `data-nav-target` and are bound by the same navigation service.
- **Routing cleanup:** the legacy hash router has been removed. Invalid addresses are handled by the static `404.html` redirect rather than a second navigation runtime.

## 6) Which files control each system

- **Capture logic:** `mobile.js`, `src/core/capturePipeline.js`, `src/services/inboxService.js`, and `src/reminders/reminderController.js` (server endpoint `functions/api/parse-entry.js`).
- **Note storage:** `js/modules/notes-storage.js`, plus conversion helpers in `mobile.js` and `src/reminders/reminderController.js`.
- **Reminder storage:** `js/reminders.js` + `service-worker-v3.js`.
- **Assistant calls/UI:** `mobile.js` and reminder-side assistant helpers; server side `functions/api/assistant-chat.ts` through `src/services/assistantOrchestrator.js`.
- **Navigation switching:** `js/services/navigation-service-v2.js`, with `mobile.js` and feature modules acting as event dispatchers.
