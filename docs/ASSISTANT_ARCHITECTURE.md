# Assistant Architecture

## Assistant endpoints

The live serverless code is the Cloudflare Pages Functions under `functions/api/`.

1. **`POST /api/assistant-chat`** (`functions/api/assistant-chat.ts`)
   - Single assistant backend endpoint.
   - Accepts `message`, optional `history`, and client context (`inboxEntries`, `notes`, `reminders`).
   - Selects top context matches, builds the prompt, calls the OpenAI Responses API, and returns `reply` + `references` + `contextUsed`.

2. **`POST /api/parse-entry`** (`functions/api/parse-entry.js`) — capture/entry classification.

3. **`POST /api/embed`** (`functions/api/embed.ts`) — embeddings.

> Removed: the Vercel-era `POST /api/assistant` (`api/assistant.ts`), `POST /api/chat` (`api/chat.ts`), and `POST /api/search` (`api/search.ts`) endpoints no longer exist. Their intent-detection, chat, and keyword/synonym retrieval responsibilities are now consolidated in `functions/api/assistant-chat.ts`.

## Local assistant logic

### `js/assistant.js` (mobile page assistant form)
- Binds `#assistantForm` submit.
- Sends message payload to `/api/assistant-chat`.
- Appends user and assistant messages to `#assistantMessages`/`#assistantThread`.

### `mobile.js` assistant/capture hybrid logic
- Maintains assistant thread UI and capture-intent routing.
- Uses local search helpers for "thinking bar" results.
- For assistant intent, forwards captured text into assistant form submit flow.
- Also includes weekly reflection summary generation and recall list support.

### Root `assistant.js` (legacy app shell)
- Exposes `window.MemoryCueAssistant.askMemoryCue`.
- Builds local context from `memoryCueState` entries.
- Sends assistant questions to the assistant endpoint (now `/api/assistant-chat`; the legacy `/api/assistant` route it originally targeted has been removed) and has keyword fallback for offline/errors.

## Memory retrieval logic

- **Server retrieval:**
  - `/api/assistant-chat` builds context from the client-supplied `inboxEntries`, `notes`, and `reminders`, selects top matches, and calls the OpenAI Responses API. (Retrieval that previously lived in the removed `/api/assistant`, `/api/chat`, and `/api/search` endpoints — person/keyword scoring, lexical similarity, synonym boosts — is now consolidated here.)

- **Client retrieval:**
  - `mobile.js` reads reminders (`scheduledReminders`), inbox (`memoryEntries`), and notes (`memoryCueNotes` via notes-storage) for recall/results surfaces.
  - Legacy `assistant.js` filters and selects entries from `memoryCueState` before remote call/fallback.

## Assistant interactions with notes/reminders

- Assistant UI itself does not directly mutate reminders in `js/assistant.js`; it only requests `/api/assistant-chat`.
- `mobile.js` capture flow may route text to reminder creation (`memoryCueQuickAddNow`) or inbox depending on intent; this sits adjacent to assistant logic.
- `js/reminders.js` has an assistant request helper calling `/api/assistant-chat` in reminder-related experiences and merges reminders + notes + memory entries for RAG-like context assembly.
- Note creation from AI/capture is implemented via `js/modules/ai-capture-save.js` writing to `memoryCueNotes` and dispatching `memoryCue:notesUpdated`.
