# AI_HANDOVER.md

## Purpose
This file is the first document every new ChatGPT or Codex session must read before making changes to Memory Cue.

Its purpose is to stop future sessions from:
- inventing new architecture
- duplicating services
- creating new storage models
- adding parallel sync or auth systems
- editing legacy files instead of the canonical runtime

This repo has grown through multiple AI-assisted chats and contains overlapping layers. Future work must reduce duplication, not add to it.

---

## How AI should assist Daniel

Daniel is non-technical and relies on AI for technical design and implementation.

When making changes:
- do not assume Daniel can fill in missing technical details himself
- do not give vague guidance when a concrete implementation is possible
- prefer complete, ready-to-use solutions over partial snippets
- explain technical decisions in plain English
- clearly identify which files are being changed and why
- avoid inventing new architecture when extending this codebase
- before suggesting a new file, service, endpoint, or storage model, first check whether that concept already exists and prefer extending the canonical implementation
- clearly flag uncertainty instead of guessing
- when the codebase is complex, help preserve structure, reduce duplication, and keep one source of truth
- when a full-file change is needed, provide the full updated file rather than small fragments
- act as the lead technical designer and builder, not as if Daniel will implement missing parts himself

---

## What Memory Cue is

Memory Cue is a personal second-brain PWA for one user.

Primary goals:
- reliable capture of ideas, notes, and reminders
- reliable sync across multiple devices
- low-maintenance architecture
- predictable behavior
- simple retrieval and assistant support

This is not an enterprise multi-tenant platform.
It does not need multiple competing backends or parallel architecture patterns.

---

## Current Product Priorities

Current phase: stabilise and simplify.

Priority order:
1. Stabilise sync and persistence
2. Remove duplicate architecture paths
3. Standardise capture, inbox, notes, and reminder flows
4. Clean up legacy and transitional code
5. Improve UX only after architecture is stable

Do not introduce major new features unless they directly support the priorities above.

---

## Non-Negotiable Rules

Read `PRODUCT_RULES.md` before coding.
Then use `CANONICAL_MAP.md` to identify the real implementation files for the task.

Summary:
- one capture pipeline
- inbox as processing layer
- assistant must not silently mutate user data
- no duplicate storage locations for the same concept

If a proposed change violates `PRODUCT_RULES.md`, do not implement it.

---

## Source-of-Truth Technology Direction

### Authentication
- Canonical direction: Firebase Auth
- Do not reintroduce Supabase auth
- Do not create a second auth path

### Remote data
- Canonical direction: Firestore as the single remote database
- localStorage may exist as offline or cache support
- localStorage is not the long-term source of truth
- do not add a second remote storage system

### Sync
- Sync should be boring and reliable
- one user, one account, one cloud source of truth
- reduce split-brain behavior between local and cloud stores

### Hosting / deployment
- Canonical hosting: Cloudflare Pages
- Canonical hosting config: `wrangler.jsonc`
- GitHub Pages deployment config is legacy and should not be extended
- Vercel config has been removed from the repo

### Supabase
- Supabase has historical residue in the repo
- it is not the target direction
- do not expand Supabase usage
- any remaining Supabase code should be treated as transitional or cleanup candidate unless proven essential

---

## Primary Runtime

### Active app runtime
The mobile runtime is the primary runtime.

Primary entrypoints:
- `mobile.html`
- `mobile.js`

The mobile shell is still the main orchestration layer, but low-risk UI responsibilities have started moving out of it.
Future cleanup should continue reducing responsibilities inside `mobile.js`, not add more.

### Wrapper modules now in use
Some older-looking `js/*` files are now wrappers or compatibility layers around newer `src/*` implementations.
Key examples:
- `js/services/capture-service.js` → wrapper over `src/core/capturePipeline.js` and `src/services/inboxService.js`
- `js/reminders.js` → wrapper over `src/reminders/reminderController.js`
- `js/entries.js` → wrapper over `src/ui/quickCapture.js`, `src/ui/reminderUI.js`, `src/ui/inboxUI.js`, and `src/ui/chatUI.js`

Do not treat those wrappers as the real implementation owner when the underlying `src/*` module is the true live owner.

