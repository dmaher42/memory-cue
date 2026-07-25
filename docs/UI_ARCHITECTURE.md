# UI Architecture (Phase 3)

## Canonical runtime shell
- `mobile.html` is the primary runtime shell.
- Legacy shell files remain for reference only and should not be extended.

## Navigation system
- Single runtime navigation controller: `js/services/navigation-service-v2.js`.
- Primary API: `navigationService.navigate(viewName)`.
- Views:
  - `capture`
  - `reminders`
  - `notebooks`
- Navigation behavior:
  - Shows target view.
  - Hides all other managed views.
  - Updates active bottom-nav state.
  - Dispatches `memorycue:navigation:changed`.
- `app:navigate` events are normalized into this same controller.

## View structure
- Managed view containers are identified with `data-view`.
- Bottom navigation uses `data-nav-target` and routes through the navigation service.
- Only one managed view is visible at a time.

## Component system
- Shared component classes:
  - `.btn-primary`
  - `.btn-secondary`
  - `.card-standard`
  - `.input-standard`
- DaisyUI utility classes remain in use.
- Custom component overrides should be centralized in `css/components.css`.

## CSS organization
- `css/layout.css`: shell and view layout rules.
- `css/components.css`: shared component primitives.
- `css/reminders.css`: reminders view styles.
- `css/assistant.css`: assistant view styles.
- `mobile.html` should keep only minimal inline styles that are layout-critical.

## Naming conventions
- Use `notebooks` for the internal mobile navigation target and `Notes` for the user-facing label.
- Use `thinkingBarInput` for the sole freeform capture field.
- Use `reminderText` only inside the structured reminder-creation sheet.
