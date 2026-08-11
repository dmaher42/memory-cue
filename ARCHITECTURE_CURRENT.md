# ARCHITECTURE_CURRENT (Phase 6)

Short internal map of the **currently active** paths so future sessions reuse existing systems instead of rebuilding them.

## Main chat flow
1. User sends text from the assistant/thinking input.
2. `sendAssistantMessage()` in `mobile.js` handles the submit.
3. The canonical capture pipeline selects a Reminder, Note, Inbox item, clarification, or assistant response.
4. Inbox writes go through `src/services/inboxService.js` to `memoryCueInbox`, and domain events refresh active consumers.

## Main intent flow
1. Freeform text enters through the universal `#thinkingBarInput` and the canonical capture pipeline.
2. Automated coverage and trusted internal compatibility callers can use the non-visual `quickAddNow({ forceText })` seam in `src/reminders/reminderController.js` for prefixes and reminder parsing.
3. Depending on route, the app creates either:
   - a reminder (`addItem()` / reminder payload path), or
   - a note path (e.g., reflection quick route), or
   - Inbox record (`memoryCueInbox`) as the fallback for ambiguous capture.

## Main reminder flow
1. Input enters through universal capture, the non-visual compatibility seam, or the structured reminder sheet.
2. Reminder data is normalized through creation helpers in `src/reminders/reminderController.js` (exported via `js/reminders.js`).
3. Reminders persist to the reminders offline store (`memoryCue:offlineReminders`) and render in reminders UI.
4. Existing reminder sync/scheduling paths run from the same module.

## Class Hubs inside Notes
1. A Class Hub is an existing Notes folder with `kind = "class-hub"`; there is no separate class store.
2. `src/ui/mobileClassHubsUi.js` lists hubs in Saved notes and opens the existing Notes editor with the hub folder already selected.
3. Class follow-ups are existing Reminder records linked by `metadata.classHubId` and shown in both the hub and Reminders.
4. Untimed class-list items set `metadata.suppressNotification = true`. A separate, explicitly dated `class-list-cue` reminder can prompt the user to check the hub.
5. A Class Hub's single `Add note` action reuses the universal `#thinkingBarInput` while the hub remains visible, then renders the review inside that hub. The explicit `organise_class_thought` task sends only the submitted note and class name to the existing `/api/assistant-chat` endpoint.
6. The assistant returns a runtime-only draft. No Note or Reminder is written until the user chooses `Save note and selected follow-ups`; confirmed Notes use the hub `folderId`, and confirmed follow-ups use the normal linked Reminder path with schedule parsing disabled.
7. Confirmed Notes enter the existing Notes search, memory mirror, embedding, and sync paths. This improves later retrieval; it is not model training and creates no new storage key.

## Main memory flow
1. Raw captures are stored in the canonical Inbox store (`memoryCueInbox`); legacy `memoryEntries` data is migrated by the Inbox service.
2. Notes are stored in `memoryCueNotes` (notebook domain).
3. Reminders are stored separately in reminder storage (`memoryCue:offlineReminders`).
4. Retrieval/assistant recall uses existing assistant/recall services (`js/services/assistant-service.js`, `js/services/recall-service.js`) plus UI readers.
5. A Word Help result becomes practice only after the user chooses `Learn`. The app creates a hidden Inbox entry with `metadata.type = "memory-card"` and `metadata.memoryCoach`.
6. `src/ui/mobileMemoryCoachUi.js` runs retrieval, clue, reveal, and self-rating inside Capture. `js/services/recall-service.js` calculates due items and the next interval without another AI call.
7. Review state is updated through `src/services/inboxService.js` and the existing Firestore Inbox sync. Normal Inbox readers, assistant recall, daily planning, Notes, and Reminders exclude memory-card entries.

## Current source of truth by domain
- **Inbox / raw capture:** `memoryCueInbox`, owned by `src/services/inboxService.js` (`memoryEntries` is migration-only).
- **Reminders:** `memoryCue:offlineReminders` + reminder module state/render path.
- **Notes / notebook memory:** `memoryCueNotes`.
- **Memory Coach cards and schedules:** opt-in hidden records inside `memoryCueInbox`; no separate storage key.
- **Folders/taxonomy for notes:** `memoryCueFolders`.
- **Class Hubs:** class-kind records in `memoryCueFolders`, ordinary Notes linked by `folderId`, and ordinary Reminders linked by `metadata.classHubId`.
- **Historical local keys with no active readers or writers:** `memoryCueState`, `memoryCueDB`, `brainDumpItems`, and `reminderEntries`. Do not reintroduce these parallel stores.

## Guardrail
When adding features, plug into one of the existing flows above. Do **not** add a new storage key or parallel intent pipeline unless a migration plan is explicitly documented.
