# Data Storage Map

## LocalStorage models

| Storage key | Data structure | Writers | Readers |
|---|---|---|---|
| `memoryCueState` | Object `{ schemaVersion, entries[], settings, ui }` | `state.js` (`save`, `addEntry`, updates) | `state.js`, root `assistant.js` (`loadEntriesFromState`) |
| `memoryEntries` | Array of inbox/capture entries (sometimes wrapped in `{ entries }` by tolerant readers) | `mobile.js` (`createInboxItem`), `js/entries.js` (`writeEntries`), `js/reminders.js` helper paths | `mobile.js` recall/search helpers, `js/entries.js`, `js/reminders.js`, `js/modules/daily-log.js` |
| `memoryCueNotes` | Array of note objects `{ id,title,body,bodyHtml,bodyText,updatedAt,... }` | `js/modules/notes-storage.js` (`saveAllNotes`), `mobile.js`, `js/reminders.js`, `js/entries.js`, `js/modules/ai-capture-save.js` | `js/modules/notes-storage.js` (`loadAllNotes`), `mobile.js`, `js/reminders.js`, `js/modules/daily-log.js`, inline `mobile.html` utility |
| `memoryCueFolders` | Array of folder objects `{ id,name,order }` | `js/modules/notes-storage.js`, `js/reminders.js` (reflection folder helper) | `js/modules/notes-storage.js`, `mobile.js`, `js/reminders.js` |
| `memoryCue:offlineReminders` | Array of reminder/task objects (offline source of truth for reminders UI) | `js/reminders.js` (`persistOfflineReminders`) | `js/reminders.js` (`loadOfflineRemindersFromStorage`) |
| `scheduledReminders` | Object map keyed by reminder id for notification scheduling metadata | `js/reminders.js` | `js/reminders.js`, `mobile.js` recall helper |
| `reminderEntries` | Array / wrapper used by inline mobile category/inbox helper script | Inline script in `mobile.html` (`writeEntries`) | Same inline script in `mobile.html` |
| `mc:lastDefaults` | Object for last used reminder defaults (category/priority) | `js/reminders.js` | `js/reminders.js` |
| `syncUrl` | String URL for external sync endpoint | `js/reminders.js`, `mobile.js` settings | `js/reminders.js`, `mobile.js` |
| `notesSyncDebug` | Flag string for notes sync debug mode | runtime/user-set value (checked in `mobile.js`) | `mobile.js` |
| `memory-cue-notes`, `mobileNotes` | Legacy note arrays migrated into `memoryCueNotes` | historical/legacy writers | `js/modules/notes-storage.js` migration logic |
| `dailyTasksByDate` | Object keyed by date for daily task lists | `js/modules/daily-tasks.js` | `js/modules/daily-tasks.js` |
| `memoryCue:plannerPlans` | Planner plan map | `js/modules/planner.js` | `js/modules/planner.js` |
| `memoryCue:plannerTimetable` | Planner timetable payload | `js/modules/planner.js` | `js/modules/planner.js` |

## IndexedDB usage

- `service-worker.js` opens IndexedDB for reminder scheduling persistence.
- Database/store purpose: persist scheduled reminders for background notification trigger handling.
- This IndexedDB layer is service-worker-owned and separate from localStorage `memoryCue:offlineReminders`.

## Specific requested identifiers

- `memoryCueState`: legacy shell state object (`state.js`).
- `memoryEntries`: inbox/capture entries used in mobile and helper flows.
- `memoryCueNotes`: main notes model used by notes-storage and multiple conversion paths.
- `offlineReminders`: implemented as key `memoryCue:offlineReminders` in `js/reminders.js`.
