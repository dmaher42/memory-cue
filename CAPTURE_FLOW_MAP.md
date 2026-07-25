# CAPTURE_FLOW_MAP

## 1) Capture Entry Points

| Feature | File location | Handler / function | User input | Created object / payload |
|---|---|---|---|---|
| Universal capture bar (sole visible freeform capture) | `mobile.html` (`#thinkingBarForm`, `#thinkingBarInput`), `mobile.js`, `src/chat/chatManager.js`, `src/core/capturePipeline.js` | `sendAssistantMessage()` -> `handleChatMessage()` -> canonical `captureInput()` | Freeform reminder, note, or question text | A reminder, note, Inbox record, clarification, or assistant response selected by the canonical capture decision |
| Programmatic reminder compatibility seam | `src/reminders/reminderController.js` (exported through `js/reminders.js`) | `memoryCueQuickAddNow({ forceText, ...options })` | Text supplied by automated coverage or a trusted internal caller | Reminder object plus its existing mirrored Inbox provenance; prefix routes can create a reflection note |
| Programmatic prefix route: `reflection:` | `src/reminders/reminderController.js` | `parseQuickAddPrefixRoute()` -> `saveReflectionQuickNote()` | Internal conversion text prefixed with `reflection:` | A **note-like** record written directly to `memoryCueNotes` (reflection folder) |
| Programmatic prefix route: `task:` / `footy drill:` | `src/reminders/reminderController.js` | `parseQuickAddPrefixRoute()` -> `buildQuickReminder()` -> reminder creation | Internal conversion text prefixed with task/drill route | Reminder object with forced category (`Tasks` / `Footy – Drills`) |
| Reminder creation sheet (full form) | `js/reminders.js`, sheet wiring in `mobile.js` | `handleSaveAction()` -> `addItem()` / `createReminderFromPayload()` | Title, date/time, notes, priority, category, planner link | Reminder item in reminders collection (`items` in memory, persisted offline/synced) |
| Reminder creation via FAB/menu/footer CTA | `mobile.html` + `mobile.js` + `js/reminders.js` | FAB `data-fab-action='new-reminder'` -> `openNewReminderSheet()` -> save uses `handleSaveAction()` | Form values after sheet opens | Same reminder object as reminder sheet flow |
| Note editor “New note” flow | `mobile.js` | `startNewNoteFromUI()` -> editor -> save button handler | Note title/body in notebook editor | Note object from `createNote()` then persisted via `saveAllNotes()` |
| Note autosave flow | `mobile.js` | debounced autosave -> `saveButton.click()` -> same save handler | Ongoing edits in note title/body | Same note object/update path as manual save |
| AI capture save utility (programmatic note creation) | `js/modules/ai-capture-save.js`, fallback in `mobile.js` | `saveCapturedEntryAsNote()` | Structured capture entry (title/body/folder/metadata) from programmatic callers | Note object with metadata (`aiCaptured`, `aiConfidence`, tags, action date, etc.) persisted into notes |

---

## 2) Storage Locations

| Storage location | Key / table | Data shape (observed) | Written by | Semantic role |
|---|---|---|---|---|
| LocalStorage | `memoryCueInbox` | Array of normalized Inbox items (for example `{ id, text, status, parsedType, source, createdAt, updatedAt }`) | `src/services/inboxService.js` through the canonical capture pipeline and trusted conversion helpers | Inbox / raw capture stream |
| LocalStorage | `memoryEntries` | Legacy Inbox payload accepted only for one-time migration | Read and migrated by `src/services/inboxService.js` when `memoryCueInbox` is empty | Migration compatibility, not an active writer path |
| LocalStorage | `memoryCueNotes` | Array of note objects (`id`, `title`, `body/bodyHtml/bodyText`, `createdAt`, `updatedAt`, `folderId`, metadata...) | Notebook save (`saveAllNotes`), programmatic reflection conversion, smart entry creation, AI capture save | Notes |
| LocalStorage | `memoryCueFolders` | Array of folder records (`id`, `name`, `order`) | Folder creation/ensure flows in notes/reminders modules | Folder taxonomy |
| LocalStorage | `memoryCue:offlineReminders` | Array of normalized reminder objects (`id`, `title`, `priority`, `category`, `notes`, `done`, `due`, `pendingSync`, etc.) | Reminder `persistItems()` | Reminders (offline primary cache) |
| LocalStorage | `scheduledReminders` | Object keyed by reminder id with schedule metadata (`due`, `notifyAt`, trigger fields, etc.) | Reminder scheduling subsystem | Reminder scheduling state |
| LocalStorage | `mc:lastDefaults` | Last-used reminder defaults (`priority`, `category`, etc.) | Reminder defaults helpers | Reminder UX defaults (not capture content) |
| LocalStorage | `syncUrl` | URL string for external webhook sync | Reminder settings UI | Integration setting |
| LocalStorage | `memoryCueDB` | Structured assistant DB shape with `schemaVersion`, `settings`, `memoryEntries/entries` | Read by root `assistant.js` (legacy assistant context path) | Assistant context store (separate layer) |
| Firebase (remote) | `notes` table (default) | Upserted note rows: `id`, `user_id`, `title`, `body`, `body_html`, `body_text`, `folder_id`, `updated_at` | Notes sync (`notes-sync` via remote sync handler in notes storage) | Remote notes sync |
| Firebase Firestore (remote) | `users/{userId}/reminders/{id}` | Reminder document with title, due, category, done, timestamps, etc. | `saveToFirebase()` in reminders module | Remote reminders sync |
| IndexedDB (via Firebase SDK persistence) | Firestore client persistence | Firestore offline cache (SDK-managed) | Firebase init (`enableMultiTabIndexedDbPersistence` / `enableIndexedDbPersistence`) | Offline persistence layer for reminders sync |
| In-memory runtime | `items` array in reminders module | Active reminder list objects | `createReminderFromPayload()`, edits/toggles/reorder | Working reminder state |
| In-memory runtime | `scheduledReminders` object | Runtime schedule map keyed by reminder id | Scheduling functions (`scheduleReminder`, `saveScheduled`) | Notification scheduling state |

