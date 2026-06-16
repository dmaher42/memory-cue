# CANONICAL_MAP.md

## Purpose

This file defines the **current canonical file ownership map** for Memory Cue.

It exists to stop future ChatGPT and Codex sessions from:
- editing the wrong layer
- extending wrapper files when the real implementation lives elsewhere
- creating duplicate services or endpoints
- guessing where a feature belongs

This map should be updated whenever a domain is successfully simplified or ownership changes.

Read this after `AI_HANDOVER.md` and `PRODUCT_RULES.md`.

---

## How to use this file

For every coding task:
1. Identify the domain.
2. Start with the **canonical files**.
3. Check whether any **transitional files** are still involved.
4. Avoid extending **legacy files** unless the task is explicitly cleanup or removal.

If a domain is unclear, do not guess. Resolve ownership first.

---

## Domain Map

| Domain | Canonical files | Transitional files | Legacy / avoid for new feature work | Notes |
|---|---|---|---|---|
| **App handover / repo control** | `AI_HANDOVER.md`, `PRODUCT_RULES.md`, `CANONICAL_MAP.md` | `FEATURE_INVENTORY.md`, `REPO_AUDIT_AND_CLEANUP_PLAN.md`, `ARCHITECTURE_CURRENT.md`, `CAPTURE_FLOW_MAP.md` | clearly stale one-off reports once removed | New sessions should read these first. |
| **Primary runtime** | `mobile.html`, `mobile.js` | `js/navigation.js`, `js/router.js`, `js/ui.js` | none (legacy runtime dirs `legacy/*` and `memory/*` have been removed) | Mobile runtime is the active product shell, but `mobile.js` is still overloaded and should be reduced over time. |
| **Authentication** | `js/auth.js`, `src/lib/firebase.js`, `js/init-env.js`, `js/env.js` | runtime env shims: `js/runtime-env.js`, `js/runtime-env-shim.js` | any Supabase auth logic or reintroduction of dual auth | Firebase Auth is the only supported auth direction. |
| **Capture** | `src/core/capturePipeline.js` | public wrapper: `js/services/capture-service.js`; related callers: `mobile.js`, `src/services/intentRouter.js` | root `assistant.js` capture flow, any new raw capture path | The real capture implementation lives in `src/core/capturePipeline.js`. Treat `js/services/capture-service.js` as the public wrapper, not the implementation owner. The old `api/capture.js` endpoint has been removed. |
| **Inbox / entry processing** | `src/services/inboxService.js` | `js/services/capture-service.js`, `mobile.js`, `src/services/memoryService.js` | `memoryCueState` style legacy entry storage, duplicate inbox-like stores | Inbox is the canonical processing layer for raw captured items. `memoryEntries` is legacy and is migrated by the service. |
| **Entries UI** | `src/ui/quickCapture.js`, `src/ui/reminderUI.js`, `src/ui/chatUI.js` | wrapper: `js/entries.js`; note-to-reminder actions in `mobile.js` / `src/ui/mobileNotesShellUi.js` | retired mobile inbox/category UI, older entry-specific runtime code once superseded | `js/entries.js` is now a compatibility wrapper into the remaining active `src/ui/*` modules. Visible inbox UI is retired from the main mobile flow even though inbox storage remains canonical. |
| **Mobile shell UI** | `src/ui/mobileShellUi.js` | `mobile.js`, `src/ui/uiEvents.js` | duplicated shell-level UI wiring inside `mobile.js` once fully removed | Shell UI controls now have a dedicated home outside `mobile.js`. Continue moving low-risk shell wiring here instead of adding more to `mobile.js`. |
| **Mobile sync controls** | `src/ui/mobileSyncControls.js` | `mobile.js` | duplicated sync-controls logic inside `mobile.js` once fully removed | Sync status and manual sync UI now have a dedicated module. Keep sync-controls ownership here rather than re-embedding it into `mobile.js`. |
| **Mobile notebook shell UI** | `src/ui/mobileNotesShellUi.js` | `mobile.js` | duplicated notebook shell UI wiring inside `mobile.js` once fully removed | Notebook shell controls now have a dedicated module. Keep saved-notes sheet, note options sheet, folder-picker shell UI, and notebook panel toggles here rather than re-growing `mobile.js`. |
| **Notes storage and folders** | `js/modules/notes-storage.js` | `js/modules/notes-sync.js`, `mobile.js`, `src/services/adapters/notePersistenceAdapter.js`, `src/services/firestoreSyncService.js` | legacy note keys and legacy note runtimes | Do not create another note store. Storage ownership is still older-layer, while some notebook rendering/state orchestration remains embedded in `mobile.js`. |
| **Reminders** | `src/reminders/reminderController.js` | wrapper: `js/reminders.js`; related modules: `src/reminders/*`, `src/services/reminderService.js`, `src/repositories/reminderRepository.js`, `service-worker-v3.js` | any parallel reminder store or reminder-specific raw capture path | `js/reminders.js` is now a loader/shim. The live reminder implementation is centered in `src/reminders/reminderController.js`. |
| **Assistant UI** | `js/assistant.js`, `src/ui/chatUI.js` | `mobile.js`, `js/services/assistant-service.js`, `src/components/*` | root `assistant.js` in old runtime contexts | Assistant UI is still split and should be changed carefully. |
| **Assistant backend / orchestration** | `functions/api/assistant-chat.ts`, `src/services/assistantOrchestrator.js` | `functions/api/parse-entry.js`, `functions/api/embed.ts`, `src/chat/*`, `src/brain/*`, `src/services/brainAgent.js`, `src/services/brainQueryService.js` | any new assistant endpoint without convergence plan | Assistant remains one of the most duplicated areas. The live serverless code is the Cloudflare Pages Functions under `functions/api/*`; the older `api/assistant.ts`, `api/chat.ts`, and `api/search.ts` endpoints have been removed. Prefer converging on the existing Functions + orchestrator path. |
| **Navigation** | `js/navigation.js`, `js/router.js`, `mobile.html`, `mobile.js` | `js/entries.js`, local event-driven view toggles, hash-route overlap | any new routing layer | Navigation still overlaps across multiple mechanisms. Do not add another one. |
| **Sync / persistence** | `src/services/firestoreSyncService.js`, `js/modules/notes-sync.js`, `service-worker-v3.js` | `src/reminders/reminderController.js`, `src/ui/mobileSyncControls.js`, localStorage mirrors, IndexedDB/service worker scheduling | leftover Supabase sync assumptions, duplicate remote backends (the `supabase/*` dir has been removed) | Firestore is the target remote direction. localStorage and service-worker persistence should support the app, not become rival sources of truth. |
| **Service worker / notifications** | `service-worker-v3.js`, `js/register-service-worker-v2.js` | reminder scheduling logic inside `src/reminders/reminderController.js` | duplicate service worker registration paths | `js/register-service-worker-v2.js` is the only service-worker registration path; the old `service-worker.js`, `sw.js`, and `js/register-service-worker.js` have been removed. Keep one clear registration path and reduce overlap over time. |
| **Styling** | `styles/*`, `css/*`, `mobile.css` | inline style logic in `mobile.html` if still present | large new inline CSS blocks in runtime HTML | Prefer moving runtime styling into CSS files rather than expanding inline styling. |
| **Hosting / deployment** | `wrangler.jsonc` | `README.md`, `AI_HANDOVER.md` | removed GitHub Pages workflow, removed GitHub Pages deploy script, removed `vercel.json` | Cloudflare Pages is the canonical hosting target. Do not add another hosting path unless the project direction explicitly changes. |
| **Legacy runtime** | none | none | none | Cleanup DONE: the `legacy/*` and `memory/*` legacy runtime dirs have been removed from the repo. Do not recreate them. |
| **Supabase residue** | none | none | all new Supabase work | Cleanup DONE: the `supabase/*` dir and the `oauth/` consent page have been removed. Supabase is not the target direction. Do not reintroduce it. |

