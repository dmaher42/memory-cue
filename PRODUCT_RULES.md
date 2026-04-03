## Single Capture Pipeline Rule

Memory Cue must have **one capture pipeline**.

All freeform input must be processed through the same capture logic.

Examples of capture entry points:

* Brain Dump
* Quick Add
* Floating Action Button (FAB)
* Assistant capture
* Voice capture (future)

All of these must run through the same canonical capture logic.

If intent is clear and explicit, the pipeline may create a Note or Reminder directly.

If intent is ambiguous, incomplete, or needs later review, the pipeline should create an Inbox item.

## Inbox → Conversion Rule

Inbox acts as the background processing layer of the system.

Typical flow:

User Capture
↓
Capture Pipeline
↓
Note, Reminder, or Inbox Item
↓
User review / assistant suggestion when needed

Inbox is no longer required as a visible screen for every capture.

Inbox should be used for:

* uncategorised captures
* partial reminders that still need clarification
* deferred review items

Notes and Reminders may originate directly from the capture pipeline when the user's intent is already clear.

This keeps capture simple without forcing duplicate storage.

## Assistant Mutation Safety Rule

The Assistant must never silently mutate the user's data.

Assistant behavior must follow these rules:

* Assistant may analyse Inbox, Notes, and Reminders.
* Assistant may suggest conversions or edits.
* Assistant must not directly create Notes or Reminders without user confirmation.
* Assistant may help extract reminders from Notes, but creation still requires user confirmation.
* Assistant should prefer Inbox for ambiguous captures, not as a mandatory step for all captures.

This prevents hidden AI-driven data mutations.

## Storage Duplication Rule

The application must not introduce multiple storage locations for the same concept.

Approved storage domains:

Inbox
Notes
Reminders

Any new feature must store its data within one of these domains.

New localStorage keys, tables, or structures must not represent duplicate versions of:

* captured ideas
* notes
* reminders

This prevents architecture drift.

## Data Flow Diagram

All information in Memory Cue should follow this lifecycle:

Capture
↓
Capture Pipeline
↓
Notes or Reminders
or Inbox for later review
↓
Assistant search / summarise / classify

Inbox is the fallback processing layer for new information that is not yet clear enough to file directly.

Notes store written content.

Reminders store actionable items with dates.

Assistant operates across all three to help organise and retrieve information.
