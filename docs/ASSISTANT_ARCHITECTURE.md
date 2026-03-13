# Assistant Architecture

## Assistant endpoints

1. **`POST /api/assistant`** (`api/assistant.ts`)
   - Accepts `input` / `question` / `message`.
   - Detects intent: save, retrieve, search.
   - Save path classifies and stores via server `memory-store`.
   - Retrieve/search path ranks existing notes/memories and returns `reply` + `contextUsed`.

2. **`POST /api/chat`** (`api/chat.ts`)
   - Chat-oriented endpoint using OpenAI Responses API.
   - Accepts `message`, optional `history`, `memoryContext`, and `memoryEntries`.
   - Resolves and calls `/api/search` when no memory entries are supplied.
   - Builds prompt with conversation + memory notes and returns `reply`.

3. **`POST /api/search`** (`api/search.ts`)
   - Lightweight retrieval endpoint.
   - Uses keyword similarity + synonym semantic boost.
   - Returns top ranked notes in `{ results }`.

## Local assistant logic

### `js/assistant.js` (mobile page assistant form)
- Binds `#assistantForm` submit.
- Sends message payload to `/api/assistant`.
- Appends user and assistant messages to `#assistantMessages`/`#assistantThread`.

### `mobile.js` assistant/capture hybrid logic
- Maintains assistant thread UI and capture-intent routing.
- Uses local search helpers for "thinking bar" results.
- For assistant intent, forwards captured text into assistant form submit flow.
- Also includes weekly reflection summary generation and recall list support.

### Root `assistant.js` (legacy app shell)
- Exposes `window.MemoryCueAssistant.askMemoryCue`.
- Builds local context from `memoryCueState` entries.
- Sends assistant questions to `/api/assistant` (or configured endpoint) and has keyword fallback for offline/errors.

## Memory retrieval logic

- **Server retrieval:**
  - `/api/assistant` searches by person and/or keyword-scored notes from `memory-store` categories/all notes.
  - `/api/chat` optionally filters `memoryEntries`, otherwise calls `/api/search`.
  - `/api/search` ranks with lexical similarity + synonym boosts.

- **Client retrieval:**
  - `mobile.js` reads reminders (`scheduledReminders`), inbox (`memoryEntries`), and notes (`memoryCueNotes` via notes-storage) for recall/results surfaces.
  - Legacy `assistant.js` filters and selects entries from `memoryCueState` before remote call/fallback.

## Assistant interactions with notes/reminders

- Assistant UI itself does not directly mutate reminders in `js/assistant.js`; it only requests `/api/assistant`.
- `mobile.js` capture flow may route text to reminder creation (`memoryCueQuickAddNow`) or inbox depending on intent; this sits adjacent to assistant logic.
- `js/reminders.js` has an assistant request helper calling `/api/assistant` in reminder-related experiences and merges reminders + notes + memory entries for RAG-like context assembly.
- Note creation from AI/capture is implemented via `js/modules/ai-capture-save.js` writing to `memoryCueNotes` and dispatching `memoryCue:notesUpdated`.
