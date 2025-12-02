# Additional notebook suggestions

- **Autosave feedback**: Mobile save button triggers autosave silently. Add a subtle status indicator near the toolbar (e.g., "Saved"/"Saving…") so users know their edits persist when leaving the page.
- **Empty-state guidance**: The saved-notes sheet lacks guidance when no notes match the current folder or search. Render an empty-state message with a "New note" shortcut to steer users.
- **Folder rename support**: Folders are stored but can only be created. Provide a rename affordance in the folder picker so users can correct or adjust folder names without deleting/recreating.
- **Keyboard shortcut parity**: The editor uses `document.execCommand` with toolbar buttons only. Add common keyboard shortcuts (Ctrl/Cmd+B/I/U) wired to the same handlers for faster editing.
- **Searchable folder filter**: Folder chips become unwieldy with many folders. Offer a filter/search inside the move-to-folder sheet to quickly locate destinations.
- **Multi-line preview**: The saved-notes list renders only the title. Include a truncated snippet of the note body text to help distinguish similarly named notes.
