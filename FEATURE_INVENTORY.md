# Feature Inventory

| Feature Area | Current Purpose | Main Entry Point / UI | Data / Storage Used | Keep / Merge / Remove | Notes |
|---|---|---|---|---|---|
| Universal Capture | One visible AI-assisted input for reminders, notes, and questions. | Fixed `#thinkingBarContainer` / `#thinkingBarInput` in `mobile.html`; wired through `mobile.js` into the canonical capture pipeline. | Reminder, note, or Inbox storage selected by the canonical capture decision. | Keep as the single visible capture bar | The duplicate reminder-only form and its UI wiring have been removed. `memoryCueQuickAddNow({ forceText })` remains as a non-visual compatibility and regression seam. |
| Inbox | Background holding and processing layer for ambiguous captures. | No dedicated mobile screen; owned by `src/services/inboxService.js` through the capture-service wrapper. | Canonical `memoryCueInbox`, with one-time migration from legacy `memoryEntries`. | Keep as an internal processing layer | The retired Inbox/Categories script, hidden Categories view, and `reminderEntries` path have been removed. Do not recreate a parallel visible inbox or store. |
| Brain Dump | Historical duplicate scratch-capture path. | No active UI or runtime handler remains. | No active `brainDumpItems` reader or writer remains. | Remove complete | Universal Capture now owns this visible workflow. Existing browser data under the old key is inert. |
| Notes / Notebook | Core writing/editing and long-form note management. | Notebook view (`data-view="notebook"`), editor fields, note list and sheet flows in `mobile.html` + `mobile.js`. | `localStorage` notes (`memoryCueNotes`, legacy keys), optional Firebase sync. | Keep as core | This appears to be a central product surface. |
| Saved Notes Sheet | Overlay/sheet for browsing existing notes and folders. | Saved notes slide-in UI in `mobile.html` (saved-notes styles/sheet hooks) + handlers in `mobile.js`. | Same notes/folders storage as Notebook. | Keep but simplify | UX pattern overlaps with other sheets/modals (settings, reminder create, folder move). |
| Reminders | Create/manage timed reminders with categories/priorities and notifications. | Reminders board and category actions in `mobile.html`; canonical logic in `src/reminders/reminderController.js` via `js/reminders.js`. | Firestore/Firebase reminder data + offline fallback (`memoryCue:offlineReminders`) + service worker schedule state. | Keep as core | One of two major app pillars (with Notebook). |
| Reminder Creation Sheet | Dedicated bottom-sheet flow for authoring reminders. | `#create-sheet`, `#createReminderForm`, `#saveReminder` in `mobile.html`. | Writes into the canonical reminder controller. | Keep but simplify | Used for explicit, structured reminder creation; universal capture remains the sole freeform entry bar. |
| Folders | Organize notes into user-defined buckets. | Folder sidebar/chips + move/rename/delete dialogs in notebook/saved-notes surfaces. | `localStorage` key `memoryCueFolders` (+ note `folderId` references), Firebase sync via notes payload. | Keep but simplify | Strongly tied to Notebook IA; avoid duplicate folder pickers. |
| Categories | Classify reminders (and possibly memory items) by topic/type. | Reminder category input (`#category` + `#categorySuggestions`) and seeded category logic in `js/reminders.js`. | Reminder fields + seeded in-code categories. | Keep but simplify | Potential taxonomy drift vs folder concepts and assistant memory “type/tags”. |
| Assistant | Conversational capture/retrieval helper and reflection tools. | Universal thinking bar and assistant thread in `mobile.html`, owned by `mobile.js`. | Client context from notes/reminders; server endpoints for assistant/search/parse. | Keep but simplify | The unloaded `js/assistant.js` placeholder has been removed; future UI work belongs in the active mobile shell path. |
| Memory Coach | Personal vocabulary retrieval practice with clues, reveal, honest self-rating, and adaptive return intervals. | `Memory coach` launcher in the Capture header; UI controller in `src/ui/mobileMemoryCoachUi.js`; Word Help supplies explicit `Learn` actions. | Opt-in hidden memory-card entries inside `memoryCueInbox`; no new storage key and no AI call during review. | Keep and evolve | Normal Inbox readers filter practice cards, while sync and backups retain them. Existing Notes and Reminders remain byte-for-byte outside this flow. |
| Assistant Processing | Backend parsing, intent handling, and semantic-ish retrieval. | Cloudflare Pages Functions: `functions/api/assistant-chat.ts`, `functions/api/parse-entry.js`, `functions/api/embed.ts`, `functions/api/push-reminder-sync.js`. | In-memory store utilities + OpenAI API calls + request payloads. | Merge into another feature | The old Vercel-era `api/*` endpoints (`assistant.ts`, `search.ts`, `chat.ts`, `capture.js`) have been removed; live serverless code is consolidated under `functions/api/*`. |
| Settings | Configuration controls (notably sync endpoint config). | `#settingsModal`, `#saveSyncSettings`, `#testSync`, `#syncAll` in `mobile.html`. | Local settings persistence + sync endpoint URL. | Keep but simplify | Primarily sync-focused; may not need a broad “settings” footprint yet. |
| Sync | Keep reminders/notes aligned across sessions/devices. | Notes sync init in `mobile.js` + `js/modules/notes-sync.js`; reminder sync in reminders module/service worker. | Firebase (notes), Firebase/Firestore (reminders), service worker notifications, online/offline listeners. | Keep as core | Critical trust feature; currently multi-path and complex. |
| Bottom Navigation | Primary mobile view switching and wayfinding. | `#mobile-nav-shell` in `mobile.html`; canonical controller in `js/services/navigation-service-v2.js`, with events dispatched by `mobile.js` and feature modules. | UI state only (`data-active-view`, classes). | Keep as core | Clear mobile affordance; should stay stable while other flows are consolidated. |
| FAB / Floating Action Button | Prominent launcher for explicit app actions. | `#mobile-fab-button` and `#mobile-fab-menu`. | UI state + downstream canonical action paths. | Keep but simplify | The separate Brain Dump FAB is no longer present. |
| Search | Retrieve reminders/notes/context quickly across views. | Reminder search (`#searchReminders`), notebook/saved notes search inputs, assistant thinking/search events. | In-memory filtering + assistant retrieval via `functions/api/assistant-chat.ts` + local note text fields. | Keep as core | Search appears fragmented by feature area rather than unified. The standalone `api/search.ts` endpoint has been removed. |

