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
- Reminders are persisted in the reminders module, mirrored in `localStorage.scheduledReminders`, and synced to service worker IndexedDB.
- Assistant conversation history is persisted in `sessionStorage.memoryCueAssistantConversation`.
- Legacy key `memoryEntries` is migrated to `memoryCueInbox` when inbox is first read.
