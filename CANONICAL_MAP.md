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
| **Primary runtime** | `mobile.html`, `mobile.js` | `js/navigation.js`, `js/router.js`, `js/ui.js` | `legacy/*`, `memory/*` | Mobile runtime is the active product shell, but `mobile.js` is still overloaded and should be reduced over time. |
| **Authentication** | `js/auth.js`, `src/lib/firebase.js`, `js/init-env.js`, `js/env.js` | runtime env shims: `js/runtime-env.js`, `js/runtime-env-shim.js` | any Supabase auth logic or reintroduction of dual auth | Firebase Auth is the only supported auth direction. |
| **Capture** | `src/core/capturePipeline.js` | public wrapper: `js/services/capture-service.js`; related callers: `mobile.js`, `api/capture.js`, `src/services/intentRouter.js` | root `assistant.js` capture flow, any new raw capture path | The real capture implementation lives in `src/core/capturePipeline.js`. Treat `js/services/capture-service.js` as the public wrapper, not the implementation owner. |
| **Inbox / entry processing** | `src/services/inboxService.js` | `js/services/capture-service.js`, `mobile.js`, `src/services/memoryService.js` | `memoryCueState` style legacy entry storage, duplicate inbox-like stores | Inbox is the canonical processing layer for raw captured items. `memoryEntries` is legacy and is migrated by the service. |
| **Entries UI** | `src/ui/quickCapture.js`, `src/ui/reminderUI.js`, `src/ui/inboxUI.js`, `src/ui/chatUI.js` | wrapper: `js/entries.js` | older entry-specific runtime code once superseded | `js/entries.js` is now a compatibility wrapper into `src/ui/*`. |
| **Notes storage and folders** | `js/modules/notes-storage.js` | `js/modules/notes-sync.js`, `mobile.js`, `src/services/adapters/notePersistenceAdapter.js`, `src/services/firestoreSyncService.js` | legacy note keys and legacy note runtimes | Do not create another note store. Storage ownership is still older-layer, while large parts of note UI remain embedded in `mobile.js`. |
| **Reminders** | `src/reminders/reminderController.js` | wrapper: `js/reminders.js`; related modules: `src/reminders/*`, `src/services/reminderService.js`, `src/repositories/reminderRepository.js`, `service-worker.js` | any parallel reminder store or reminder-specific raw capture path | `js/reminders.js` is now a loader/shim. The live reminder implementation is centered in `src/reminders/reminderController.js`. |
| **Assistant UI** | `js/assistant.js`, `src/ui/chatUI.js` | `mobile.js`, `js/services/assistant-service.js`, `src/components/*` | root `assistant.js` in old runtime contexts | Assistant UI is still split and should be changed carefully. |
| **Assistant backend / orchestration** | `api/assistant-chat.ts`, `src/services/assistantOrchestrator.js` | `api/assistant.ts`, `api/chat.ts`, `api/search.ts`, `api/parse-entry.js`, `src/chat/*`, `src/brain/*`, `src/services/brainAgent.js`, `src/services/brainQueryService.js` | any new assistant endpoint without convergence plan | Assistant remains one of the most duplicated areas. Prefer converging on the existing API + orchestrator path. |
| **Navigation** | `js/navigation.js`, `js/router.js`, `mobile.html`, `mobile.js` | `js/entries.js`, local event-driven view toggles, hash-route overlap | any new routing layer | Navigation still overlaps across multiple mechanisms. Do not add another one. |
| **Sync / persistence** | `src/services/firestoreSyncService.js`, `js/modules/notes-sync.js`, `service-worker.js` | `src/reminders/reminderController.js`, localStorage mirrors, IndexedDB/service worker scheduling | `supabase/*`, leftover Supabase sync assumptions, duplicate remote backends | Firestore is the target remote direction. localStorage and service-worker persistence should support the app, not become rival sources of truth. |
| **Service worker / notifications** | `service-worker.js`, `js/register-service-worker.js` | `sw.js`, reminder scheduling logic inside `src/reminders/reminderController.js` | duplicate service worker registration paths | Keep one clear service worker registration path and reduce overlap over time. |
| **Styling** | `styles/*`, `css/*`, `mobile.css` | inline style logic in `mobile.html` if still present | large new inline CSS blocks in runtime HTML | Prefer moving runtime styling into CSS files rather than expanding inline styling. |
| **Hosting / deployment** | `wrangler.jsonc` | `vercel.json` | `.github/workflows/deploy.yml`, GitHub Pages deploy script in `package.json` | Cloudflare Pages is the canonical hosting target. Treat Vercel config as transitional unless confirmed active. Remove GitHub Pages deployment automation. |
| **Legacy runtime** | none | `legacy/*`, `memory/*` | all legacy runtime files for new feature work | These are cleanup/archival areas, not feature-development targets. |
| **Supabase residue** | none | `supabase/unified_sync_tables.sql`, any leftover Supabase helper references | all new Supabase work | Supabase is residue, not target direction. Do not expand it. |

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
4. Does an API route for this already exist in `api/*`?
5. Does a hosting config for this already exist in the repo?
6. Can the change be made by extending the canonical file instead?

If yes, extend the existing implementation rather than creating a parallel one.

---

## Current uncertainty markers

The following domains are still **not fully converged** and should be treated carefully:
- notes ownership between storage and mobile shell
- assistant UI and assistant backend
- navigation
- sync ownership boundaries inside reminders and notes
- final responsibility split inside `mobile.js`
- whether `vercel.json` is still needed

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
