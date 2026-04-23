---
name: memory-cue-maintainer
description: Improve the Memory Cue repo by following its handover docs, editing canonical implementation files, and running Windows-safe verification commands.
---

# Memory Cue Maintainer

Use this skill whenever the target repo is Memory Cue or when the current folder looks ambiguous and you need to confirm whether you are inside the real app checkout.

## First checks

1. Confirm the real git root before editing.
   - In this workspace, `C:\Users\dmahe\OneDrive\Documents\New project\teach screen` is only a subfolder with log files.
   - The actual repo root is the parent directory where `package.json` exists and the package name is `memory-cue`.
2. Read these files in order before making substantive changes:
   - `AI_HANDOVER.md`
   - `PRODUCT_RULES.md`
   - `CANONICAL_MAP.md`
3. Inspect the live implementation before patching. Do not trust aspirational docs over active code.

## Non-negotiable repo rules

- Do not invent new architecture when an existing path already exists.
- Do not add a new localStorage key, new inbox-like store, new reminder store, or a parallel capture pipeline.
- Do not expand Supabase usage.
- Do not add a new routing layer.
- Do not extend legacy runtime files for new feature work.
- Prefer the mobile runtime and extracted `src/*` module owners over older wrappers when the canonical map says the wrapper is not the real owner.

## Canonical ownership shortcuts

- Capture: `src/core/capturePipeline.js`
- Inbox processing: `src/services/inboxService.js`
- Reminders: `src/reminders/reminderController.js`
- Mobile shell UI: `src/ui/mobileShellUi.js`
- Mobile notebook shell UI: `src/ui/mobileNotesShellUi.js`
- Notes storage: `js/modules/notes-storage.js`
- Service worker and notifications: `service-worker.js`

Treat these as starting points. If a task touches one of these domains, open the canonical file first and only touch wrapper files when the live flow still passes through them.

## Verification flow

Use PowerShell-native commands on this machine.

- Run tests with `npm.cmd test -- --runInBand`
- Run a production build with `npm.cmd run build`
- Verify the output with `node scripts/verify-build.mjs`
- If a reminder flow changed and the environment is ready, optionally run `npm.cmd run check:reminders`

You can also use the helper script:

```powershell
powershell -ExecutionPolicy Bypass -File .\plugins\memory-cue-maintainer\scripts\verify-memory-cue.ps1
```

Optional reminder regression:

```powershell
powershell -ExecutionPolicy Bypass -File .\plugins\memory-cue-maintainer\scripts\verify-memory-cue.ps1 -IncludeReminderRegression
```

## Change style

- Make the smallest effective change that fully solves the issue.
- Prefer extending the canonical implementation instead of creating a parallel system.
- Report what is confirmed, what is unclear, what changed, why it changed there, what was tested, and any remaining risk.
