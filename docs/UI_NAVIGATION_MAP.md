# UI Navigation Map

## 1) Active mobile navigation (`js/services/navigation-service-v2.js`)

- Owns major mobile view switching for `capture`, `reminders`, and `notebooks`.
- Listens for the canonical `app:navigate` event.
- Toggles `[data-view]` visibility, `hidden`, `aria-hidden`, and active navigation state.
- Dispatches `memorycue:navigation:changed` after a successful view change.
- Binds the `data-nav-target` buttons once and normalizes `notebook` / `notes` to `notebooks`.

## 2) View toggles in mobile runtime

### Mobile markup (`mobile.html`)
- Managed view sections use:
  - `view-capture`
  - `view-reminders`
  - `view-notebook`
- Bottom nav buttons use `data-nav-target` (`capture`, `reminders`, `notebooks`).

### Mobile runtime handlers
- `mobile.js` and feature modules dispatch `app:navigate` when they need a major view change.
- `js/services/navigation-service-v2.js` is the only loaded mobile view-switching controller.

## 3) Custom navigation events

Primary custom events found:
- `app:navigate` — canonical cross-module navigation signal in mobile runtime.
- `cue:prepare`, `cue:open`, `cue:close` — reminder sheet/modal open-close flow that also acts like contextual navigation.
- `open-reminder-sheet` — direct request to open reminder creation UI.
- `memoryCue:entriesUpdated`, `memoryCue:notesUpdated`, `memoryCue:remindersUpdated` — data-update events that trigger view refreshes across screens.

## 4) Navigation system overlap summary

Active navigation is converged on the event-driven `js/services/navigation-service-v2.js` controller. The old `js/navigation.js`, duplicate unversioned navigation service, and legacy hash router have been removed. `404.html` is now only a static redirect to `/mobile`.
