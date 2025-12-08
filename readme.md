Memory Cue — Project Overview & Architecture Guide (AI-Optimized README)

Welcome to Memory Cue, a minimal, mobile-first reminders + notes app.
This project has evolved through iterative improvements using AI assistance.
This README is designed to help future AIs (and humans) understand:

how the project is structured

where key layout rules live

how reminders and notes work

where common pitfalls occur

where not to make changes

how to safely modify UI, CSS, and logic

If you are an AI assistant helping with this project, read this entire file before making any changes.

⭐ 1. High-Level Purpose

Memory Cue includes two main features:

Reminders

Quick entry bar at the top (text input + mic + save button + overflow)

List of reminders (All / Today segmented control)

Fully synced between devices via the existing reminders backend

Scratch Notes / Notebook

Simple writing-focused notes editor

Autosave by default (no Save button UI)

Optional cloud sync via Supabase (needs auth)

Should feel spacious, iOS-like, and distraction-free on mobile

⭐ 2. Repository Structure (Important)

This section explains which files matter for the UI, layout, sync, and behavior.

📱 Mobile UI
File	Purpose
mobile.html	Main UI for the mobile app. Contains HTML structure and inline CSS overrides.
css/theme-mobile.css	Core stylesheet for mobile layout; controls spacing, card design, reminders list, notebook layout.
styles/mobile-compact.css	Critical responsive stylesheet. Applies overrides at small screen sizes (height, flex, padding). This file can override everything else.
js/mobile.js	Main JavaScript for mobile interactions: notes editing, reminders logic, UI switching.
🧠 Sync & Storage
File	Purpose
js/modules/notes-sync.js	Handles cloud syncing of notes (Supabase).
js/notes-storage.js	Handles local storage for notes (autosave + offline).
js/reminders.js	Reminders engine. Already syncs fully.
🖼️ Icons & Shared Resources
File	Purpose
assets/icons/...	SVG icons used throughout the UI.
⭐ 3. CSS Architecture (Critical for AIs)

Memory Cue’s layout uses three layers of CSS, and knowing this prevents conflicts.

Layer 1 — Inline CSS inside mobile.html

Applies directly to the mobile view

Overrides external CSS

Often the reason some changes “don’t work” unless updated here too

Layer 2 — css/theme-mobile.css

Core design + mobile layout rules

Card spacing, width, typography, reminders list, notebook structure

Layer 3 — styles/mobile-compact.css (THE HIDDEN OVERRIDE LAYER)

This file contains a small-screen media query like:

@media (max-width: 480px) {
  .editor, .note-editor {
    max-height: 46vh;
  }
}


This forces the editor to be short (“squashed”).

If modifying notebook height, spacing, or full-screen behavior:
👉 ALWAYS CHECK THIS FILE FIRST.

⭐ 4. Notebook Architecture (for AIs editing layout)

Notebook layout is composed of:

#view-notebook
  #scratch-notes-card
    note title input
    formatting toolbar
    .scratch-notes-body-wrapper
      .note-editor-content
        editable text area


To make the notebook feel full screen:

#scratch-notes-card must be full-width and flex: 1

scratch-notes-wrapper must not impose large padding

styles/mobile-compact.css must not restrict height

The editable area must be flex: 1 and not use fixed vh heights

⭐ 5. Reminders Architecture

Reminders use:

A quick-add bar at the top

Segmented control (All / Today)

A scrolling list of reminder items

Voice dictation (mic button)

Overflow menu

Layout is controlled mainly by:

inline CSS in mobile.html

css/theme-mobile.css

Not by mobile-compact.css.

⭐ 6. Known Gotchas (Must-Read Before Changing Anything)
🟥 1. styles/mobile-compact.css overrides height on small screens.

If notebook feels “squashed,” fix this file.

🟧 2. Inline CSS in mobile.html overrides your external changes.

Always check bottom of <style> block.

🟨 3. Some notebook rules are duplicated across files.

Before editing, search for:

scratch-notes
note-editor
max-height
padding

🟩 4. Removing CSS does not guarantee removal — it might be redefined elsewhere.
🟦 5. Supabase notes sync only runs if user signs in AND mobile.js initializes it.
⭐ 7. Development Guidelines for AIs

When modifying layout or fixing bugs:

🔍 ALWAYS perform these searches first:

"scratch-notes-card"

"note-editor"

"max-height"

"padding"

"@media (max-width: 480px)"

"mobile-compact.css"

✔ ALWAYS check for duplicate rules

Notebook styles exist in multiple files.

✔ ALWAYS confirm a change in one file is not overwritten by another

Especially height, padding, or flex rules.

✔ NEVER remove IDs or classes used by JavaScript

Example: #noteTitleMobile, #quickAddInput, #scratch-notes-card

✔ Keep autosave + sync logic intact

Unless specifically asked to modify sync behavior.

✔ Write changes modularly

Do not apply massive refactors in one step.

⭐ 8. Adding New Features Safely

When implementing new notebook or reminders features:

Add new CSS to one place (preferably css/theme-mobile.css)

Avoid adding inline CSS unless necessary

Keep mobile-compact.css strictly for final adjustments

Ensure JS selectors match IDs/classes documented here

⭐ 9. How to Assist Development Using This README (For AIs)

Before making changes, say:

“I’ve reviewed README.md and understand the three-layer CSS structure.”

Then check:

layout rules across all files

small-screen overrides

inline styles

JS dependencies

⭐ 10. Planned Cleanup Tasks (Optional)

These will reduce confusion for future updates:

✔ Consolidate all notebook CSS into css/theme-mobile.css

Remove duplication.

✔ Reduce inline CSS in mobile.html

Move rules into theme file.

✔ Simplify or remove mobile-compact.css

Only keep viewport fixes, not major layout rules.

✔ Add comments inside each stylesheet

Note what file is “master” in each area.

⭐ 11. Contact Notes for AI Developers

If you are an AI model editing this project:

Follow this README strictly

Check every file affecting the area you modify

Ask before removing any layout or JS elements

Confirm final behavior matches intended iOS-like design

🎉 End of README

Your project now has a stable, documented foundation.
