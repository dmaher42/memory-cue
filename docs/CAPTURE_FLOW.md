# Capture Flow (Phase 2)

## Canonical pipeline

All capture now follows one canonical path:

`captureInput(text, source)` → optional `/api/parse-entry` classification → inbox entry persisted to `memoryCueInbox` → conversion to reminder/note/assistant context.

## Capture service

File: `js/services/capture-service.js`

Exports:
- `captureInput(text, source)`
- `getInboxEntries()`
- `saveInboxEntry(entry)`
- `removeInboxEntry(id)`
- `convertInboxToNote(entryId)`

### Standard inbox entry shape

```js
{
  id: uuid,
  text: string,
  createdAt: timestamp,
  source: "capture|reminder|assistant|quick-add",
  parsedType: "note|reminder|unknown",
  metadata: {}
}
```

## Inbox storage model

- Single key: `memoryCueInbox`
- Reader/writer helpers are centralized in `capture-service.js`
- UI update event dispatched on inbox changes: `memoryCue:entriesUpdated`

## Conversion flows

### Inbox → Note

Use `convertInboxToNote(entryId)` from capture service.

- Creates note using existing `js/modules/notes-storage.js`
- Saves to `memoryCueNotes` through notes storage module
- Removes source inbox item from `memoryCueInbox`
- Dispatches `memoryCue:notesUpdated`

### Inbox → Reminder

Quick-add reminder flow remains immediate for speed:

1. `captureInput(text, 'quick-add')` writes inbox record
2. reminders module creates reminder directly

This preserves fast reminder creation while keeping inbox as canonical capture log.

## Assistant interaction

Assistant context now includes recent inbox captures from `memoryCueInbox` along with notes and reminders.

- mobile assistant recall reads inbox via `getInboxEntries()`.
- assistant context builder combines note recency and inbox recency.

## Deprecated capture paths

Legacy paths are marked with:

```js
/*
DEPRECATED CAPTURE PATH
Use capture-service.js instead.
*/
```

These remain for compatibility scaffolding, but capture writes should use `captureInput()`.
