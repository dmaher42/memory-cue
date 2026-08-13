# Data Model

## InboxEntry
```json
{
  "id": "string",
  "text": "string",
  "createdAt": 0,
  "source": "capture|reminder|assistant|quick-add",
  "parsedType": "note|reminder|unknown",
  "metadata": {}
}
```

## Note
```json
{
  "id": "string",
  "title": "string",
  "body": "string",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "tags": [],
  "folderId": "string|null"
}
```

## Reminder
```json
{
  "id": "string",
  "title": "string",
  "due": "ISO-8601",
  "priority": "Low|Medium|High",
  "category": "string",
  "completed": false,
  "createdAt": 0
}
```

## ClassHubFolder and linked records
A Class Hub extends the existing Notes folder record. Notes remain ordinary Notes, and class follow-ups remain ordinary Reminders.

```json
{
  "folder": { "id": "class-y8-hpe", "name": "Year 8 HPE", "order": 4, "kind": "class-hub" },
  "note": { "folderId": "class-y8-hpe" },
  "followUpMetadata": {
    "type": "class-follow-up",
    "classHubId": "class-y8-hpe",
    "classHubName": "Year 8 HPE",
    "suppressNotification": true
  },
  "checkListCueMetadata": {
    "type": "class-list-cue",
    "classHubId": "class-y8-hpe",
    "classHubName": "Year 8 HPE",
    "suppressNotification": false
  }
}
```

The hub relationship uses the stable folder id, not the editable class name. A class-list cue must have a user-selected future date and time.

## MemoryCoachInboxEntry metadata
Memory Coach does not introduce a separate record store. A card is a hidden deferred-review Inbox entry with this additional metadata:

```json
{
  "metadata": {
    "type": "memory-card",
    "source": "word-rescue",
    "memoryCoach": {
      "schemaVersion": 1,
      "kind": "vocabulary",
      "prompt": "retrieval prompt without the answer",
      "answer": "word",
      "items": [],
      "orderMatters": false,
      "explanation": "short meaning",
      "example": "example sentence",
      "hints": [],
      "alternatives": [],
      "enabled": true,
      "dueAt": "ISO-8601",
      "lastReviewedAt": "ISO-8601|null",
      "lastRating": "forgot|hard|got_it|null",
      "stage": 0,
      "reviewCount": 0,
      "streak": 0,
      "lapses": 0,
      "history": []
    }
  }
}
```

Only an explicit practice action creates this metadata. A list card uses `kind: "list"`, stores up to 20 individual `items`, and records whether `orderMatters`. Review ratings update the single Inbox entry. Normal Inbox readers filter these cards, while full Inbox sync and backup retain them.

## AssistantConversation
```json
{
  "id": "string",
  "messages": [
    {
      "role": "user|assistant",
      "content": "string",
      "createdAt": "ISO-8601"
    }
  ],
  "lastUpdatedAt": "ISO-8601"
}
```

## Storage authority
- Inbox entries are persisted in `localStorage.memoryCueInbox`.
- Notes are persisted in `localStorage.memoryCueNotes` through `js/modules/notes-storage.js`.
- Class Hub definitions are class-kind records in `localStorage.memoryCueFolders`; their notes and follow-ups continue to use the existing Notes and Reminders stores.
- Memory Coach cards and schedules are opt-in hidden Inbox metadata inside `localStorage.memoryCueInbox`; there is no separate practice key and no Memory Coach write to Notes or Reminders.
- Reminders are persisted in the reminders module, mirrored in `localStorage.scheduledReminders`, and synced to service worker IndexedDB.
- Assistant conversation history is persisted in `sessionStorage.memoryCueAssistantConversation`.
- Legacy key `memoryEntries` is migrated to `memoryCueInbox` when inbox is first read.


## CanonicalMemoryEntry (memoryService)
```json
{
  "id": "string",
  "userId": "string",
  "text": "string",
  "type": "note|inbox|idea|task|reminder",
  "createdAt": 0,
  "updatedAt": 0,
  "source": "string",
  "entryPoint": "string",
  "tags": [],
  "embedding": [],
  "pendingSync": true
}
```

### `type` usage
- `note`: General note/reference content.
- `inbox`: Unprocessed capture awaiting triage.
- `idea`: Brainstorm/concept entries (including migrated `lesson_idea` and `coaching_drill`).
- `task`: Actionable item that is not a scheduled reminder.
- `reminder`: Scheduled/time-based commitment.

### Current note/inbox-like writers
- `src/services/inboxService.js#saveInboxEntry` (canonical inbox entry + memory write).
- `src/services/adapters/notePersistenceAdapter.js#saveNote` (note persistence + memory write).
- `js/services/capture-service.js` routes capture decisions to the two services above.
- `src/chat/chatManager.js` writes note/inbox through `saveNote` and `saveInboxEntry`.
- `src/ai/inboxProcessor.js` writes notes through `saveNote`.
- `src/reminders/reminderController.js` smart-entry note creation now writes through `saveNote`.
