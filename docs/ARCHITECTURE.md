# Memory Cue Architecture (Canonical)

## Layered architecture
UI Layer
→ Capture Service
→ Inbox Storage
→ Notes / Reminders Services
→ Assistant Service
→ Persistence Layer
→ Service Worker

## Core services
- **UI Layer (`mobile.html`, `mobile.js`)**: primary runtime shell and interaction surfaces.
- **Capture Service (`js/services/capture-service.js`)**: canonical ingestion path (`captureInput`) and inbox storage access.
- **Notes Service (`js/modules/notes-storage.js`)**: note CRUD and folder metadata.
- **Reminders Service (`js/reminders.js`)**: reminder CRUD, scheduling, and service worker sync messaging.
- **Assistant Service (`js/services/assistant-service.js`)**: single assistant UI controller and request orchestrator.
- **Assistant API (`api/assistant-chat.ts`)**: single assistant backend endpoint.

## Data flow
1. User captures text.
2. `captureInput()` classifies and stores `InboxEntry` in `memoryCueInbox`.
3. Inbox entries can be converted into notes or reminders.
4. Assistant requests aggregate inbox, notes, and reminders into one context payload.
5. `/api/assistant-chat` ranks context, calls OpenAI Responses API, and returns reply + references.

## Assistant pipeline
- Frontend sends: `message`, `history`, `inboxEntries`, `notes`, `reminders`.
- Backend selects top context matches, builds prompt, calls OpenAI, and returns:
  - `reply`
  - `references`
  - `contextUsed`
- Legacy `/api/assistant` and `/api/chat` remain as deprecated wrappers to `/api/assistant-chat`.

## Storage layers
- `localStorage.memoryCueInbox`: canonical inbox.
- `localStorage.memoryCueNotes`: notes store through notes module.
- reminders module state + `localStorage.scheduledReminders`: reminder scheduling mirror.
- `sessionStorage.memoryCueAssistantConversation`: transient assistant conversation history.

## Service worker architecture
- Single registration path via `js/register-service-worker.js`.
- `service-worker.js` responsibilities:
  - cache mobile app shell assets
  - store scheduled reminders in IndexedDB (`memory-cue-reminders`)
  - process reminder checks via `message`, `sync`, and `periodicsync`
  - display reminder notifications and route notification clicks back to `mobile.html`

## Legacy runtime
- Legacy shell files are archived in `legacy/runtime/`.
- `mobile.html` is the only active runtime entry point.
