# Data Storage Map

## LocalStorage models

| Storage key | Data structure | Writers | Readers |
|---|---|---|---|
| `memoryCueState` | Historical desktop-shell object `{ schemaVersion, entries[], settings, ui }` | No active writer remains (`state.js` has been removed) | No active reader remains |
| `memoryCueInbox` | Array of canonical Inbox/capture entries; opt-in Memory Coach cards use `metadata.type = "memory-card"` and `metadata.memoryCoach` | `src/services/inboxService.js` through the capture-service wrapper, trusted reminder conversion helpers, and `src/ui/mobileMemoryCoachUi.js` | Normal Inbox consumers receive filtered entries; Memory Coach, Firestore sync, and backup explicitly read the full array |
| `memoryEntries` | Legacy Inbox array or `{ entries }` wrapper | Historical writers only | `src/services/inboxService.js` for one-time migration when `memoryCueInbox` is empty |
| `memoryCueNotes` | Array of note objects `{ id,title,body,bodyHtml,bodyText,updatedAt,... }` | `js/modules/notes-storage.js` (`saveAllNotes`), `mobile.js`, `src/reminders/reminderController.js`, `js/modules/ai-capture-save.js` | `js/modules/notes-storage.js` (`loadAllNotes`), `mobile.js`, reminder recall |
| `memoryCueFolders` | Array of folder objects `{ id,name,order }` | `js/modules/notes-storage.js`, `js/reminders.js` (reflection folder helper) | `js/modules/notes-storage.js`, `mobile.js`, `js/reminders.js` |
| `memoryCue:offlineReminders` | Array of reminder/task objects (offline source of truth for reminders UI) | `js/reminders.js` (`persistOfflineReminders`) | `js/reminders.js` (`loadOfflineRemindersFromStorage`) |
| `scheduledReminders` | Object map keyed by reminder id for notification scheduling metadata | `js/reminders.js` | `js/reminders.js`, `mobile.js` recall helper |
| `mc:lastDefaults` | Object for last used reminder defaults (category/priority) | `js/reminders.js` | `js/reminders.js` |
| `syncUrl` | String URL for external sync endpoint | `js/reminders.js`, `mobile.js` settings | `js/reminders.js`, `mobile.js` |
| `notesSyncDebug` | Flag string for notes sync debug mode | runtime/user-set value (checked in `mobile.js`) | `mobile.js` |
| `memory-cue-notes`, `mobileNotes` | Legacy note arrays migrated into `memoryCueNotes` | historical/legacy writers | `js/modules/notes-storage.js` migration logic |
| `dailyTasksByDate` | Object keyed by date for daily task lists | `js/modules/daily-tasks.js` | `js/modules/daily-tasks.js` |
| `memoryCue:plannerPlans` | Planner plan map | `js/modules/planner.js` | `js/modules/planner.js` |
| `memoryCue:plannerTimetable` | Planner timetable payload | `js/modules/planner.js` | `js/modules/planner.js` |

## IndexedDB usage

- `service-worker-v3.js` opens IndexedDB for reminder scheduling persistence.
- Database/store purpose: persist scheduled reminders for background notification trigger handling.
- This IndexedDB layer is service-worker-owned and separate from localStorage `memoryCue:offlineReminders`.

## Specific requested identifiers

- `memoryCueState`: historical desktop-shell key with no active reader or writer.
- `memoryCueInbox`: canonical Inbox/capture store, including hidden opt-in Memory Coach cards. There is no separate practice key.
- `memoryEntries`: legacy input migrated into `memoryCueInbox`; no active writers remain.
- `memoryCueNotes`: main notes model used by notes-storage and multiple conversion paths; Memory Coach does not write here.
- `offlineReminders`: implemented as key `memoryCue:offlineReminders` in `js/reminders.js`.
