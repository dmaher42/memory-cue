## 2024-05-23 - Missing Status Indicators
**Learning:** The mobile note editor had JavaScript logic to update a status indicator (`notesStatusText`), but the element itself was missing from the HTML. This resulted in zero feedback for the "Save" action, leaving users unsure if their data was persisted.
**Action:** Always verify that DOM elements referenced in JavaScript actually exist in the markup, especially when working with legacy or refactored code. When adding status indicators, ensure they have `role="status"` for screen reader accessibility.