## Suspected Overlaps

- The structured reminder sheet and FAB shortcut intentionally overlap with Universal Capture for explicit reminder authoring; there is only one freeform capture bar.
- Notes, reminders, and the internal Inbox remain separate destination domains selected by the canonical capture pipeline.
- Multiple overlay/sheet patterns: saved notes sheet, reminder sheet, settings modal, move-folder sheet, note options sheet.
- Possible duplicate storage concepts: folders vs categories vs assistant tags/types.
- Split sync concepts: reminders and notes sync through different stacks, with additional offline/service-worker handling.
- Search is distributed across reminders, notebook, and assistant channels rather than one consistent retrieval UX.

## Recommended Product Status

- **Universal Capture:** Keep as the single visible reminder/note/question input.
- **Inbox:** Keep as the internal processing layer; no dedicated screen.
- **Brain Dump:** Removed from the active runtime.
- **Notes / Notebook:** Keep as core.
- **Saved Notes Sheet:** Keep but simplify.
- **Reminders:** Keep as core.
- **Reminder Creation Sheet:** Keep but simplify.
- **Folders:** Keep but simplify.
- **Categories:** Keep but simplify.
- **Assistant:** Keep but simplify.
- **Memory Coach:** Keep and evolve through explicit practice choices in the hidden Inbox domain; do not turn Notes or Reminders into cards.
- **Assistant Processing:** Merge into another feature.
- **Settings:** Keep but simplify.
- **Sync:** Keep as core.
- **Bottom Navigation:** Keep as core.
- **FAB / Floating Action Button:** Keep but simplify.
- **Search:** Keep as core.
