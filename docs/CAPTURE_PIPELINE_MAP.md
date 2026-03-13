# Capture Pipeline Map

## Search scope used
- `captureInput`
- `universalInput`
- `quickAddInput`
- `assistant capture`
- `saveUniversalInputBtn`

## Capture pathways and write targets

1. **Legacy desktop capture form**
   - Entry: `index.html` `#captureInput` + `#captureButton`.
   - Handler: root `assistant.js` `initCaptureSave()`.
   - Write target: `MemoryCueState.addEntry()` → localStorage key `memoryCueState`.

2. **Mobile universal capture / thinking bar**
   - Entry: `mobile.html` `#universalInput` (capture view), submitted via `#quickAddForm`.
   - Handler: `mobile.js` assistant/capture logic (`sendAssistantMessage`, `detectIntent`).
   - Write targets by intent:
     - Inbox path: localStorage `memoryEntries`.
     - Reminder path: `window.memoryCueQuickAddNow(...)` from reminders module.
     - Assistant path: submits to `#assistantForm` (handled by `js/assistant.js` to `/api/assistant`).

3. **Reminders quick-add**
   - Entry: `#quickAddInput` / `#quickAddForm` in reminders surface.
   - Handler: `js/reminders.js` quick-add handlers and `memoryCueQuickAddNow`.
   - Write targets:
     - Reminders list persisted to `memoryCue:offlineReminders`.
     - Scheduled notification mirror persisted to `scheduledReminders`.
     - Some smart-capture branches also write notes (`memoryCueNotes`) and inbox entries (`memoryEntries`).

4. **Reminder sheet open from quick-add triggers**
   - Entry points: `js/entries.js` quick form submit, FAB triggers in `mobile.html`, and cue events.
   - Handler: dispatches `open-reminder-sheet` / `cue:prepare` / `cue:open`.
   - Write target: reminder persistence in `js/reminders.js` (`memoryCue:offlineReminders`).

5. **Inbox item conversions (not raw capture but capture-adjacent)**
   - Entry: Inbox quick-actions in `js/entries.js`.
   - Actions:
     - "Create Reminder" opens reminder sheet (writes reminder store on save).
     - "Convert to Note" appends to notes storage (`memoryCueNotes`).

6. **Server capture API**
   - Entry: `POST /api/capture` with `{ schemaVersion: 2, input }`.
   - Handler: `api/capture.js` classifies + structures memory.
   - Write target: server-side `memory-store` via `addRecord(...)`.

## Search result note
- `saveUniversalInputBtn` was not found in the current repository scan.
