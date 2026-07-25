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

### `mobile.js` assistant/capture hybrid logic
- Owns the universal thinking-bar submit handler and assistant thread UI.
- Maintains assistant thread UI and capture-intent routing.
- Uses local search helpers for "thinking bar" results.
- For assistant intent, routes requests through the shared capture/chat and assistant-orchestration services.
- Also includes weekly reflection summary generation and recall list support.

The unloaded `js/assistant.js` placeholder and the old root `assistant.js` desktop controller have been removed. There is no separate active assistant UI controller outside `mobile.js`.

## Memory retrieval logic

- **Server retrieval:**
  - `/api/assistant-chat` builds context from the client-supplied `inboxEntries`, `notes`, and `reminders`, selects top matches, and calls the OpenAI Responses API. (Retrieval that previously lived in the removed `/api/assistant`, `/api/chat`, and `/api/search` endpoints — person/keyword scoring, lexical similarity, synonym boosts — is now consolidated here.)

- **Client retrieval:**
  - `mobile.js` reads reminders, the canonical Inbox service/store (`memoryCueInbox`), and notes (`memoryCueNotes` via notes-storage) for recall/results surfaces.

## Assistant interactions with notes/reminders

- `mobile.js` capture flow may route text to reminder creation (`memoryCueQuickAddNow`) or Inbox depending on intent; this sits adjacent to assistant logic.
- Reminder-side assistant helpers call the shared `src/services/assistantOrchestrator.js`, which targets `/api/assistant-chat` and assembles reminder/note/Inbox context.
- Note creation from AI/capture is implemented via `js/modules/ai-capture-save.js` writing to `memoryCueNotes` and dispatching `memoryCue:notesUpdated`.