### Extracted mobile UI modules now in use
Recent cleanup has created dedicated homes for parts of the mobile shell UI:
- `src/ui/mobileShellUi.js` → shell-level UI controls that used to live in `mobile.js`
- `src/ui/mobileSyncControls.js` → sync status and manual sync controls that used to live in `mobile.js`
- `src/ui/mobileNotesShellUi.js` → notebook shell UI that used to live in `mobile.js`

When extending shell-level mobile UI, prefer these extracted `src/ui/*` modules over putting more code back into `mobile.js`.

### Legacy runtime
Treat these as legacy or transitional unless explicitly doing cleanup work:
- `legacy/*`
- `memory/*`
- root desktop-style `assistant.js` tied to old shell behavior

Do not build new features into legacy runtime files.

---

## Canonical Repo Reading Order for New Sessions

Before making code changes, read these docs in order:
1. `AI_HANDOVER.md`
2. `PRODUCT_RULES.md`
3. `CANONICAL_MAP.md`
4. `REPO_AUDIT_AND_CLEANUP_PLAN.md`
5. `FEATURE_INVENTORY.md`

If deeper architectural context is needed, then read:
- `ARCHITECTURE_CURRENT.md`
- `CAPTURE_FLOW_MAP.md`
- `docs/ARCHITECTURE_CURRENT_STATE.md`
- `docs/ARCHITECTURE.md`
- `docs/CAPTURE_FLOW.md`
- `docs/CAPTURE_PIPELINE_MAP.md`
- `docs/DATA_STORAGE_MAP.md`
- `docs/UI_NAVIGATION_MAP.md`
- `README.md`

### How to interpret the docs
- `PRODUCT_RULES.md` = non-negotiable architectural rules
- `CANONICAL_MAP.md` = current file ownership by domain
- `REPO_AUDIT_AND_CLEANUP_PLAN.md` = cleanup direction
- `FEATURE_INVENTORY.md` = overlap and duplication audit
- `README.md` = project setup and canonical hosting/deployment notes
- `ARCHITECTURE_CURRENT.md` and `docs/ARCHITECTURE_CURRENT_STATE.md` = current repo reality, but may lag behind the newest migrations
- `CAPTURE_FLOW_MAP.md` and `docs/CAPTURE_PIPELINE_MAP.md` = capture references, but verify against the live code before trusting them as current
- `docs/ARCHITECTURE.md` and `docs/CAPTURE_FLOW.md` may be more aspirational than fully implemented

Do not assume aspirational docs describe the live code exactly.

---

## Current Repo Reality

The repo still contains overlapping systems, but several important domains are more converged than older docs imply.

Live-code reality currently looks like this:
- capture is mostly canonical through `js/services/capture-service.js` → `src/core/capturePipeline.js`
- inbox is mostly canonical through `src/services/inboxService.js`
- reminders are mostly canonical through `js/reminders.js` → `src/reminders/reminderController.js`
- entries UI is mostly canonical through `js/entries.js` → `src/ui/*`
- shell-level mobile UI now has an extracted home in `src/ui/mobileShellUi.js`
- mobile sync controls now have an extracted home in `src/ui/mobileSyncControls.js`
- notebook shell UI now has an extracted home in `src/ui/mobileNotesShellUi.js`
- notes remain mixed, with storage centered in `js/modules/notes-storage.js` and heavy UI/orchestration still in `mobile.js`
- assistant backend/orchestration is still one of the most duplicated areas
- navigation still overlaps across multiple mechanisms
- `mobile.js` is still the biggest structural hotspot, but notebook shell UI has been reduced further
- Cloudflare Pages is the canonical hosting target

This means:
- do not create new parallel systems
- do not assume a clean rewrite already happened
- do not create a new service just because a better structure seems possible
- prefer convergence over redesign

---

## Change Rules for Future Sessions and Codex

### Rule 1: Do not invent new architecture
Do not create a new service, module, endpoint, or hosting path unless:
- the canonical one truly does not exist, and
- the change is explicitly part of cleanup or convergence

### Rule 2: Extend canonical files first
Before adding any file, check whether the same domain already exists in:
- `js/services/*`
- `js/modules/*`
- `src/services/*`
- `src/core/*`
- `src/reminders/*`
- `src/ui/*`
- `api/*`
- existing hosting/deployment config files

If it exists, prefer extending or migrating into the canonical file rather than creating another parallel file.

### Rule 3: One source of truth per domain
For each domain, do not allow multiple active implementations.

