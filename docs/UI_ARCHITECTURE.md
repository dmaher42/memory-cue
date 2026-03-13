# UI Architecture (Phase 3)

## Canonical runtime shell
- `mobile.html` is the primary runtime shell for the app UI.
- Legacy shell files are retained for reference only.

## Navigation system
- Single navigation runtime: `js/services/navigation-service.js`.
- Navigation entrypoint: `navigationService.navigate(viewName)`.
- Supported views:
  - `capture`
  - `reminders`
  - `notes`
  - `assistant`
  - `settings`
- `app:navigate` events are normalized into the same navigation service.

## View structure
- Views are identified by `data-view`.
- The navigation service enforces one visible view at a time.
- Bottom navigation buttons use `data-nav-target` and dispatch navigation.

## Component system
- Standard utility classes:
  - `.btn-primary`
  - `.btn-secondary`
  - `.card-standard`
  - `.input-standard`
- DaisyUI utilities remain in place; shared custom overrides are centralized.

## CSS organization
- `css/layout.css`: shell/view layout rules.
- `css/components.css`: shared components.
- `css/reminders.css`: reminders-specific view styling.
- `css/assistant.css`: assistant-specific view styling.
- Existing inline CSS remains for compatibility and should be incrementally migrated.

## Naming conventions
- `notebook` UI naming standardized to `notes` at the view/navigation layer.
- `universalInput` standardized to `captureInput`.
- `quickAddInput` standardized to `reminderQuickAdd`.
- New navigation and UI work should use standardized names only.
