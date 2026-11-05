# test-helpers.js

## Purpose

Shared test helper module that centralizes commonly used helper functions across all Playwright E2E spec files. Eliminates duplication and ensures consistent behavior.

## Public API

| Export                                       | Parameters                                                            | Description                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_HOOKS_TIMEOUT_MS`                      | — (constant: `5_000`)                                                 | Centralised timeout for all `waitForFunction` calls that gate on `window.testHooks`. Change this single value to adjust every helper.    |
| `fakeWebXRSupport(page)`                     | `page`: Playwright Page                                               | Injects a fake `navigator.xr` so the app stays in recording mode. Must be called **before** `page.goto('/')`.                            |
| `callRealPopulateScenarios(page, scenarios)` | `page`: Playwright Page, `scenarios`: `string[]`                      | Calls the real `populateScenarios` function via `window.testHooks`. Waits for the hook to be available first (defensive guard).          |
| `setPermissionsReady(page, options?)`        | `page`: Playwright Page, `options.validate`: boolean (default `true`) | Marks all permissions as ready via testHooks. Optionally calls `validateEnterButton`.                                                    |
| `setStorageReady(page, options?)`            | `page`: Playwright Page, `options.validate`: boolean (default `true`) | Marks both mandatory storage selections (folder + save location) as complete. Optionally calls `validateEnterButton`.                    |
| `waitForTestHooks(page)`                     | `page`: Playwright Page                                               | Waits for **all** `window.testHooks` functions to be available. Should be called in `beforeEach` of every spec file that uses testHooks. |
| `waitForTestHooksSubset(page, predicate)`    | `page`: Playwright Page, `predicate`: `(hooks) => boolean`            | Waits for a subset of hooks. Use when a spec only needs a few hooks — keeps the timeout centralised.                                     |

## Invariants & Design Decisions

- **Defensive guards stay in helpers**: `callRealPopulateScenarios`, `setPermissionsReady`, and `setStorageReady` each contain a `waitForFunction` call that waits for their specific hook. These are intentionally kept even though `waitForTestHooks` is called in `beforeEach` — they make the helpers safe to call in any context without hidden preconditions. The cost is negligible (instant resolution if hooks are already loaded).
- **`waitForTestHooks` is the canonical wait point**: All spec files should call `waitForTestHooks(page)` in their `beforeEach` block. This is the single source of truth for which hooks must be present. A test in `test-hooks-verification.spec.js` verifies that `waitForTestHooks` covers all exposed hooks.
- **No local copies**: Spec files must not define their own `waitForTestHooks` — always import from this module.

## Consumers

- `enter-ar-flow.spec.js` — imports `callRealPopulateScenarios`, `setPermissionsReady`, `setStorageReady`, `waitForTestHooks`, `fakeWebXRSupport`
- `setup-modal.spec.js` — imports `callRealPopulateScenarios`, `setStorageReady`, `waitForTestHooks`, `fakeWebXRSupport`
- `test-hooks-verification.spec.js` — imports `setPermissionsReady`, `setStorageReady`, `waitForTestHooks`
- `session-summary.spec.js` — imports `waitForTestHooks`
- `button-states.spec.js` — imports `fakeWebXRSupport`
- `log-panel.spec.js` — imports `waitForTestHooksSubset`

## Tests

Covered indirectly by every spec file that imports from it. The `test-hooks-verification.spec.js` test "all exposed testHooks are waited for in waitForTestHooks" validates that `waitForTestHooks` stays in sync with the actual hooks exposed by the app.
