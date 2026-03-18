# Feature Inventory

| Feature Area | Current Purpose | Main Entry Point / UI | Data / Storage Used | Keep / Merge / Remove | Notes |
|---|---|---|---|---|---|
| Quick Add | Fast capture of text into reminders/inbox-style processing. | `#smartInputBar` + `#quickAddForm` + `#universalInput` in `mobile.html`; wired in `mobile.js` / `js/reminders.js`. | Local UI state + reminder/note pipelines (Firestore/Firebase depending on destination). | Keep but simplify | Appears to overlap with Brain Dump, Assistant input, and reminder sheet creation paths. |
| Inbox | Holding area for captured items before processing. | Inbox list/process actions in mobile inline scripts + dashboard/inbox grouping in modules. | Local note entries and inbox-tagged items; localStorage-backed note structures. | Merge into another feature | Feels close to Quick Add + Brain Dump + Assistant “save to inbox” behaviors. |
| Brain Dump | Ultra-fast scratch capture into a lightweight queue. | `#brainDumpFab`, `#brainDumpModal`, `#brainDumpTextarea` in `mobile.html`. | `localStorage` key `brainDumpItems`. | Merge into another feature | Very similar capture intent to Quick Add and Inbox. |
| Notes / Notebook | Core writing/editing and long-form note management. | Notebook view (`data-view="notebook"`), editor fields, note list and sheet flows in `mobile.html` + `mobile.js`. | `localStorage` notes (`memoryCueNotes`, legacy keys), optional Firebase sync. | Keep as core | This appears to be a central product surface. |
| Saved Notes Sheet | Overlay/sheet for browsing existing notes and folders. | Saved notes slide-in UI in `mobile.html` (saved-notes styles/sheet hooks) + handlers in `mobile.js`. | Same notes/folders storage as Notebook. | Keep but simplify | UX pattern overlaps with other sheets/modals (settings, reminder create, folder move). |
| Reminders | Create/manage timed reminders with categories/priorities and notifications. | Reminders view + list + quick actions in `mobile.html`; logic in `js/reminders.js`. | Firestore/Firebase reminder data + offline fallback (`memoryCue:offlineReminders`) + service worker schedule state. | Keep as core | One of two major app pillars (with Notebook). |
| Reminder Creation Sheet | Dedicated bottom-sheet flow for authoring reminders. | `#createReminderModal`, `#createReminderForm`, `#saveReminder` in `mobile.html`. | Writes into reminders data model handled by `js/reminders.js`. | Keep but simplify | Coexists with quick-add reminder creation and FAB-triggered flows. |
| Folders | Organize notes into user-defined buckets. | Folder sidebar/chips + move/rename/delete dialogs in notebook/saved-notes surfaces. | `localStorage` key `memoryCueFolders` (+ note `folderId` references), Firebase sync via notes payload. | Keep but simplify | Strongly tied to Notebook IA; avoid duplicate folder pickers. |
| Categories | Classify reminders (and possibly memory items) by topic/type. | Reminder category input (`#category` + `#categorySuggestions`) and seeded category logic in `js/reminders.js`. | Reminder fields + seeded in-code categories. | Keep but simplify | Potential taxonomy drift vs folder concepts and assistant memory “type/tags”. |
| Assistant | Conversational capture/retrieval helper and reflection tools. | Assistant view (`#assistantView`, `#assistantForm`, `#assistantInput`) in `mobile.html` + `mobile.js`/`js/assistant.js`. | Client context from notes/reminders; server endpoints for assistant/search/parse. | Keep but simplify | Useful differentiator, but input overlaps with other capture entry points. |
| Assistant Processing | Backend parsing, intent handling, and semantic-ish retrieval. | API routes: `api/assistant.ts`, `api/parse-entry.js`, `api/search.ts`, `api/chat.ts`, `api/capture.js`. | In-memory store utilities + OpenAI API calls + request payloads. | Merge into another feature | Processing is split across multiple endpoints with partially overlapping responsibilities. |
| Settings | Configuration controls (notably sync endpoint config). | `#settingsModal`, `#saveSyncSettings`, `#testSync`, `#syncAll` in `mobile.html`. | Local settings persistence + sync endpoint URL. | Keep but simplify | Primarily sync-focused; may not need a broad “settings” footprint yet. |
| Sync | Keep reminders/notes aligned across sessions/devices. | Notes sync init in `mobile.js` + `js/modules/notes-sync.js`; reminder sync in reminders module/service worker. | Firebase (notes), Firebase/Firestore (reminders), service worker notifications, online/offline listeners. | Keep as core | Critical trust feature; currently multi-path and complex. |
| Bottom Navigation | Primary mobile view switching and wayfinding. | `#mobile-nav-shell` with floating footer cards in `mobile.html`; nav handlers in inline script/`mobile.js`. | UI state only (`data-active-view`, classes). | Keep as core | Clear mobile affordance; should stay stable while other flows are consolidated. |
| FAB / Floating Action Button | Prominent action launcher (new reminder, brain dump, etc.). | `#mobile-fab-button`, `#mobile-fab-menu`, plus separate `#brainDumpFab`. | UI state + downstream write paths depending on selected action. | Keep but simplify | Two floating-action patterns exist (general FAB + dedicated Brain Dump FAB). |
| Search | Retrieve reminders/notes/context quickly across views. | Reminder search (`#searchReminders`), notebook/saved notes search inputs, assistant thinking/search events. | In-memory filtering + API search route (`api/search.ts`) + local note text fields. | Keep as core | Search appears fragmented by feature area rather than unified. |

## Suspected Overlaps

- Multiple ways to capture a new thought: Quick Add, Brain Dump modal, Assistant input, Reminder creation sheet, and FAB shortcuts.
- Overlapping note/reminder/inbox flows: items can enter via inbox-like capture, notes, reminders, and assistant-save behaviors.
- Multiple overlay/sheet patterns: saved notes sheet, reminder sheet, settings modal, move-folder sheet, note options sheet.
- Possible duplicate storage concepts: folders vs categories vs assistant tags/types.
- Split sync concepts: reminders and notes sync through different stacks, with additional offline/service-worker handling.
- Search is distributed across reminders, notebook, and assistant channels rather than one consistent retrieval UX.

## Recommended Product Status

- **Quick Add:** Keep but simplify.
- **Inbox:** Merge into another feature.
- **Brain Dump:** Merge into another feature.
- **Notes / Notebook:** Keep as core.
- **Saved Notes Sheet:** Keep but simplify.
- **Reminders:** Keep as core.
- **Reminder Creation Sheet:** Keep but simplify.
- **Folders:** Keep but simplify.
- **Categories:** Keep but simplify.
- **Assistant:** Keep but simplify.
- **Assistant Processing:** Merge into another feature.
- **Settings:** Keep but simplify.
- **Sync:** Keep as core.
- **Bottom Navigation:** Keep as core.
- **FAB / Floating Action Button:** Keep but simplify.
- **Search:** Keep as core.
