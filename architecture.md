Memory Cue — Architecture Guide

This document explains the internal structure of Memory Cue, with special attention to how the UI, CSS layers, notes editor, reminders system, and sync logic work.
It is designed specifically to onboard AI developers, so they can safely modify or extend the project without missing important files or causing regressions.

If you are an AI assistant reading this:
You MUST read this entire file before making changes.

📚 1. High-Level Overview

Memory Cue is a mobile-first productivity app with two core views:

🌿 Reminders View

Quick-add bar (text input, microphone, save button, overflow menu)

Segmented control (All / Today)

Scrollable reminder list

Fully synced across devices

✏️ Scratch Notes / Notebook View

Simple, minimal writing area

Autosave-first design (no Save button UI)

Optional cloud syncing (Supabase)

Should expand vertically and horizontally for a “full-page writing” feel

🧭 2. Core File Structure

Here is where everything actually lives.

📄 HTML
mobile.html (root)

The main mobile UI entry point.
Contains:

All HTML markup for Reminders + Notebook views

Significant inline <style> overrides

Layout rules that often override theme CSS

Important ID-based elements used heavily by JavaScript

👉 AIs MUST ALWAYS CHECK THIS FILE FIRST when modifying layout or UI behavior.

🎨 CSS

Memory Cue uses three layers of CSS, which frequently override each other.
Understanding these layers prevents inconsistent behavior and missed overrides.

Layer 1 — Inline CSS (inside mobile.html)

Highest priority.
Overrides theme CSS.
Includes custom spacing, notebook card paddings, typography.

Many bugs occur when only external files are edited and not this one.

Layer 2 — css/theme-mobile.css

Primary stylesheet for:

Notebook layout

Reminders layout

Flexbox structures

Padding, margins, spacing

Typography

Icons

Primary place to modify styling, unless inline CSS in mobile.html overrides it.

Layer 3 — styles/mobile-compact.css (CRITICAL HIDDEN OVERRIDE)

This file applies viewport-size-dependent overrides, specifically targeting:

@media (max-width: 480px)


Historically, it contained rules like:

.editor, .note-editor {
  max-height: 46vh;
}


This FORCES the notebook editor to be short, causing the “squashed” feeling on mobile.

👉 ANY changes to notebook layout MUST check this file, or updates will appear to “not work.”

⚙️ JavaScript
js/mobile.js

Controls:

View switching (Reminders ↔ Notebook)

Notebook autosave

Notebook editing logic

Quick-add for reminders

Mic button behavior

Header overflow menu

Local storage of notes

js/reminders.js

Handles:

Reminder models

Reminder sync

Reminder rendering

js/modules/notes-sync.js

Handles:

Cloud sync for notes (Supabase)

Merging remote changes

Pushing local changes

Session-based syncing

Notebook sync only works when user is authenticated.

js/notes-storage.js

Handles:

Local notes storage

Versioning

Autosave

🧩 3. Notebook Layout Architecture

The notebook view uses this DOM structure:

<section id="view-notebook">
  <div id="scratch-notes-card">
    <input id="noteTitleMobile"/>
    <div class="toolbar"></div>
    <div class="scratch-notes-body-wrapper">
      <div class="note-editor-content">
        <textarea>...</textarea>
      </div>
    </div>
  </div>
</section>


The visual feel (full-width vs. centered, squashed vs. tall) is controlled by:

A. Inline CSS in mobile.html

(e.g., card padding, top margin)

B. css/theme-mobile.css

(e.g., .scratch-notes-card { max-width: 640px; margin: 0 auto; })

C. styles/mobile-compact.css

(e.g., .editor, .note-editor { max-height: 46vh; })

The combined effect of these layers creates the final appearance.

🧠 4. Reminders Architecture

DOM structure:

<div class="quick-add-bar">
  input#quickAddInput
  mic button
  save button
  overflow button
</div>

<div class="segment-control">
  button.All
  button.Today
</div>

<ul id="remindersList">
  <li class="reminder-item">...</li>
</ul>


CSS that shapes reminders lives mainly in:

css/theme-mobile.css

inline CSS of mobile.html

Reminders are synced through their own backend and are not affected by notebook sync logic.

⚠️ 5. Known Pitfalls for AI Assistants

AIs must read this list before making any edits.

❗ 1. Notebook editor height is overridden by mobile-compact.css.

If notebook looks too short → fix this file first.

❗ 2. Inline <style> in mobile.html overrides theme CSS.

Many layout changes seem to “not work” because they’re overridden by more specific inline rules.

❗ 3. Notebook CSS is defined in multiple places.

Changes need to be applied consistently across layers, or they may conflict.

❗ 4. Notes sync depends on Supabase auth.

Notebook changes should not break:

IDs used by JS (noteTitleMobile, scratch-notes-card)

JS selectors referencing notebook DOM

❗ 5. Some padding/margin rules are duplicated.

Before modifying spacing, search for:

padding:, margin:, max-height:, flex:
AND search for:

.scratch-notes-card

.note-editor

.scratch-notes-body-wrapper

🛠️ 6. Safe Development Guidelines (For AIs)

Before making any layout or CSS change:

🔍 Step 1 — Search relevant keywords across the repo:
scratch-notes
note-editor
max-height
padding
@media (max-width
flex:
height:

🗂️ Step 2 — Map all locations that affect the area

(never assume only one file controls a feature)

🎨 Step 3 — Edit theme CSS first

Use theme-mobile.css for most layout changes.

🧱 Step 4 — Update inline CSS if needed

Only after modifying theme CSS.

📱 Step 5 — Check mobile-compact.css for conflicts

Especially for height, flex, or padding overrides.

🧪 Step 6 — Test layout in:

narrow mobile widths

tall devices

landscape (optional)

🔄 7. Notes Sync Flow

Notes autosave works even offline.

Cloud sync requires:

initSupabaseAuth → user signs in

initNotesSync receives the active user

Local notes changes propagate to Supabase

Remote changes merge into local storage

Notebook UI refreshes

Important:
Changing DOM structure must not break mobile.js selectors.

🔧 8. Reminders Sync Flow

Reminders sync automatically via their backend.
They are not tied to notebook sync.
The quick-add input triggers immediate local + remote creation.

🧼 9. Suggestions for Future Cleanup
✔ Consolidate notebook CSS into one place

Reduce fragmentation.

✔ Limit inline CSS in mobile.html

Move to theme-mobile.css.

✔ Simplify mobile-compact.css

Remove major layout rules; keep only tiny viewport adjustments.

✔ Add comments to CSS files

Explain each section’s purpose.

✔ Add constants for shared spacing, typography, breakpoints

Avoid magic numbers.

🎯 10. How AIs Should Approach Any Change

Before making modifications, the AI should say:

“I have reviewed ARCHITECTURE.md and understand the CSS layering and file responsibilities.”

Then:

Identify all files involved

Check for overrides

Apply changes consistently

Preserve IDs/classes required by JS

Avoid deleting anything tied to syncing or UI logic

🚀 End of Architecture

Your project now has a complete technical map.
