# Reminders Feature Inspection (April 10, 2026)

## Scope reviewed

- Core reminder orchestration in `src/reminders/reminderController.js`.
- Reminder CRUD service wrapper in `src/reminders/reminderService.js`.
- Reminder UI toggles/events in `src/ui/reminderUI.js`.
- Regression path in `scripts/e2e-reminders-regression.mjs`.

## Current architecture snapshot

1. **Controller-centric orchestration**
   - `reminderController.js` is the main integration layer and wires auth, storage, Firestore sync, push sync, notifications, rendering, embeddings, and assistant integrations.
   - The controller normalizes reminder records and lists through `normalizeReminderRecordHelper`/`normalizeReminderListHelper` with local helper hooks (`uid`, `normalizeCategory`) to ensure shape consistency.

2. **Service layer behavior**
   - `reminderService.js` provides a stable CRUD interface (`createReminder`, `updateReminder`, `deleteReminder`, `completeReminder`) around `reminderStore.js` and supports optional lifecycle hooks (`onCreated`, `onUpdated`, etc.).
   - New reminders default to `priority: 'medium'` and `completed: false`, with support for injecting custom normalizers and IDs.

3. **UI interaction layer**
   - `reminderUI.js` keeps rendering decoupled by broadcasting a `memoryCue:remindersUpdated` event.
   - The view mode toggle (list/grid/row) updates classes and ARIA state for accessibility and handles dynamic updates via a `MutationObserver`.

4. **Regression/e2e signal**
   - `scripts/e2e-reminders-regression.mjs` validates quick-add reminder parsing/rendering, persistence to `memoryCue:offlineReminders`, inbox mirroring, and browser-console blocking errors.
   - The fixture intentionally includes a misspelled phrase (`"add remider tomorrow at 8:30 am get naplan"`) and asserts successful extraction into a normalized reminder (`Get Naplan`).

## Test results from this inspection

- `npm test -- reminders --runInBand`: **pass** (8 suites, 19 tests).
- `npm run check:reminders`: **warning/blocker in this environment** due to missing Playwright browser binary (`headless_shell`).

## Risks and recommendations

1. **High coupling in controller module**
   - `reminderController.js` aggregates many responsibilities and imports. This increases regression risk when changing any reminder-adjacent concern.
   - Recommendation: continue extracting focused subsystems (e.g., scheduler/push sync orchestration) behind narrow interfaces.

2. **E2E prerequisite clarity**
   - The reminders regression script is useful but currently fails fast if Playwright browsers are absent.
   - Recommendation: document a one-time setup step (`npx playwright install`) in contributor docs for local/CI parity.

3. **Typo tolerance appears intentional**
   - The e2e flow demonstrates resilient natural-language parsing for typo-heavy quick-add input (`remider` typo).
   - Recommendation: preserve this test case to guard parser robustness.
