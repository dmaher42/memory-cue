# Capture Pipeline Map

## Search scope used
- `captureInput`
- `thinkingBarInput`
- `memoryCueQuickAddNow`
- `assistant capture`
- `saveUniversalInputBtn`

## Capture pathways and write targets

1. **Legacy desktop capture form**
   - Entry: `index.html` `#captureInput` + `#captureButton`.
   - Handler: root `assistant.js` `initCaptureSave()`.
   - Write target: `MemoryCueState.addEntry()` → localStorage key `memoryCueState`.

2. **Mobile universal capture / thinking bar**
   - Entry: fixed `mobile.html` `#thinkingBarInput`, submitted via `#thinkingBarForm` from any primary view.
   - Handler: `mobile.js` calls `handleChatMessage()`, which uses the canonical capture pipeline.
   - Write targets by intent:
     - Inbox path: localStorage `memoryEntries`.
     - Reminder path: `window.memoryCueQuickAddNow(...)` from reminders module.
     - Note and assistant paths: handled by the same capture/chat routing layer.

3. **Programmatic reminder conversion seam**
   - Entry: `window.memoryCueQuickAddNow({ forceText, ...options })`; there is no separate reminder quick-add form in the UI.
   - Handler: `src/reminders/reminderController.js`, exposed through `js/reminders.js`.
   - Write targets:
     - Reminders list persisted to `memoryCue:offlineReminders`.
     - Scheduled notification mirror persisted to `scheduledReminders`.
     - Prefix routes can also write notes (`memoryCueNotes`) and mirrored inbox entries (`memoryEntries`).

4. **Reminder sheet open triggers**
   - Entry points: explicit add/FAB controls in `mobile.html`, Inbox actions, and cue events.
   - Handler: dispatches `open-reminder-sheet` / `cue:prepare` / `cue:open`, then the reminder controller opens `#create-sheet`.
   - Write target: reminder persistence in `js/reminders.js` (`memoryCue:offlineReminders`).

5. **Inbox item conversions (not raw capture but capture-adjacent)**
   - Entry: Inbox quick-actions in `js/entries.js`.
   - Actions:
     - "Create Reminder" opens reminder sheet (writes reminder store on save).
     - "Convert to Note" appends to notes storage (`memoryCueNotes`).

6. **Server capture API**
   - Removed: the Vercel-era `POST /api/capture` endpoint (`api/capture.js`) no longer exists.
   - Live serverless entry/classification is now `POST /api/parse-entry` (`functions/api/parse-entry.js`).

## Search result note
- `saveUniversalInputBtn` was not found in the current repository scan.
