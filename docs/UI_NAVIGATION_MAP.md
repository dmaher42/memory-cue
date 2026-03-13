# UI Navigation Map

## 1) Hash routing (`js/router.js`)

- Uses `window.location.hash` (default `#dashboard`).
- `renderRoute()` toggles visibility of elements with `[data-route]` or `[data-view]`.
- Updates nav active states on elements with `[data-nav]` / `[data-route]`.
- Bound to `window.addEventListener('hashchange', renderRoute)`.

## 2) View toggles in mobile runtime

### Mobile markup (`mobile.html`)
- View sections use `data-view` IDs such as:
  - `view-capture`
  - `view-reminders`
  - `view-notebook`
  - `assistantView`
- Bottom nav buttons use `data-nav-target` (`capture`, `reminders`, `notebook`, `assistant`).
- Footer click handler dispatches `CustomEvent('app:navigate', { detail: { view } })`.

### Mobile runtime handlers (`mobile.js`, `js/navigation.js`, `js/entries.js`)
- `mobile.js` listens for `app:navigate` and toggles panel visibility, `aria-hidden`, and `data-active-view` on `body/main`.
- `js/navigation.js` includes global `app:navigate` support and helper `showViewFor` handling `capture/reminders/new/notebook/assistant/...`.
- `js/entries.js` has a bottom-tab/view toggler for reminders/notebook/categories/inbox/assistant and updates active tab UI classes.

## 3) Custom navigation events

Primary custom events found:
- `app:navigate` — canonical cross-module navigation signal in mobile runtime.
- `cue:prepare`, `cue:open`, `cue:close` — reminder sheet/modal open-close flow that also acts like contextual navigation.
- `open-reminder-sheet` — direct request to open reminder creation UI.
- `memoryCue:entriesUpdated`, `memoryCue:notesUpdated`, `memoryCue:remindersUpdated` — data-update events that trigger view refreshes across screens.

## 4) Navigation system overlap summary

Current repo has overlapping mechanisms:
- Hash route router (`js/router.js`) for older/route-based UI.
- Event-driven view switching (`app:navigate`) in mobile runtime.
- Local per-module view togglers in `mobile.js`, `js/navigation.js`, and `js/entries.js`.

This overlap is documented for cleanup planning; no behavior changes were made in this phase.
