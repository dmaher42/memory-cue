Mobile UI changes (commit 9636825)
=================================

Summary
-------

- Removed the visible "Completed" filter tab from the top-level filter row on mobile. The "Completed" filter remains accessible from the header overflow menu.
- Centered and tightened spacing of the reminders filter bar on mobile.
- Adjusted the scratch-notes (notebook) sheet to sit directly under the filter bar, stretch to fill available vertical space, and allow the writing area to scroll internally.

Why this PR file exists
-----------------------

The code changes implementing the layout adjustments were committed directly to `main` in commit `9636825` ("Resolve mobile rebase conflicts: remove Completed tab and add mobile layout tweaks"). This small changelog file documents what changed and why, and provides a clean commit to open a PR for review/record if you want a code-review flow for the mobile tweaks.

Files/areas touched (high level)
--------------------------------

- `mobile.html`: removed the `data-reminders-tab="completed"` button from the visible tabs row; left the overflow menu item in place.
- `mobile.html` (runtime entrypoint): removed the `data-reminders-tab="completed"` button from the visible tabs row; left the overflow menu item in place. Note: the program runs from the top-level `mobile.html` (root), not `/docs/mobile.html`.
- `css/theme-mobile.css`: added mobile-scoped rules to center the tab row and make the scratch-notes card stretch and scroll internally.
- `404.html`, `docs/404.html`, `dist/404.html`: earlier small edits removed an explicit "Clear Completed" button in some static pages.

Notes
-----

- The git history already includes these changes on `main` (commit `9636825`). This PR only adds documentation for review. If you prefer a PR that contains the UI code changes themselves, I can create a feature branch with the UI edits and open that PR instead (that would require reverting or reworking `main`).

Next steps
----------

- If you'd like me to also open a PR that proposes the actual code changes (instead of or in addition to this doc), tell me and I will create a feature branch with the edits and open the PR.

Contact
-------

Created by automation to provide a reviewable PR entry for mobile UI changes.
