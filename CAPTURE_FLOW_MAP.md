# CAPTURE_FLOW_MAP

## 1) Capture Entry Points

| Feature | File location | Handler / function | User input | Created object / payload |
|---|---|---|---|---|
| Smart Input / Quick Add bar (primary capture bar) | `mobile.html` (`#quickAddForm`, `#universalInput`), `mobile.js`, `js/reminders.js` | `quickAddNow()` in reminders module (invoked by submit/click/Enter wiring) | Freeform text in `universalInput` / `quickAddInput` | Usually a reminder object via `addItem()`/`createReminderFromPayload()` (`id`, `title`, `priority`, `category`, `notes`, `due`, etc.) **plus** a separate inbox-style `memoryEntries` record via `saveBrainDumpEntry()` |
| Quick Add prefix route: `reflection:` | `js/reminders.js` | `parseQuickAddPrefixRoute()` -> `saveReflectionQuickNote()` | Text prefixed with `reflection:` | A **note-like** record written directly to `memoryCueNotes` (reflection folder) |
| Quick Add prefix route: `task:` / `footy drill:` | `js/reminders.js` | `parseQuickAddPrefixRoute()` -> `buildQuickReminder()` -> `addItem()` | Text prefixed with task/drill route | Reminder object with forced category (`Tasks` / `Footy – Drills`) |
| Quick Add voice capture | `js/reminders.js` | `handleVoiceReminderTranscript()` -> `quickAddNow({ text, dueDate, notifyAt })` | Speech transcript | Same as Quick Add flow: reminder item + `memoryEntries` item |
| Quick Add keyboard submit | `js/reminders.js` | `quickInput` keydown Enter + `quickForm` submit -> `quickAddNow()` | Enter on quick input | Same as Quick Add flow |
| Assistant thinking bar “Send” (capture-to-inbox behavior) | `mobile.js` | `sendAssistantMessage()` | Text in thinking bar / universal input | Inbox/capture object written to `memoryEntries` (`text`, `type`, `timestamp`, `createdAt`, `date`, `source`) |
| Brain Dump modal | `mobile.html` inline script | `saveBrainDump()` | Freeform textarea text | `brainDumpItems` item (`text`, `type: 'inbox'`, `processed`, `timestamp`) |
| Reminder creation sheet (full form) | `js/reminders.js`, sheet wiring in `mobile.js` | `handleSaveAction()` -> `addItem()` / `createReminderFromPayload()` | Title, date/time, notes, priority, category, planner link | Reminder item in reminders collection (`items` in memory, persisted offline/synced) |
| Reminder creation via FAB/menu/footer CTA | `mobile.html` + `mobile.js` + `js/reminders.js` | FAB `data-fab-action='new-reminder'` -> `openNewReminderSheet()` -> save uses `handleSaveAction()` | Form values after sheet opens | Same reminder object as reminder sheet flow |
| Note editor “New note” flow | `mobile.js` | `startNewNoteFromUI()` -> editor -> save button handler | Note title/body in notebook editor | Note object from `createNote()` then persisted via `saveAllNotes()` |
| Note autosave flow | `mobile.js` | debounced autosave -> `saveButton.click()` -> same save handler | Ongoing edits in note title/body | Same note object/update path as manual save |
| AI capture save utility (programmatic note creation) | `js/modules/ai-capture-save.js`, fallback in `mobile.js` | `saveCapturedEntryAsNote()` | Structured capture entry (title/body/folder/metadata) from programmatic callers | Note object with metadata (`aiCaptured`, `aiConfidence`, tags, action date, etc.) persisted into notes |
| Legacy inbox/categories panel processing | `mobile.html` inline script | `processInboxEntries()` + `appendProcessedEntriesToNotebook()` | Existing inbox entry set (`reminderEntries`) processed via assistant API | Updates `reminderEntries` as processed, and creates notebook notes in `memoryCueNotes` |
| Legacy category/inbox inline editing | `mobile.html` inline script | prompt edit / swipe delete / long-press pin handlers | Manual edits on rendered inbox entries | Mutations to `reminderEntries` |

---

## 2) Storage Locations

