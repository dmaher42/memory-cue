# Memory Cue — Current Architecture State (Phase 1)

## Runtime entrypoints

- **Mobile runtime (primary):** `mobile.html` loads `js/reminders.js` (module), `mobile.js` (module), and `js/assistant.js` for assistant form behavior.
- **Legacy shell runtime:** `index.html` loads `state.js` and root `assistant.js`.
- **Shared routing/navigation utilities:** `js/router.js` (hash-route toggling for legacy shell) and `js/navigation.js` (drawer/quick-add/global `app:navigate` handling in mobile contexts).
- **Server endpoints:** `api/assistant.ts`, `api/chat.ts`, `api/search.ts`, and `api/capture.js`.

## 1) All capture entry points

### Mobile capture entry points
- `#universalInput` in `mobile.html` capture view.
- Reminder quick-add form/input (`#quickAddForm`, `#quickAddInput`) used by reminders flow.
- FAB "new reminder" action dispatching `cue:prepare`/`cue:open`.
- Inbox quick-actions "Create Reminder" and "Convert to Note" in `js/entries.js`.
- Smart capture path in `mobile.js` (`sendAssistantMessage` flow) that classifies text and routes to assistant/reminder/inbox.

### Legacy capture entry points
- `#captureInput` + `#captureButton` in `index.html` handled by root `assistant.js` (`initCaptureSave`).

## 2) All storage keys used in localStorage

Observed keys across runtime files:
- `memoryCueState`
- `memoryEntries`
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
- `reminderEntries` (inline mobile script inbox/category utility path)

## 3) All reminder storage mechanisms

- **Primary offline reminder store:** `memoryCue:offlineReminders` in `js/reminders.js`.
- **Scheduled notification mirror:** `scheduledReminders` in localStorage + service-worker syncing.
- **Background reminder persistence:** IndexedDB in `service-worker.js` (`memory cue` reminder object store), used for scheduled notifications.
- **Inline mobile legacy/helper path:** `reminderEntries` in `mobile.html` inline script for category/inbox rendering.

## 4) All assistant endpoints

- `POST /api/assistant` (intent detect + save/retrieve/search from memory-store).
- `POST /api/chat` (LLM answer path using memory context + `/api/search` fallback).
- `POST /api/search` (local ranked note retrieval).

Related but capture-focused endpoint:
- `POST /api/capture` (schemaVersion 2 capture classification and record creation).

## 5) All navigation mechanisms

- **Hash routing:** `js/router.js` listens to `hashchange` and toggles `[data-route]` / `[data-view]` panels.
- **Custom-event navigation:** mobile shell dispatches and listens for `window` `CustomEvent('app:navigate', { detail: { view }})`.
- **View toggles:** mobile view panels use `data-view` + `hidden`/`aria-hidden` switching.
- **Bottom nav:** `mobile.html` footer buttons with `data-nav-target` dispatch `app:navigate`.
- **Drawer/quick-add controls:** `js/navigation.js` manages drawer open/close and quick-add panel visibility.

## 6) Which files control each system

- **Capture logic:** `mobile.js`, `js/reminders.js`, `js/entries.js`, root `assistant.js`, `api/capture.js`.
- **Note storage:** `js/modules/notes-storage.js`, plus conversion helpers in `mobile.js`, `js/reminders.js`, `js/entries.js`.
- **Reminder storage:** `js/reminders.js` + `service-worker.js`.
- **Assistant calls/UI:** `js/assistant.js`, `mobile.js`, `js/reminders.js`, root `assistant.js`; server side `api/assistant.ts`, `api/chat.ts`, `api/search.ts`.
- **Navigation switching:** `mobile.html` inline nav script, `mobile.js`, `js/navigation.js`, `js/router.js`, and sections in `js/entries.js`.
