# Repo Audit and Cleanup Plan

## 1. Executive Summary

Memory Cue currently shows architecture drift.

Over time, features have been added, replaced, and duplicated in ways that make the product harder to maintain.

The main issue is not just isolated bugs. The bigger problem is overlapping systems that do similar jobs, which creates confusion in both the code and the product experience.

## 2. Core Product Direction

Memory Cue should focus on only four core feature areas:

- **Inbox / Capture**  
  A fast place to drop quick thoughts and incoming items before deciding where they belong.

- **Notes**  
  A space for longer writing, ideas, and structured personal or work notes.

- **Reminders**  
  A place for time-based and actionable items that need due dates, tracking, and follow-up.

- **Assistant**  
  A helper that supports the user by organizing, searching, summarizing, and classifying existing information.

## 3. Current Problems

Main issues in the current repository include:

- duplicated capture paths
- multiple overlapping data stores
- too much inline CSS in `mobile.html`
- too much logic inside `mobile.js`
- overlapping UI patterns
- assistant doing too many jobs
- unclear source of truth for new entries

## 4. Product Rules Going Forward

To keep the product simple and consistent, apply these rules:

- quick thoughts go to Inbox
- freeform writing goes to Notes
- dated/actionable items go to Reminders
- Assistant only helps organise, search, summarise, and classify
- Assistant must not become its own separate storage system
- Brain Dump must feed Inbox, not a separate store

## 5. Target Data Model

Use a simplified model with clear item types.

### Inbox item

- id
- title
- text
- createdAt
- updatedAt
- processed
- tags

### Note

- id
- title
- body
- createdAt
- updatedAt
- tags
- folder

### Reminder

- id
- title
- text
- dueAt
- createdAt
- updatedAt
- priority
- completed
- notify
- tags

## 6. Cleanup Plan by Phase

### Phase 1 — Stop duplication

- Freeze any new parallel feature paths.
- Stop creating new capture flows that bypass core models.
- Prevent additional storage layers from being introduced.

### Phase 2 — Simplify data model

- Agree on one source-of-truth model for Inbox, Notes, and Reminders.
- Migrate overlapping records into the target models.
- Remove duplicate field systems where possible.

### Phase 3 — Split responsibilities in code

- Separate large mixed-responsibility files into focused modules.
- Keep capture, rendering, and storage logic clearly separated.
- Reduce cross-feature coupling in shared files.

### Phase 4 — Rationalise screens

- Remove duplicate or overlapping UI entry points.
- Keep one clear user path for capture and processing.
- Align screen behavior with the four core feature areas.

### Phase 5 — Improve AI only after cleanup

- Improve Assistant features only after core architecture is stable.
- Keep AI behavior tied to existing product data models.
- Avoid introducing AI-first storage paths or parallel systems.

## 7. What to Keep

Keep and strengthen these existing directions:

- Notebook / Notes
- Reminders
- Assistant
- Inbox processing concept

## 8. What to Deprecate or Merge

Deprecate or merge the following:

- separate brain dump storage
- duplicate quick-add flows
- overlapping capture UI paths
- any AI-specific storage path
- duplicate category/folder systems if they overlap

## 9. Recommended Refactor Order

1. Freeze new features
2. Establish source-of-truth models
3. Convert Brain Dump to Inbox
4. Break `mobile.js` into modules
5. Move inline CSS out of `mobile.html`
6. Remove duplicate UI systems
7. Re-test core flows
8. Then improve AI

## 10. Final Product Vision

The intended Memory Cue experience should be:

- fast capture
- simple note writing
- clean reminders
- AI as helper, not clutter

This keeps the product focused, easier to maintain, and easier for non-technical owners to manage with Codex and ChatGPT.