| Storage location | Key / table | Data shape (observed) | Written by | Semantic role |
|---|---|---|---|---|
| LocalStorage | `memoryEntries` | Array of inbox/capture items (e.g. `{ id?, text, status?, type, context?, person?, createdAt, date, source?, processed? }`) | `quickAddNow()` helper (`saveBrainDumpEntry`), assistant thinking bar `sendAssistantMessage()`, other inbox utilities | Inbox / raw capture stream |
| LocalStorage | `brainDumpItems` | Array of `{ text, type: 'inbox', processed, timestamp }` | Brain Dump modal `saveBrainDump()` | Separate raw capture store (duplicate inbox channel) |
| LocalStorage | `memoryCueNotes` | Array of note objects (`id`, `title`, `body/bodyHtml/bodyText`, `createdAt`, `updatedAt`, `folderId`, metadata...) | Notebook save (`saveAllNotes`), reflection quick-add, smart entry creation, inbox processing script, AI capture save | Notes |
| LocalStorage | `memoryCueFolders` | Array of folder records (`id`, `name`, `order`) | Folder creation/ensure flows in notes/reminders modules | Folder taxonomy |
| LocalStorage | `memoryCue:offlineReminders` | Array of normalized reminder objects (`id`, `title`, `priority`, `category`, `notes`, `done`, `due`, `pendingSync`, etc.) | Reminder `persistItems()` | Reminders (offline primary cache) |
| LocalStorage | `scheduledReminders` | Object keyed by reminder id with schedule metadata (`due`, `notifyAt`, trigger fields, etc.) | Reminder scheduling subsystem | Reminder scheduling state |
| LocalStorage | `reminderEntries` (legacy script) | Array of category/inbox entries used by categories panel (`text/title/content`, `processed`, `category`, `type`, etc.) | Inline categories/inbox script in `mobile.html` | Legacy inbox-like store |
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

### A) Quick Add (default text)

User enters quick-add text  
↓  
`quickAddNow()` parses route/time/classification  
↓  
`addItem()` -> `createReminderFromPayload()` creates reminder object  
↓  
Reminder path writes: `items` memory -> `persistItems()` -> `memoryCue:offlineReminders`; then `saveToFirebase()` best-effort  
↓  
Parallel raw capture path: `saveBrainDumpEntry()` prepends raw text into `memoryEntries`  
↓  
UI refresh/events: `render()`, reminder update events, quick-add success indicator.

### B) Quick Add `reflection:` route

User enters `reflection: ...`  
↓  
`parseQuickAddPrefixRoute()` returns `kind='reflection'`  
↓  
`saveReflectionQuickNote()` creates note object + ensures reflection folder  
↓  
Writes directly to `memoryCueNotes` (and `memoryCueFolders` if needed)  
↓  
No reminder created; raw capture still saved to `memoryEntries` by `saveBrainDumpEntry()`.

### C) Voice quick add

User records voice  
↓  
Speech result -> `handleVoiceReminderTranscript()` (optional natural date parsing)  
↓  
Calls `quickAddNow({ text, dueDate, notifyAt })`  
↓  
Then follows the same branches as A/B.

### D) Reminder sheet create flow

User opens reminder sheet from FAB/footer/CTA and enters structured fields  
↓  
Save button -> `handleSaveAction()`  
↓  
`addItem()` -> `createReminderFromPayload()`  
↓  
Writes reminder to `items` + `memoryCue:offlineReminders`; sync attempts to Firestore  
↓  
UI rerender + schedule update + reminder update events.

### E) Assistant thinking bar capture flow

User submits text in thinking bar / smart bar submit wired in `mobile.js`  
↓  
`sendAssistantMessage()` (despite name, this path is capture-to-inbox)  
↓  
Builds capture object (`text`, timestamp, date, source)  
↓  
Writes to `memoryEntries`  
↓  
Dispatches `memoryCue:entriesUpdated`, clears input, updates status.

### F) Brain Dump modal flow

User opens Brain Dump modal and saves text  
↓  
`saveBrainDump()`  
↓  
Creates lightweight item (`text`, `type`, `processed`, `timestamp`)  
↓  
Writes to `brainDumpItems`  
↓  
Clears textarea and closes modal (no central inbox event/normalization).

### G) Notebook note creation flow

User taps New Note (button/footer/FAB) and edits title/body  
↓  
`startNewNoteFromUI()` opens draft editor  
↓  
Save button (or autosave) builds note via `createNote()`  
↓  
`saveAllNotes()` writes to `memoryCueNotes` and optionally remote Firebase sync handler  
↓  
Notebook refreshes from storage and emits note update behavior.

### H) Legacy categories “Process Inbox” flow

User taps Process Inbox in category panel (legacy script)  
↓  
Reads `reminderEntries` unprocessed entries  
↓  
Posts to `/api/assistant` for classification/rewrite  
↓  
Writes processed state back to `reminderEntries`  
↓  
`appendProcessedEntriesToNotebook()` converts processed entries into notes and writes `memoryCueNotes`.