Domains:
- auth
- capture
- inbox
- notes
- reminders
- assistant
- navigation
- sync
- hosting

Any task should begin by identifying:
- canonical file(s)
- transitional file(s)
- legacy file(s)

### Rule 4: Reduce duplication
Every meaningful change should do one of these:
- extend a canonical path
- migrate old logic into a canonical path
- delete or archive duplicate logic
- update docs to reflect reality

Avoid changes that merely add another wrapper, adapter, alternate path, or second hosting story.

### Rule 5: Do not add new storage keys casually
Before introducing a new key, table, collection, or structure:
- check existing storage models
- confirm the concept does not already exist
- prefer reusing inbox, notes, or reminders domains

### Rule 6: Do not reintroduce dual backend logic
Do not add:
- Firebase and Supabase parallel write paths
- multiple auth systems
- multiple remote databases for the same domain
- multiple active hosting paths in repo automation

### Rule 7: Respect the current phase
The repo is in cleanup and stabilisation phase.
Do not prioritise visual polish or speculative feature work over architecture convergence.

---

## Working Domain Guidance

### Capture
Target direction:
- one capture pipeline
- inbox as entry point
- conversion into notes or reminders happens after capture

Current live direction:
- public entry through `js/services/capture-service.js`
- implementation in `src/core/capturePipeline.js`
- inbox owner in `src/services/inboxService.js`

Do not add another capture mechanism.

### Inbox
Inbox should be the canonical processing layer.
Do not create new inbox-like storage concepts.

### Notes
Treat note storage as an existing domain that should be stabilised, not reinvented.
Do not add alternate note stores.

### Reminders
Reminders are a core product surface.
The live implementation is centered in `src/reminders/reminderController.js`, with `js/reminders.js` acting as a wrapper.
Prefer convergence, not parallel expansion.

### Assistant
Assistant is one of the most duplicated parts of the codebase.
Do not add another assistant endpoint or orchestration layer without first identifying the canonical path.

### Navigation
Navigation currently overlaps across hash routes, events, and local togglers.
Do not create another routing mechanism.

### Mobile shell UI
For low-risk shell controls and sync/status UI, prefer the extracted `src/ui/mobileShellUi.js`, `src/ui/mobileSyncControls.js`, and `src/ui/mobileNotesShellUi.js` modules instead of putting more shell-level notebook UI back into `mobile.js`.

### Hosting
Cloudflare Pages is the canonical deploy target.
Do not extend GitHub Pages deployment automation.

---

## What Not To Do

Do not:
- create a new “better” architecture beside the current one
- introduce a second sync path
- add another assistant service
- add another capture service
- create new localStorage structures for existing concepts
- move files around without clarifying canonical ownership
- build features into `legacy/*` unless explicitly doing cleanup
- assume docs and implementation are already aligned
- keep multiple active hosting stories in the repo

---

## What To Do First In Any New Task

For every new coding task:
1. Identify the domain
   - auth, capture, inbox, notes, reminders, assistant, navigation, sync, or hosting
2. Identify the canonical implementation
   - which file(s) are the real ones for that domain
3. Identify overlap
   - which files are transitional or legacy
4. Decide the safest kind of change
   - extend canonical
   - migrate old code
   - delete or archive duplicate
   - update docs
5. Only then implement

If the canonical path is unclear, resolve that first.

---

## Current Cleanup Direction

Broad cleanup direction:
1. keep repo control docs aligned with the live code
2. reduce responsibility inside `mobile.js`
3. keep capture on one canonical path
4. align storage schema where needed
5. remove Supabase residue
6. simplify assistant paths
7. simplify navigation overlap
8. remove stale hosting/deployment paths
9. archive or delete legacy layers and stale docs

---

## Desired End State

The desired end state is:
- one auth system
- one remote database
- one capture pipeline
- one inbox model
- one notes model
- one reminders model
- one assistant entry point
- one mobile runtime
- one clear navigation mechanism
- one canonical hosting target (Cloudflare Pages)
- local cache only as support, not as a rival source of truth

---

## Instruction to Future AI Sessions

Do not guess.
Do not redesign from scratch.
Do not add a parallel system because context is incomplete.

Use this repo’s documented direction.
When uncertain, choose the option that reduces duplication and preserves one source of truth.