---

## Provisional source-of-truth models by concept

These are the intended concept owners during cleanup:

- **Raw capture / unprocessed thoughts** → Inbox
- **Written content** → Notes
- **Actionable dated items** → Reminders
- **Assistant** → helper layer across Inbox, Notes, and Reminders
- **Remote source of truth** → Firestore
- **Authentication** → Firebase Auth
- **Hosting / deployment** → Cloudflare Pages

Do not introduce another storage layer or second active hosting path for any of these concepts.

---

## Before adding any new file

Before creating a new file, service, endpoint, storage model, or hosting path, check:
1. Does this domain already exist in `js/services/*`?
2. Does it already exist in `js/modules/*`?
3. Does it already exist in `src/services/*`, `src/core/*`, `src/reminders/*`, or `src/ui/*`?
4. Does an API route for this already exist in `functions/api/*`?
5. Does a hosting config for this already exist in the repo?
6. Can the change be made by extending the canonical file instead?

If yes, extend the existing implementation rather than creating a parallel one.

---

## Current uncertainty markers

The following domains are still **not fully converged** and should be treated carefully:
- notes ownership between storage and remaining notebook orchestration in `mobile.js`
- assistant UI and assistant backend
- navigation
- sync ownership boundaries inside reminders, notes, and sync UI
- final responsibility split inside `mobile.js`

When working in these areas, prefer:
- documenting the current ownership first
- making the smallest safe change
- reducing duplication as part of the work where practical

---

## Update rule

Whenever a cleanup task successfully changes ownership of a domain:
- update this file
- update `AI_HANDOVER.md` if the repo workflow changes
- update other architecture docs if the repo reality has materially changed

This file should always reflect the **best current answer** to:
**“Which file should future AI sessions edit for this domain?”**