---

## 3) Capture Pipelines

### A) Universal capture (default text)

User enters text in the fixed `#thinkingBarInput`
↓
`mobile.js` calls `handleChatMessage()`, which routes through the canonical capture pipeline
↓
The pipeline chooses reminder, note, Inbox/clarification, or assistant response
↓
The relevant domain writer persists the result and the shared UI reports the outcome.

### B) Programmatic reminder compatibility seam

Automated coverage or a trusted internal caller supplies `forceText`
↓
`memoryCueQuickAddNow()` parses route/time/classification
↓
Reminder path creates and persists the reminder; `reflection:` creates a note instead
↓
Events refresh the reminder UI. This seam has no separate input, buttons, voice control, or keyboard shortcut.

### C) Reminder sheet create flow

User opens reminder sheet from FAB/footer/CTA and enters structured fields  
↓  
Save button -> `handleSaveAction()`  
↓  
`addItem()` -> `createReminderFromPayload()`  
↓  
Writes reminder to `items` + `memoryCue:offlineReminders`; sync attempts to Firestore  
↓  
UI rerender + schedule update + reminder update events.

### D) Notebook note creation flow

User taps New Note (button/footer/FAB) and edits title/body  
↓  
`startNewNoteFromUI()` opens draft editor  
↓  
Save button (or autosave) builds note via `createNote()`  
↓  
`saveAllNotes()` writes to `memoryCueNotes` and optionally remote Firebase sync handler  
↓  
Notebook refreshes from storage and emits note update behavior.

---

## 4) Duplicate Capture Paths

1. **Programmatic reflection route vs Notebook new-note flow**
   Both create notes directly in `memoryCueNotes`, but one is an internal prefixed conversion and the other is explicit note editing.

2. **Reminder sheet vs universal capture reminder route**
   Both create reminders, but one is structured form capture and the other is natural-language capture; both ultimately hit reminder storage.

3. **Legacy assistant DB (`memoryCueDB`) vs modern storage**
   Assistant context reader expects a separate DB key/schema, creating another parallel memory representation.

---

## 5) Capture Rule Violations

Against target rules:

- **Rule: Inbox must be single raw capture store.**  
  The active mobile capture path now writes through the Inbox service to `memoryCueInbox`. `memoryEntries` is migration-only; `brainDumpItems` and `reminderEntries` have no active readers or writers.

- **Rule: Notes must hold long-form writing.**  
  The trusted `reflection:` compatibility route can still create a note directly because the prefix expresses explicit note intent.

- **Rule: Reminders must hold actionable items with due dates.**  
  The canonical pipeline protects this intent boundary, but trusted programmatic conversion callers must still avoid sending generic text as a reminder.

- **Rule: Assistant must not create its own storage layer.**  
  The legacy desktop assistant read path keyed on `memoryCueDB` remains a separate cleanup item; the retired category processor no longer adds another store.

---

## 6) Recommended Capture Architecture

Desired canonical path:

```text
User capture
↓
src/core/capturePipeline.js (single normalization entry)
↓
src/services/inboxService.js → memoryCueInbox when intent is ambiguous
↓
User/Assistant triage
↓
Convert to Note or Reminder
```

### Redirect plan by existing flow

- **Universal capture:** continue using the canonical classifier and Inbox-first clarification where intent is uncertain.
- **Universal thinking bar:** keep it routed through the shared capture module for identical shape and validation.
- **Reminder sheet:** can still create reminders directly (explicit intent), but optionally record provenance reference to source Inbox item when conversion came from capture.
- **Note editor/New Note:** remains direct note creation (explicit writing intent), outside raw capture stream.
- **AI capture save utility:** treat as a conversion endpoint (Inbox -> Note), not a parallel capture origin.

---

## 7) Risk Areas

1. **Autosave interactions in notebook**  
   Refactoring shared capture/event plumbing can accidentally trigger extra saves or stale note snapshots.

2. **Programmatic conversion dual-write behavior**
   The internal conversion seam can write a reminder plus mirrored Inbox provenance; consolidating it could change conversion expectations.

3. **Reminder scheduling side effects**  
   Reminder creation triggers scheduling, offline cache updates, and remote sync; routing changes must preserve these side effects.

4. **Assistant enrichment race conditions**
   AI enrichment updates reminders/notes asynchronously after initial save; centralizing capture must not drop delayed updates.

5. **Remote sync divergence**
   Notes (Firebase) and reminders (Firestore) have separate sync lifecycles; conversion paths must avoid duplicate creation or sync loops.

6. **Universal input interactions**
   Enter submit and the universal microphone must continue to target `#thinkingBarInput`; there is no reminder-only keyboard or voice path.

### Post-refactor test focus

- Universal text, Enter submit, and voice capture all route through the same visible input and canonical pipeline.
- The removed reminder-only form is absent, while the non-visual reminder compatibility seam still works through `forceText`.
- Explicit reminder sheet create still schedules notifications and syncs.
- Converting inbox item -> note/reminder does not duplicate records.
- Notebook autosave and manual save remain stable.
- No retired Inbox/Categories view, script, or `reminderEntries` writer is present in the production shell.
