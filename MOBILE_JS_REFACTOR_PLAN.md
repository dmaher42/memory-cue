# Mobile.js Refactor Implementation Plan

## Why `mobile.js` is currently overloaded

The current `mobile.js` file has grown into a single orchestration point for many unrelated concerns. It is now over 4,600 lines and mixes UI rendering, event wiring, feature logic, persistence, and sync/auth concerns in one place.

This creates practical problems:

- **High change risk:** edits for one feature can accidentally affect another because state and DOM handlers are tightly coupled.
- **Hard debugging:** feature boundaries are unclear, so tracing regressions requires scanning a very large file.
- **Difficult testing:** smaller units are hard to isolate when everything is defined in one script.
- **Slow onboarding:** contributors must understand many app areas before safely changing a single flow.

The goal of this plan is to split responsibilities into focused modules **without changing behavior yet**.

## Main responsibility groups in `mobile.js`

1. **Shared app state and cross-feature flags**
   - Current folder/view/search state
   - Shared caches and in-memory lists
   - Feature-level refresh hooks and global coordination helpers

2. **Navigation and screen/view activation**
   - Bottom/nav interactions
   - Switching among app sections
   - Visibility toggles for active panels

3. **Inbox and list-oriented flows**
   - Inbox-facing entry points and quick actions
   - Filtering/refresh triggers for list views

4. **Notes/editor/folders flows**
   - Notes list rendering
   - Folder chips/menus/reordering/deletion
   - Note editor open/save/autosave wiring

5. **Reminders feature logic**
   - Reminder create/edit/delete/toggle interactions
   - Reminder-specific filtering/sorting and UI updates

6. **Assistant/thinking bar interactions**
   - Assistant input handling
   - Result rendering and context prep
   - Assistant request lifecycle UI states

7. **Modal/dialog behavior**
   - Open/close helpers
   - Modal-specific focus and accessibility interactions
   - Shared confirmation prompts used across features

8. **Persistence and sync/auth integration**
   - localStorage reads/writes and key normalization
   - Firebase auth/sync wiring
   - External sync controls and status handling

## Proposed modular file structure

> Use the structure below as the target split. During extraction, move code in small steps and preserve existing function names where practical to reduce risk.

### `js/app-state.js`

**Owns**
- Central in-memory state object(s) and simple getters/setters.
- Shared constants/flags used across modules (active folder, selected note id, current view, etc.).
- Small state mutation helpers that do not directly touch DOM.

**Does not own**
- DOM querying/rendering.
- Feature-specific business logic (notes/reminders/assistant).
- Storage and network calls.

**Examples to move**
- Top-level mutable variables that represent cross-feature UI state.
- Generic state update helpers currently reused by multiple areas.

### `js/navigation.js`

**Owns**
- Navigation event handlers and route/view switching.
- Active tab/panel toggling and related accessibility attributes.
- Cross-view transitions triggered by nav controls.

**Does not own**
- Notes/reminders business logic.
- Data persistence.
- Assistant request logic.

**Examples to move**
- Handlers that react to nav button clicks/data-nav-target attributes.
- Functions that show/hide major page sections.

### `js/inbox.js`

**Owns**
- Inbox-specific rendering and interactions.
- Inbox list refresh and filter behavior.
- Inbox quick-action wiring that is unique to inbox.

**Does not own**
- Generic note editor logic.
- Reminder CRUD logic.
- Global modal primitives.

**Examples to move**
- Inbox event bindings and list update helpers.
- Any logic currently scoped to inbox panel behavior.

### `js/notes.js`

**Owns**
- Note editor interactions (open/save/autosave).
- Notes list rendering and filtering.
- Folder chips, folder management menus, and note-folder assignment flows.

**Does not own**
- Low-level storage adapter implementation.
- Auth/sync transport.
- Generic modal controller internals.

**Examples to move**
- `openEditor()` and note save/autosave wiring.
- Saved notes sheet handling, folder add/reorder/delete handlers.
- Note search/filter application before render.

### `js/reminders.js`

**Owns**
- Reminder UI wiring and reminder feature behavior.
- Reminder list transforms (grouping/sorting/filtering) used by reminder UI.
- Reminder action handlers (complete/edit/delete/create).

**Does not own**
- Notes editor flows.
- Assistant UI logic.
- External sync transport details beyond reminder feature handoff.

**Examples to move**
- Reminder button handlers and reminder list update utilities.
- Reminder-specific state transitions and render triggers.

### `js/assistant-ui.js`

**Owns**
- Assistant input/submit handlers and thread UI updates.
- Thinking bar status/result rendering.
- Assistant request lifecycle UI state (loading/error/success).

**Does not own**
- Generic navigation or modal plumbing.
- Notes/reminders rendering.
- Storage implementation details.

**Examples to move**
- `initAssistant()` and helper functions for message/result rendering.
- Memory context assembly for assistant requests.

### `js/modals.js`

**Owns**
- Shared modal open/close/toggle helpers.
- Focus trap/restore and keyboard dismissal behavior for dialogs.
- Feature-agnostic confirmation/cancel patterns.

**Does not own**
- Feature business rules (e.g., deleting a folder, saving a reminder).
- Network/storage concerns.

**Examples to move**
- Modal wiring now spread through notes/settings/reminder sections.
- Shared dialog utility functions used by multiple areas.

### `js/storage.js`

**Owns**
- Local persistence wrappers (read/write, parse guards, key migration/normalization).
- Feature-facing storage adapters for notes/reminders/settings.
- Safe fallback behavior when storage data is malformed.

**Does not own**
- Rendering or direct DOM updates.
- Sync network requests.

**Examples to move**
- localStorage key scanning/parsing and normalization helpers.
- Settings persistence helpers for sync URL and related flags.

### `js/sync.js`

**Owns**
- Sync/auth wiring glue and sync control actions.
- Connectivity status handling and sync request orchestration.
- Feature-level sync triggers and progress/status updates.

**Does not own**
- Feature rendering internals.
- Generic local storage utilities (except via `storage.js`).

**Examples to move**
- Firebase auth + note sync bridge code.
- Manual sync/test-sync button behavior and fetch orchestration.

## Refactor Rules

- **Do not change product behavior during the split.**
- **Move logic before rewriting logic.** Extract first, then clean up in later passes.
- **Keep one feature area per file.** Avoid “misc” modules.
- **Keep DOM wiring close to the feature it controls.**
- **Avoid reintroducing duplicate capture logic.** Reuse shared helpers where needed.
- Preserve existing public/global hooks until all call sites are migrated.
- Keep extraction PRs small and reversible.

## Safe Refactor Sequence

1. Extract shared state helpers into `js/app-state.js`.
2. Extract navigation wiring into `js/navigation.js`.
3. Extract reminder logic into `js/reminders.js`.
4. Extract notes and folder/editor logic into `js/notes.js`.
5. Extract assistant/thinking bar UI logic into `js/assistant-ui.js`.
6. Extract shared modal helpers into `js/modals.js`.
7. Extract local persistence and sync orchestration into `js/storage.js` and `js/sync.js`.
8. Re-test after each move, verifying no behavior changes before continuing.

## Definition of done for this planning phase

- A clear target module map exists.
- Ownership boundaries are documented (`owns` vs `does not own`) for each module.
- Extraction order is defined to reduce risk and avoid circular dependencies.
- No production behavior changes have been introduced in this planning-only step.
