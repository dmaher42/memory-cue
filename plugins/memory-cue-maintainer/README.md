# Memory Cue Maintainer

Repo-local Codex plugin for the `memory-cue` app.

This plugin is designed to reduce architecture drift in this repo by teaching future sessions to:

- resolve the real repo root before editing
- read the repo handover docs first
- use the canonical file owner for each domain
- avoid adding duplicate storage, routes, or hosting paths
- run the Windows-safe verification commands this workspace expects

The current workspace can be misleading because `C:\Users\dmahe\OneDrive\Documents\New project\teach screen` is only a log/scratch folder. The real git repo root is `C:\Users\dmahe\OneDrive\Documents\New project`, where `package.json` names the app `memory-cue`.

Primary skill:

- `skills/memory-cue-maintainer/SKILL.md`

Helper script:

- `scripts/verify-memory-cue.ps1`
