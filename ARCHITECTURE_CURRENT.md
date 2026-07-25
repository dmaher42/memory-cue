# ARCHITECTURE_CURRENT (Phase 6)

Short internal map of the **currently active** paths so future sessions reuse existing systems instead of rebuilding them.

## Main chat flow
1. User sends text from the assistant/thinking input.
2. `sendAssistantMessage()` in `mobile.js` handles the submit.
3. Capture is written to `memoryEntries` (inbox-style raw capture).
4. UI refresh/event dispatch updates views that read capture entries.

## Main intent flow
1. Freeform text enters through the universal `#thinkingBarInput` and the canonical capture pipeline.
2. Reminder conversions can call the non-visual `quickAddNow({ forceText })` seam in `src/reminders/reminderController.js` for prefixes and reminder parsing.
3. Depending on route, the app creates either:
   - a reminder (`addItem()` / reminder payload path), or
   - a note path (e.g., reflection quick route), or
   - inbox/raw capture record (`memoryEntries`) as fallback/parallel capture.

## Main reminder flow
1. Input enters through universal capture, Inbox conversion, or the structured reminder sheet.
2. Reminder data is normalized through creation helpers in `src/reminders/reminderController.js` (exported via `js/reminders.js`).
3. Reminders persist to the reminders offline store (`memoryCue:offlineReminders`) and render in reminders UI.
4. Existing reminder sync/scheduling paths run from the same module.

## Main memory flow
1. Raw captures are stored in inbox-like local storage (`memoryEntries`).
2. Notes are stored in `memoryCueNotes` (notebook domain).
3. Reminders are stored separately in reminder storage (`memoryCue:offlineReminders`).
4. Retrieval/assistant recall uses existing assistant/recall services (`js/services/assistant-service.js`, `js/services/recall-service.js`) plus UI readers.

## Current source of truth by domain
- **Inbox / raw capture:** `memoryEntries` (primary active store).
- **Reminders:** `memoryCue:offlineReminders` + reminder module state/render path.
- **Notes / notebook memory:** `memoryCueNotes`.
- **Folders/taxonomy for notes:** `memoryCueFolders`.
- **Legacy/parallel stores still present (do not duplicate further):** `brainDumpItems`, `reminderEntries`, `memoryCueDB`.

## Guardrail
When adding features, plug into one of the existing flows above. Do **not** add a new storage key or parallel intent pipeline unless a migration plan is explicitly documented.
