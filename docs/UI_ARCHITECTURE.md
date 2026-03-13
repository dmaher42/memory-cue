# UI Architecture (Phase 3)

## Canonical runtime shell
- `mobile.html` is the primary runtime shell.
- Legacy shell files remain for reference only and should not be extended.

## Navigation system
- Single runtime navigation controller: `js/services/navigation-service.js`.
- Primary API: `navigationService.navigate(viewName)`.
- Views:
  - `capture`
  - `reminders`
  - `notes`
  - `assistant`
  - `settings`
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
- Use `notes` (not `notebook`) in navigation and user-facing labels.
- Use `captureInput` (not `universalInput`).
- Use `reminderQuickAdd` (not `quickAddInput`).
