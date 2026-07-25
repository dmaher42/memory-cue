# Memory Cue — Current Architecture State (Phase 1)

## Runtime entrypoints

- **Mobile runtime (primary):** `mobile.html` loads `js/reminders.js` (module), `mobile.js` (module), and `js/assistant.js` for assistant form behavior.
- **Legacy shell runtime:** `index.html` loads `state.js` and root `assistant.js`.
- **Shared routing/navigation utilities:** `js/router.js` (hash-route toggling for legacy shell) and `js/navigation.js` (drawer/universal-capture/global `app:navigate` handling in mobile contexts).
- **Server endpoints (Cloudflare Pages Functions):** `functions/api/assistant-chat.ts`, `functions/api/parse-entry.js`, `functions/api/embed.ts`, and `functions/api/push-reminder-sync.js`. (The Vercel-era `api/assistant.ts`, `api/chat.ts`, `api/search.ts`, and `api/capture.js` endpoints have been removed.)

## 1) All capture entry points

### Mobile capture entry points
- Fixed `#thinkingBarInput` / `#thinkingBarForm` in `mobile.html`, used as the single freeform capture surface.
- Non-visual `memoryCueQuickAddNow({ forceText })` seam used for Inbox-to-reminder conversion and regression coverage.
- FAB "new reminder" action dispatching `cue:prepare`/`cue:open`.
- Smart capture path in `mobile.js` (`sendAssistantMessage` flow) that classifies text and routes to assistant/reminder/inbox.
- (The Vercel-era server capture endpoint `api/capture.js` has been removed.)

### Legacy capture entry points
- `#captureInput` + `#captureButton` in `index.html` handled by root `assistant.js` (`initCaptureSave`).

## 2) All storage keys used in localStorage

Observed keys across runtime files:
- `memoryCueState`
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

- **Hash routing:** `js/router.js` listens to `hashchange` and toggles `[data-route]` / `[data-view]` panels.
- **Custom-event navigation:** mobile shell dispatches and listens for `window` `CustomEvent('app:navigate', { detail: { view }})`.
- **View toggles:** mobile view panels use `data-view` + `hidden`/`aria-hidden` switching.
- **Bottom nav:** `mobile.html` footer buttons with `data-nav-target` dispatch `app:navigate`.
- **Drawer/global capture controls:** `js/navigation.js` manages drawer open/close and focuses the universal capture bar when requested.

## 6) Which files control each system

- **Capture logic:** `mobile.js`, `src/core/capturePipeline.js`, `src/services/inboxService.js`, `src/reminders/reminderController.js`, and root `assistant.js` for the legacy desktop shell (server endpoint `functions/api/parse-entry.js`).
- **Note storage:** `js/modules/notes-storage.js`, plus conversion helpers in `mobile.js` and `src/reminders/reminderController.js`.
- **Reminder storage:** `js/reminders.js` + `service-worker-v3.js`.
- **Assistant calls/UI:** `js/assistant.js`, `mobile.js`, `js/reminders.js`, root `assistant.js`; server side `functions/api/assistant-chat.ts`.
- **Navigation switching:** `mobile.html` inline nav script, `mobile.js`, `js/navigation.js`, and `js/router.js`.
