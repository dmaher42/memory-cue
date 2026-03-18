# Task 5 Internal Storage Writer/Reader Map

## Local key: `memoryCueNotes`
- **Writes**
  - `js/modules/notes-storage.js` via `saveAllNotes()` and `createAndSaveNote()`.
  - `js/entries.js` legacy capture bridge writes direct note list.
  - `src/reminders/reminderController.js` AI enrichment path updates note fields in-place.
  - `src/services/firebaseSyncService.js` remote pull/merge writes canonical local cache.
- **Reads**
  - `js/modules/notes-storage.js` (`loadAllNotes`).
  - `src/reminders/reminderController.js` note sync/enrichment paths.
  - `src/services/brainAgent.js` context loading.

## Local key: `memoryCueInbox`
- **Writes**
  - `src/services/inboxService.js` (`saveInboxEntry`, `persistInboxEntries`) canonical writer.
  - `js/entries.js` legacy inbox writer.
  - `src/services/firebaseSyncService.js` remote pull/merge writes canonical local cache.
- **Reads**
  - `src/services/inboxService.js` (`getInboxEntries`).
  - `js/modules/daily-log.js` and `js/entries.js` listeners/views.
  - `src/services/firebaseSyncService.js` merge helpers.

## Local key: `memoryCueCache`
- **Writes**
  - `src/services/memoryService.js` (`writeCacheToStorage`) through `saveMemory()` and sync merge.
- **Reads**
  - `src/services/memoryService.js` (`readCacheFromStorage`) and retrieval/search APIs.

## Local key: `memoryCue:offlineReminders`
- **Writes**
  - `src/reminders/reminderStore.js` canonical reminder offline storage.
  - `src/reminders/reminderController.js` one-time migration/flush helpers and offline fallback.
  - `src/services/firebaseSyncService.js` remote pull/merge writes canonical local cache.
- **Reads**
  - `src/reminders/reminderStore.js` (`getReminders`, `loadReminders`).
  - `src/reminders/reminderController.js` migration/offline upload paths.
  - `src/chat/chatManager.js` reminder query response helper.

## Firestore reminders/notes
- **Writes**
  - `src/reminders/reminderController.js` writes reminder docs and note docs (`users/{uid}/reminders`, `users/{uid}/notes`).
  - `js/modules/notes-sync.js` writes `users/{uid}/notes` migration/sync updates.
- **Reads**
  - `src/reminders/reminderController.js` note/reminder hydration from Firestore.
  - `js/modules/notes-sync.js` pulls note snapshots from Firestore.

## Firebase `memories`
- **Writes**
  - `src/services/memoryService.js` (`triggerSync` upsert to `memories`) from `saveMemory()`.
- **Reads**
  - `src/services/memoryService.js` (`triggerSync` select from `memories`).

## Safe duplicate/dead write cleanup applied
- Removed duplicate `saveMemory()` write in `src/services/adapters/notePersistenceAdapter.js`.
  - Notes now persist through `js/modules/notes-storage.js`, which mirrors successful note saves into `memoryService`.
- Added compatibility bridge in `js/modules/notes-storage.js` so note saves still use existing note storage/migrations/UI while ensuring memory-layer visibility for retrieval/search.