---

## 4) Duplicate Capture Paths

1. **Quick Add vs Assistant thinking bar**  
   Both accept freeform text and write raw capture-like records to `memoryEntries`, but through different handlers and object shapes.

2. **Quick Add raw capture vs Brain Dump modal**  
   Both are “dump text quickly” interactions, but Quick Add stores in `memoryEntries` while Brain Dump stores in `brainDumpItems`.

3. **Quick Add reflection route vs Notebook new-note flow**  
   Both create notes directly in `memoryCueNotes`, but one is implicit from a prefixed quick-add command and the other is explicit note editing.

4. **Reminder sheet vs Quick Add default route**  
   Both create reminders, but one is structured form capture and the other is natural-language quick capture with fallback parsing; both ultimately hit reminder storage.

5. **Legacy `reminderEntries` inbox vs `memoryEntries` inbox**  
   Two different inbox-like stores are active in code, with separate read/write and processing logic.

6. **Legacy assistant DB (`memoryCueDB`) vs modern storage**  
   Assistant context reader expects a separate DB key/schema, creating another parallel memory representation.

---

## 5) Capture Rule Violations

Against target rules:

- **Rule: Inbox must be single raw capture store.**  
  Violated by parallel raw stores: `memoryEntries`, `brainDumpItems`, and `reminderEntries`.

- **Rule: Notes must hold long-form writing.**  
  Partially violated by quick pipelines writing short raw captures directly into notes (`saveReflectionQuickNote`, legacy processed-entry note append) without unified inbox-first path.

- **Rule: Reminders must hold actionable items with due dates.**  
  Partially violated because quick-add creates reminders from generic freeform text even when no due/action semantics exist.

- **Rule: Assistant must not create its own storage layer.**  
  Violated by legacy assistant read path keyed on `memoryCueDB` (separate schema), and by legacy category processing script writing its own intermediary store (`reminderEntries`) before note conversion.

---

## 6) Recommended Capture Architecture

Desired canonical path:

```text
User capture
↓
capture.js (single normalization entry)
↓
Inbox item (single store, e.g. memoryEntries)
↓
User/Assistant triage
↓
Convert to Note or Reminder
```

### Redirect plan by existing flow

- **Quick Add (all variants):** always create normalized Inbox item first; optional immediate classifier can propose conversion, but should not bypass Inbox.
- **Brain Dump modal:** write to same Inbox store + same event bus, retire `brainDumpItems`.
- **Assistant thinking bar:** keep as Inbox writer, but route through shared capture module for identical shape/validation.
- **Reminder sheet:** can still create reminders directly (explicit intent), but optionally record provenance reference to source Inbox item when conversion came from capture.
- **Note editor/New Note:** remains direct note creation (explicit writing intent), outside raw capture stream.
- **Legacy `reminderEntries` processor:** migrate to read from Inbox store and output conversion actions; remove standalone key.
- **AI capture save utility:** treat as a conversion endpoint (Inbox -> Note), not a parallel capture origin.

---

## 7) Risk Areas

1. **Autosave interactions in notebook**  
   Refactoring shared capture/event plumbing can accidentally trigger extra saves or stale note snapshots.

2. **Quick Add dual-write behavior**  
   Current flow writes reminder + `memoryEntries`; consolidating this could change UI expectations (e.g., inbox cards appearing immediately).

3. **Reminder scheduling side effects**  
   Reminder creation triggers scheduling, offline cache updates, and remote sync; routing changes must preserve these side effects.

4. **Legacy inbox/category panel dependencies**  
   Existing UI reads `reminderEntries`; removing/repointing it can break category cards, edit/delete/pin gestures, and Process Inbox.

5. **Assistant enrichment race conditions**  
   AI enrichment updates reminders/notes asynchronously after initial save; centralizing capture must not drop delayed updates.

6. **Remote sync divergence**  
   Notes (Firebase) and reminders (Firestore) have separate sync lifecycles; conversion paths must avoid duplicate creation or sync loops.

7. **Keyboard/voice shortcuts**  
   Enter submit, voice transcript auto-submit, and `/`/`q` focus shortcuts must still target the new unified capture entry point.

### Post-refactor test focus

- Quick add text, Enter submit, and voice capture all create identical inbox objects.
- Brain Dump and assistant capture produce same inbox schema/events.
- Explicit reminder sheet create still schedules notifications and syncs.
- Converting inbox item -> note/reminder does not duplicate records.
- Notebook autosave and manual save remain stable.
- Legacy panel behavior is either preserved via adapter or safely removed with replacement UI.
