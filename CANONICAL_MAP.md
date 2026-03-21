# CANONICAL_MAP.md

## Purpose

This file defines the **provisional canonical file ownership map** for Memory Cue.

It exists to stop future ChatGPT and Codex sessions from:
- editing the wrong layer
- extending legacy files
- creating duplicate services or endpoints
- guessing where a feature belongs

This map is **provisional during cleanup**.
It should be updated whenever a domain is successfully simplified or ownership changes.

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
| **App handover / repo control** | `AI_HANDOVER.md`, `PRODUCT_RULES.md`, `CANONICAL_MAP.md` | `FEATURE_INVENTORY.md`, `REPO_AUDIT_AND_CLEANUP_PLAN.md`, `ARCHITECTURE_CURRENT.md` | Duplicated older planning docs once superseded | New sessions should read these first. |
| **Primary runtime** | `mobile.html`, `mobile.js` | `js/navigation.js`, `js/router.js`, `js/ui.js` | `legacy/*`, `memory/*` | Mobile runtime is the active product shell. |
| **Authentication** | `js/auth.js`, `src/lib/firebase.js`, `js/init-env.js`, `js/env.js` | runtime env shims: `js/runtime-env.js`, `js/runtime-env-shim.js` | Any Supabase auth logic or reintroduction of dual auth | Firebase Auth is the target and should remain the only auth direction. |
| **Capture** | `js/services/capture-service.js` | `mobile.js`, `js/reminders.js`, `js/entries.js`, `api/capture.js`, `src/core/capturePipeline.js`, `src/services/inboxService.js`, `src/services/intentRouter.js` | root `assistant.js` capture flow, any new raw capture path | Target direction is one raw capture pipeline feeding Inbox. This area is not yet fully converged. |
| **Inbox / entry processing** | `js/services/capture-service.js` | `js/entries.js`, `mobile.js`, `src/services/inboxService.js` | `memoryCueState` style legacy entry storage, duplicate inbox-like stores | Inbox should remain the processing layer for raw captured items. |
| **Notes storage and folders** | `js/modules/notes-storage.js` | `js/modules/notes-sync.js`, `mobile.js`, `js/reminders.js`, `js/entries.js`, `src/services/adapters/notePersistenceAdapter.js`, `src/services/firestoreSyncService.js` | legacy note keys and legacy note runtimes | Do not create another note store. Extend existing notes storage unless actively migrating it. |
| **Reminders** | `js/reminders.js` | `src/reminders/*`, `src/services/reminderService.js`, `src/services/reminderNotificationService.js`, `src/repositories/reminderRepository.js`, `service-worker.js` | any parallel reminder store or reminder-specific raw capture path | Reminders are a core surface. Old runtime logic is still central, with newer modular work present alongside it. |
| **Assistant UI** | `js/assistant.js` | `mobile.js`, `js/services/assistant-service.js`, `src/ui/chatUI.js`, `src/components/*` | root `assistant.js` in old runtime contexts | Avoid adding another assistant UI controller. |
| **Assistant backend / orchestration** | `api/assistant-chat.ts` | `api/assistant.ts`, `api/chat.ts`, `api/search.ts`, `api/parse-entry.js`, `src/services/assistantOrchestrator.js`, `src/chat/*`, `src/brain/*`, `src/services/brainAgent.js`, `src/services/brainQueryService.js` | any new assistant endpoint without convergence plan | Assistant is one of the most duplicated areas. Prefer converging on one backend entry point. |
| **Navigation** | `js/navigation.js`, `js/router.js`, `mobile.html`, `mobile.js` | `js/entries.js`, local event-driven view toggles, hash-route overlap | any new routing layer | Navigation currently overlaps across multiple mechanisms. Do not add another one. |
| **Sync / persistence** | `src/services/firestoreSyncService.js`, `js/modules/notes-sync.js`, `service-worker.js` | `js/reminders.js`, localStorage mirrors, IndexedDB reminder scheduling | `supabase/*`, leftover Supabase sync assumptions, duplicate remote backends | Firestore is the target remote direction. localStorage and service worker persistence should support the app, not become rival sources of truth. |
| **Service worker / notifications** | `service-worker.js`, `js/register-service-worker.js` | `sw.js`, reminder scheduling logic in `js/reminders.js` | duplicate service worker registration paths | Keep one clear service worker registration path. |
| **Styling** | `styles/*`, `css/*`, `mobile.css` | inline style logic in `mobile.html` if still present | large new inline CSS blocks in runtime HTML | Prefer moving runtime styling into CSS files rather than expanding inline styling. |
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

Do not introduce another storage layer for any of these concepts.

---

## Before adding any new file

Before creating a new file, service, endpoint, or storage model, check:
1. Does this domain already exist in `js/services/*`?
2. Does it already exist in `js/modules/*`?
3. Does it already exist in `src/services/*`, `src/core/*`, or `src/reminders/*`?
4. Does an API route for this already exist in `api/*`?
5. Can the change be made by extending the canonical file instead?

If yes, extend the existing implementation rather than creating a parallel one.

---

## Current uncertainty markers

The following domains are still **not fully converged** and should be treated carefully:
- capture
- inbox
- assistant backend
- reminders architecture
- navigation
- sync ownership

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
