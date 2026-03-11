## Single Capture Pipeline Rule

Memory Cue must have **one capture pipeline**.

All freeform input must be processed through the same capture logic.

Examples of capture entry points:

* Brain Dump
* Quick Add
* Floating Action Button (FAB)
* Assistant capture
* Voice capture (future)

All of these must create **Inbox items** through the same capture logic (typically implemented in `capture.js`).

No feature may directly create Notes or Reminders from raw input without first creating an Inbox item.

## Inbox → Conversion Rule

Inbox acts as the processing layer of the system.

Typical flow:

User Capture
↓
Inbox Item
↓
User or Assistant processes item
↓
Convert to Note or Reminder

Notes and Reminders should normally originate from Inbox items unless the user intentionally creates them directly.

This keeps capture simple and prevents fragmented storage paths.

## Assistant Mutation Safety Rule

The Assistant must never silently mutate the user's data.

Assistant behavior must follow these rules:

* Assistant may analyse Inbox, Notes, and Reminders.
* Assistant may suggest conversions or edits.
* Assistant must not directly create Notes or Reminders without user confirmation.
* Assistant should normally operate on Inbox items before converting them into structured items.

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
Inbox
↓
Process
↓
Notes or Reminders
↓
Assistant search / summarise / classify

Inbox is the entry point for new information.

Notes store written content.

Reminders store actionable items with dates.

Assistant operates across all three to help organise and retrieve information.
